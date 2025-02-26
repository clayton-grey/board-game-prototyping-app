// ./server/ws/handlers/elementHandlers.js
import { broadcastElementState } from '../collabUtils.js';

/**
 * handleElementGrab, handleElementMove, handleElementRelease, handleElementDeselect
 * (unchanged from previous patch)
 */
export function handleElementGrab(session, data, ws) {
  if (!session) return;
  const { userId, elementId } = data;

  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // If locked by someone else, do nothing
  if (el.lockedBy && el.lockedBy !== userId) {
    return;
  }
  // Otherwise, lock it to me
  el.lockedBy = userId;

  // If we do not have a pending record, store old position
  if (!session.pendingMoves.has(elementId)) {
    session.pendingMoves.set(elementId, {
      userId,
      oldX: el.x,
      oldY: el.y,
    });
  }

  broadcastElementState(session);
}

export function handleElementMove(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y } = data;

  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (el.lockedBy === userId) {
    el.x = x;
    el.y = y;
    broadcastElementState(session);
  }
}

export function handleElementRelease(session, data, ws) {
  if (!session) return;
  const { userId, elementId } = data;

  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (el.lockedBy === userId) {
    finalizePendingMove(session, elementId, userId);
    // Notice: do not unlock
    broadcastElementState(session);
  }
}

export function handleElementDeselect(session, data, ws) {
  if (!session) return;
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds)) return;

  elementIds.forEach((elementId) => {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) return;
    if (el.lockedBy === userId) {
      finalizePendingMove(session, elementId, userId);
      el.lockedBy = null;
    }
  });

  broadcastElementState(session);
}

/**
 * handleElementCreate:
 *   - assign next ID, lockedBy = user
 *   - push "create" action to undoStack
 */
export function handleElementCreate(session, data, ws) {
  if (!session) return;
  const { userId, shape, x, y, w, h } = data;
  if (!userId || !shape) return;

  // find max ID
  let maxId = 0;
  for (const e of session.elements) {
    if (e.id > maxId) maxId = e.id;
  }
  const newId = maxId + 1;

  const newElement = {
    id: newId,
    shape,
    x, y, w, h,
    lockedBy: userId, // lock it by default
  };
  session.elements.push(newElement);

  // Clear redo stack
  session.redoStack = [];
  const action = {
    type: 'create',
    diffs: [
      {
        elementId: newId,
      },
    ],
  };
  session.undoStack.push(action);
  if (session.undoStack.length > 50) {
    session.undoStack.shift();
  }

  broadcastElementState(session);
}

/**
 * NEW: handleElementDelete
 * data: { userId, elementIds: number[] }
 */
export function handleElementDelete(session, data, ws) {
  if (!session) return;
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds) || elementIds.length === 0) return;

  // Gather the shape data of each to remove, so we can undo later
  const toDelete = [];
  for (const id of elementIds) {
    const idx = session.elements.findIndex(e => e.id === id);
    if (idx >= 0) {
      const el = session.elements[idx];
      // If locked by someone else, skip
      if (el.lockedBy && el.lockedBy !== userId) {
        continue; 
      }
      toDelete.push({ ...el }); // shallow copy shape data
      // Remove from session
      session.elements.splice(idx, 1);
    }
  }

  if (toDelete.length === 0) {
    // nothing removed => just broadcast or skip
    broadcastElementState(session);
    return;
  }

  // Clear redo stack
  session.redoStack = [];

  // Add an undo stack action
  // We store type=delete and an array of the full shape data in diffs
  const action = {
    type: 'delete',
    diffs: toDelete.map(el => ({
      id: el.id,
      shape: el.shape,
      x: el.x,
      y: el.y,
      w: el.w,
      h: el.h,
      lockedBy: el.lockedBy,
    })),
  };

  session.undoStack.push(action);
  if (session.undoStack.length > 50) {
    session.undoStack.shift();
  }

  broadcastElementState(session);
}

function finalizePendingMove(session, elementId, userId) {
  const pending = session.pendingMoves.get(elementId);
  if (!pending || pending.userId !== userId) {
    return;
  }

  const el = session.elements.find(e => e.id === elementId);
  session.pendingMoves.delete(elementId);
  if (!el) return;

  const oldX = pending.oldX;
  const oldY = pending.oldY;
  const newX = el.x;
  const newY = el.y;
  if (oldX === newX && oldY === newY) {
    return; // no actual movement
  }

  // Clear redo stack
  session.redoStack = [];
  const action = {
    type: 'move',
    diffs: [
      {
        elementId,
        from: { x: oldX, y: oldY },
        to: { x: newX, y: newY },
      },
    ],
  };
  session.undoStack.push(action);
  if (session.undoStack.length > 50) {
    session.undoStack.shift();
  }
}
