// ./server/ws/handlers/elementHandlers.js
import { broadcastElementState } from '../collabUtils.js';
import { pushUndoAction } from './undoRedoHandlers.js';

/**
 * Helper to check if element is locked by another user.
 */
function isElementLockedByOthers(element, userId) {
  return element.lockedBy && element.lockedBy !== userId;
}

/**
 * handleElementGrab => locks element if not locked or locked by self.
 */
export function handleElementGrab(session, data, ws) {
  if (!session) return;
  const { userId, elementId } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // If locked by someone else, do nothing
  if (isElementLockedByOthers(el, userId)) {
    return;
  }
  // Otherwise, lock it to me
  el.lockedBy = userId;
  broadcastElementState(session);
}

/**
 * handleElementMove => moves the element if locked by user.
 */
export function handleElementMove(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y } = data;

  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // Must be locked by this user
  if (el.lockedBy === userId) {
    el.x = x;
    el.y = y;
    broadcastElementState(session);
  }
}

/**
 * handleElementRelease => does nothing except broadcast if locked by same user.
 * (Could be used to finalize a move, but not mandatory.)
 */
export function handleElementRelease(session, data, ws) {
  if (!session) return;
  const { userId, elementId } = data;

  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (el.lockedBy === userId) {
    broadcastElementState(session);
  }
}

/**
 * handleElementDeselect => unlocks elements if locked by user.
 */
export function handleElementDeselect(session, data, ws) {
  if (!session) return;
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds)) return;

  for (const elementId of elementIds) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) continue;
    if (el.lockedBy === userId) {
      el.lockedBy = null;
    }
  }
  broadcastElementState(session);
}

/**
 * handleElementCreate => pushes a new element locked by user, calls pushUndoAction.
 */
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
    lockedBy: userId, // automatically lock to the creator
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

/**
 * handleElementDelete => removes elements locked by user, creates undo action.
 */
export function handleElementDelete(session, data, ws) {
  if (!session) return;
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds) || elementIds.length === 0) return;

  const toDelete = [];
  for (const id of elementIds) {
    const idx = session.elements.findIndex(e => e.id === id);
    if (idx >= 0) {
      const el = session.elements[idx];
      // skip if locked by someone else
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
}

/**
 * handleElementResize => if not locked, auto-lock, store original pos in session.pendingResizes, updates element.
 */
export function handleElementResize(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y, w, h } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // If locked by someone else, do nothing
  if (isElementLockedByOthers(el, userId)) {
    return;
  }
  // If not locked, auto-lock it
  if (!el.lockedBy) {
    el.lockedBy = userId;
  }

  // store original position if not already stored
  if (!session.pendingResizes) {
    session.pendingResizes = new Map();
  }
  let userMap = session.pendingResizes.get(userId);
  if (!userMap) {
    userMap = new Map();
    session.pendingResizes.set(userId, userMap);
  }
  if (!userMap.has(elementId)) {
    userMap.set(elementId, {
      x: el.x,
      y: el.y,
      w: el.w,
      h: el.h,
    });
  }

  // update shape
  el.x = x;
  el.y = y;
  el.w = w;
  el.h = h;

  broadcastElementState(session);
}

/**
 * handleElementResizeEnd => finalize multi-element transform. We gather all shapes that
 * user was resizing, check diffs, push a single 'resize' action, then clear them.
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
    // must be locked by user
    if (el.lockedBy !== userId) continue;

    const original = userMap.get(elementId);
    if (!original) {
      continue; // no original stored => no diff
    }
    // check if there's an actual change
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

  // if userMap is empty, remove it
  if (userMap.size === 0) {
    session.pendingResizes.delete(userId);
  }

  // if changes, push a single 'resize' undo action
  if (diffs.length > 0) {
    const action = {
      type: 'resize',
      diffs,
    };
    pushUndoAction(session, action);
  }

  broadcastElementState(session);
}
