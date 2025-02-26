// ./server/ws/handlers/elementHandlers.js
import { broadcastElementState } from '../collabUtils.js';
import { pushUndoAction } from './undoRedoHandlers.js';

/**
 * handleElementGrab, handleElementMove, handleElementRelease, handleElementDeselect, etc.
 * (Same general logic, but with small clarifications to finalize multiple elements if needed.)
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

  // Store old position if not already pending
  if (!session.pendingMoves) {
    session.pendingMoves = new Map();
  }
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

  // Must be locked by this user to move
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
    // do not unlock automatically => user must deselect or move onto next action
    broadcastElementState(session);
  }
}

export function handleElementDeselect(session, data, ws) {
  if (!session) return;
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds)) return;

  for (const elementId of elementIds) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) continue;
    if (el.lockedBy === userId) {
      finalizePendingMove(session, elementId, userId);
      finalizePendingResize(session, elementId, userId);
      // Now unlock
      el.lockedBy = null;
    }
  }

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
    lockedBy: userId, // lock by default
  };
  session.elements.push(newElement);

  // Put a "create" action on the undo stack
  const action = {
    type: 'create',
    diffs: [
      {
        elementId: newId,
      },
    ],
  };
  pushUndoAction(session, action);

  broadcastElementState(session);
}

export function handleElementDelete(session, data, ws) {
  if (!session) return;
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds) || elementIds.length === 0) return;

  const toDelete = [];
  for (const id of elementIds) {
    const idx = session.elements.findIndex(e => e.id === id);
    if (idx >= 0) {
      const el = session.elements[idx];
      // If locked by someone else, skip
      if (el.lockedBy && el.lockedBy !== userId) {
        continue;
      }
      toDelete.push({ ...el }); // shallow copy
      session.elements.splice(idx, 1);
    }
  }

  if (toDelete.length === 0) {
    // no real changes
    broadcastElementState(session);
    return;
  }

  // Put a "delete" action onto undo stack
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
  pushUndoAction(session, action);

  broadcastElementState(session);
}

/**
 * Resizing logic: data = { userId, elementId, x, y, w, h }
 */
export function handleElementResize(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y, w, h } = data;

  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // Must be locked or lock now
  if (el.lockedBy && el.lockedBy !== userId) {
    return;
  }
  if (!el.lockedBy) {
    el.lockedBy = userId;
  }

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

  // update shape
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
  if (!session.pendingMoves) {
    session.pendingMoves = new Map();
  }
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
    return; // no real movement => skip action
  }

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
  pushUndoAction(session, action);
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
    return; // no resize => skip
  }

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
  pushUndoAction(session, action);
}
