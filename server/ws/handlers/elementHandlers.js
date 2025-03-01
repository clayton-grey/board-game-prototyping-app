// ./server/ws/handlers/elementHandlers.js
import { broadcastElementState } from '../collabUtils.js';
import { pushUndoAction } from './undoRedoHandlers.js';

/**
 * A small helper that:
 * 1) If the element is locked by someone else, returns false (do nothing).
 * 2) If not locked, locks it to `userId`.
 * 3) If already locked by the same user, leaves it as-is.
 * Returns true if the caller can proceed, false otherwise.
 */
function lockIfPossible(el, userId) {
  if (el.lockedBy && el.lockedBy !== userId) {
    // Locked by another user => skip
    return false;
  }
  if (!el.lockedBy) {
    // Auto-lock to the caller
    el.lockedBy = userId;
  }
  return true;
}

export function handleElementGrab(session, data, ws) {
  if (!session) return;
  const { userId, elementId } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // Attempt to lock or skip
  if (!lockIfPossible(el, userId)) {
    return;
  }
  broadcastElementState(session);
}

export function handleElementMove(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y } = data;

  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // Same lock check as handleElementGrab
  if (!lockIfPossible(el, userId)) {
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

  // We only broadcast if it was locked by the same user
  if (el.lockedBy === userId) {
    // (We do not automatically unlock it here, per the original logic.)
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
    // Unlock only if this user had it locked
    if (el.lockedBy === userId) {
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
      // If locked by someone else => skip (no auto-lock for delete)
      if (el.lockedBy && el.lockedBy !== userId) {
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
}

/**
 * handleElementResize => if locked by someone else, skip;
 * if unlocked, lock to me. Then store original pos in session.pendingResizes
 * if not present. Update the shape & broadcast.
 */
export function handleElementResize(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y, w, h } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (!lockIfPossible(el, userId)) {
    return;
  }

  // If not present, store original pos in pendingResizes
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

  // Update
  el.x = x;
  el.y = y;
  el.w = w;
  el.h = h;

  broadcastElementState(session);
}

/**
 * handleElementResizeEnd => finalize multi-element transform for all shapes
 * that the user was resizing, push a single 'resize' action if changes occurred.
 */
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
    // Clean up
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
