// ./server/ws/handlers/elementHandlers.js
import { broadcastElementState } from '../collabUtils.js';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';

/**
 * handleElementGrab, handleElementMove, handleElementRelease, handleElementDeselect
 * (Unchanged from previous except for references to resizing, see below)
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
    // do not unlock automatically
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
      finalizePendingResize(session, elementId, userId);
      el.lockedBy = null;
    }
  });

  broadcastElementState(session);
}

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
    broadcastElementState(session);
    return;
  }

  // Clear redo stack
  session.redoStack = [];
  // Add an undo stack action
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

/* ------------------------------------------------------------------
   NEW: Resizing
   data: { userId, elementId, x, y, w, h }
   - We treat each call as an incremental update to a shape's size.
   - Similar to "move", we track pendingResizes to handle undo/redo.
------------------------------------------------------------------ */
export function handleElementResize(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y, w, h } = data;

  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // Lock check
  if (el.lockedBy && el.lockedBy !== userId) {
    return; 
  }
  // If not locked, automatically lock to me (similar to handleElementGrab)
  if (!el.lockedBy) {
    el.lockedBy = userId;
  }

  // If we do not have a pending record, store old x/y/w/h
  if (!session.pendingResizes) {
    session.pendingResizes = new Map();
  }
  if (!session.pendingResizes.has(elementId)) {
    session.pendingResizes.set(elementId, {
      userId,
      oldX: el.x,
      oldY: el.y,
      oldW: el.w,
      oldH: el.h,
    });
  }

  // Now update the shape
  el.x = x;
  el.y = y;
  el.w = w;
  el.h = h;

  broadcastElementState(session);
}

/* ------------------------------------------------------------------
   INTERNAL UTILS
------------------------------------------------------------------ */
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

function finalizePendingResize(session, elementId, userId) {
  if (!session.pendingResizes) {
    session.pendingResizes = new Map();
  }
  const pending = session.pendingResizes.get(elementId);
  if (!pending || pending.userId !== userId) {
    return;
  }

  const el = session.elements.find(e => e.id === elementId);
  session.pendingResizes.delete(elementId);
  if (!el) return;

  const { oldX, oldY, oldW, oldH } = pending;
  const newX = el.x;
  const newY = el.y;
  const newW = el.w;
  const newH = el.h;

  if (oldX === newX && oldY === newY && oldW === newW && oldH === newH) {
    return; // no actual resize
  }

  // Clear redo stack
  session.redoStack = [];
  const action = {
    type: 'resize',
    diffs: [
      {
        elementId,
        from: { x: oldX, y: oldY, w: oldW, h: oldH },
        to: { x: newX, y: newY, w: newW, h: newH },
      },
    ],
  };
  session.undoStack.push(action);
  if (session.undoStack.length > 50) {
    session.undoStack.shift();
  }
}
