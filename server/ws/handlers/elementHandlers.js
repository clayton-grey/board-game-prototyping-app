// =========================
// FILE: server/ws/handlers/elementHandlers.js
// =========================

import { broadcastElementState } from '../collabUtils.js';
import { pushUndoAction } from './undoRedoHandlers.js';
import { sessionGuard } from './handlerUtils.js';
import { finalizePendingMovesForUser } from './pendingActionsFinalizer.js';

/** Helper to check if element is locked by another user. */
function isElementLockedByOthers(element, userId) {
  return element.lockedBy && element.lockedBy !== userId;
}

export const handleElementGrab = sessionGuard((session, data, ws) => {
  const { userId, elementId } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (isElementLockedByOthers(el, userId)) return;
  el.lockedBy = userId;
  broadcastElementState(session);
});

export const handleElementMove = sessionGuard((session, data, ws) => {
  const { userId, elementId, x, y } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (el.lockedBy === userId) {
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
    el.x = x;
    el.y = y;

    broadcastElementState(session);
  }
});

export const handleElementRelease = sessionGuard((session, data, ws) => {
  const { userId, elementId } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (el.lockedBy === userId) {
    el.lockedBy = null;
  }
  // Now finalize any pending moves for this user
  finalizePendingMovesForUser(session, userId);

  broadcastElementState(session);
});

export const handleElementDeselect = sessionGuard((session, data, ws) => {
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds)) return;

  for (const elementId of elementIds) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) continue;
    if (el.lockedBy === userId) {
      el.lockedBy = null;
    }
  }
  // Finalize moves for any unlocked elements
  finalizePendingMovesForUser(session, userId);

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
    lockedBy: userId
  };
  session.elements.push(newElement);

  const action = {
    type: 'create',
    diffs: [{
      elementId: newId,
      shape,
      x, y, w, h
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

  if (isElementLockedByOthers(el, userId)) return;
  if (!el.lockedBy) {
    el.lockedBy = userId;
  }

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
