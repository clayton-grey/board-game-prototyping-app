// ./server/ws/handlers/elementHandlers.js

import { broadcastElementState } from '../collabUtils.js';
import { pushUndoAction } from './undoRedoHandlers.js';
import { sessionGuard } from './handlerUtils.js';

/** Helper to check if element is locked by another user. */
function isElementLockedByOthers(element, userId) {
  return element.lockedBy && element.lockedBy !== userId;
}

export const handleElementGrab = sessionGuard((session, data, ws) => {
  const { userId, elementId } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // If locked by someone else, do nothing
  if (isElementLockedByOthers(el, userId)) return;
  // Otherwise lock it
  el.lockedBy = userId;
  broadcastElementState(session);
});

export const handleElementMove = sessionGuard((session, data, ws) => {
  const { userId, elementId, x, y } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // Must be locked by this user
  if (el.lockedBy === userId) {
    // Track original position if not yet stored
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

    // Apply new position
    el.x = x;
    el.y = y;

    broadcastElementState(session);
  }
});

export const handleElementRelease = sessionGuard((session, data, ws) => {
  const { userId, elementId } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // If the releasing user actually had it locked, free it
  if (el.lockedBy === userId) {
    el.lockedBy = null;
  }

  // Now finalize the pending moves (for any element the user no longer locks)
  finalizeAllPendingMovesForUser(session, userId);

  broadcastElementState(session);
});

export const handleElementDeselect = sessionGuard((session, data, ws) => {
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds)) return;

  // Unlock any elements we actually had
  for (const elementId of elementIds) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) continue;
    if (el.lockedBy === userId) {
      el.lockedBy = null;
    }
  }
  // Finalize moves on any that are no longer locked by the user
  finalizeAllPendingMovesForUser(session, userId);

  broadcastElementState(session);
});

export const handleElementCreate = sessionGuard((session, data, ws) => {
  const { userId, shape, x, y, w, h } = data;
  if (!userId || !shape) return;

  let maxId = 0;
  for (const e of session.elements) {
    if (e.id > maxId) maxId = e.id;
  }
  const newId = maxId + 1;

  const newElement = {
    id: newId,
    shape,
    x, y, w, h,
    lockedBy: userId, // lock to creator (so they can drag it right away)
  };
  session.elements.push(newElement);

  // Store all relevant data so that REDO can re-create
  const action = {
    type: 'create',
    diffs: [{
      elementId: newId,
      shape,
      x, y, w, h,
    }],
  };
  pushUndoAction(session, action);

  broadcastElementState(session);
});

export const handleElementDelete = sessionGuard((session, data, ws) => {
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds) || elementIds.length === 0) return;

  const toDelete = [];
  for (const id of elementIds) {
    const idx = session.elements.findIndex(e => e.id === id);
    if (idx >= 0) {
      const el = session.elements[idx];
      if (isElementLockedByOthers(el, userId)) {
        // skip if locked by someone else
        continue;
      }
      toDelete.push({ ...el });
      session.elements.splice(idx, 1);
    }
  }

  if (toDelete.length === 0) {
    broadcastElementState(session);
    return;
  }

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
});

export const handleElementResize = sessionGuard((session, data, ws) => {
  const { userId, elementId, x, y, w, h } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // If locked by someone else, do nothing
  if (isElementLockedByOthers(el, userId)) return;

  // If not locked, auto-lock
  if (!el.lockedBy) {
    el.lockedBy = userId;
  }

  // Store original pos if not already stored
  if (!session.pendingResizes) {
    session.pendingResizes = new Map();
  }
  let userMap = session.pendingResizes.get(userId);
  if (!userMap) {
    userMap = new Map();
    session.pendingResizes.set(userId, userMap);
  }
  if (!userMap.has(elementId)) {
    userMap.set(elementId, { x: el.x, y: el.y, w: el.w, h: el.h });
  }

  el.x = x;
  el.y = y;
  el.w = w;
  el.h = h;

  broadcastElementState(session);
});

export const handleElementResizeEnd = sessionGuard((session, data, ws) => {
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds) || elementIds.length === 0) {
    broadcastElementState(session);
    return;
  }

  if (!session.pendingResizes || !session.pendingResizes.has(userId)) {
    broadcastElementState(session);
    return;
  }

  const userMap = session.pendingResizes.get(userId);
  const diffs = [];

  for (const elementId of elementIds) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) continue;
    if (el.lockedBy !== userId) continue;

    const original = userMap.get(elementId);
    if (!original) continue;

    if (
      el.x !== original.x ||
      el.y !== original.y ||
      el.w !== original.w ||
      el.h !== original.h
    ) {
      diffs.push({
        elementId,
        from: { ...original },
        to: { x: el.x, y: el.y, w: el.w, h: el.h },
      });
    }
    userMap.delete(elementId);
  }

  if (userMap.size === 0) {
    session.pendingResizes.delete(userId);
  }

  if (diffs.length > 0) {
    const action = {
      type: 'resize',
      diffs,
    };
    pushUndoAction(session, action);
  }

  broadcastElementState(session);
});

/**
 * Called internally whenever a user finishes locking or releasing
 * one or more elements. We check all pending moves that belong
 * to that user but are for elements no longer locked by them.
 * We unify all those diffs into a single 'move' action.
 */
function finalizeAllPendingMovesForUser(session, userId) {
  if (!session.pendingMoves) {
    session.pendingMoves = new Map();
  }
  const diffs = [];

  for (const [elementId, moveData] of session.pendingMoves.entries()) {
    if (moveData.userId !== userId) continue;
    const el = session.elements.find(e => e.id === elementId);
    if (!el) {
      // element might have been deleted
      session.pendingMoves.delete(elementId);
      continue;
    }
    // If it's still locked by the user, skip finalizing it now
    if (el.lockedBy === userId) {
      continue;
    }

    // Otherwise finalize
    const oldX = moveData.oldX;
    const oldY = moveData.oldY;
    const newX = el.x;
    const newY = el.y;
    session.pendingMoves.delete(elementId);

    // Only record a diff if something actually moved
    if (oldX !== newX || oldY !== newY) {
      diffs.push({
        elementId,
        from: { x: oldX, y: oldY },
        to: { x: newX, y: newY },
      });
    }
  }

  if (diffs.length > 0) {
    const action = {
      type: 'move',
      diffs,
    };
    pushUndoAction(session, action);
  }
}
