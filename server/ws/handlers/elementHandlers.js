// ./server/ws/handlers/elementHandlers.js
import { broadcastElementState } from '../collabUtils.js';
import { pushUndoAction } from './undoRedoHandlers.js';

/**
 * A helper that checks if the element is locked by someone else; 
 * if yes, returns false so the caller can skip. 
 * Otherwise, if it's unlocked and `autoLock` is true, lock it to `userId`.
 * Return true if the caller can proceed, false otherwise.
 */
function ensureLockOrSkip(el, userId, { autoLock = true } = {}) {
  // If locked by another user, skip
  if (el.lockedBy && el.lockedBy !== userId) {
    return false;
  }
  // If unlocked and autoLock is allowed, lock it
  if (!el.lockedBy && autoLock) {
    el.lockedBy = userId;
  }
  return true;
}

/**
 * Helper: get or create the user-specific sub-map under session[key]. 
 * Example usage: const userMap = getOrCreateUserMap(session, 'pendingResizes', userId);
 */
function getOrCreateUserMap(session, key, userId) {
  if (!session[key]) {
    session[key] = new Map();
  }
  let userMap = session[key].get(userId);
  if (!userMap) {
    userMap = new Map();
    session[key].set(userId, userMap);
  }
  return userMap;
}

export function handleElementGrab(session, data, ws) {
  if (!session) return;
  const { userId, elementId } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (!ensureLockOrSkip(el, userId)) {
    return;
  }
  broadcastElementState(session);
}

export function handleElementMove(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (!ensureLockOrSkip(el, userId)) {
    return;
  }
  el.x = x;
  el.y = y;
  broadcastElementState(session);
}

export function handleElementRelease(session, data, ws) {
  if (!session) return;
  const { userId, elementId } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // We only broadcast if it was indeed locked by userId.
  if (el.lockedBy === userId) {
    broadcastElementState(session);
  }
}

export function handleElementDeselect(session, data, ws) {
  if (!session) return;
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds)) return;

  for (const elementId of elementIds) {
    const el = session.elements.find(e => e.id === elementId);
    if (el && el.lockedBy === userId) {
      el.lockedBy = null;
    }
  }
  broadcastElementState(session);
}

export function handleElementCreate(session, data, ws) {
  if (!session) return;
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
    lockedBy: userId, // automatically lock to creator
  };
  session.elements.push(newElement);

  const action = {
    type: 'create',
    diffs: [{ elementId: newId }],
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
    if (idx < 0) continue;

    const el = session.elements[idx];
    // For deletion, we skip if locked by another user, 
    // but do NOT forcibly lock if it's free => autoLock: false
    if (!ensureLockOrSkip(el, userId, { autoLock: false })) {
      continue;
    }
    // Remove from array
    toDelete.push({ ...el });
    session.elements.splice(idx, 1);
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
}

export function handleElementResize(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y, w, h } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // Must ensure we lock it or skip
  if (!ensureLockOrSkip(el, userId)) {
    return;
  }

  // Store original pos in user’s pendingResizes if not present
  const userMap = getOrCreateUserMap(session, 'pendingResizes', userId);
  if (!userMap.has(elementId)) {
    userMap.set(elementId, { x: el.x, y: el.y, w: el.w, h: el.h });
  }

  el.x = x;
  el.y = y;
  el.w = w;
  el.h = h;
  broadcastElementState(session);
}

export function handleElementResizeEnd(session, data, ws) {
  if (!session) return;
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds) || elementIds.length === 0) return;

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
    const action = { type: 'resize', diffs };
    pushUndoAction(session, action);
  }
  broadcastElementState(session);
}
