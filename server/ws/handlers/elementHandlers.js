// ./server/ws/handlers/elementHandlers.js
import { broadcastElementState } from '../collabUtils.js';
import { pushUndoAction } from './undoRedoHandlers.js';

/**
 * In this refactored approach, we use session.pendingResizes (similar to pendingMoves)
 * for multi-shape resizing. When the user first calls ELEMENT_RESIZE for a shape,
 * we store its original (x,y,w,h) if not already stored. We continuously update the shape.
 * Then, on ELEMENT_RESIZE_END, we finalize a single group action for all changed shapes.
 *
 * We thus avoid any global __groupResizes. Everything is in session-based data.
 */

/** Ensures session.pendingResizes is ready. */
function ensurePendingResizes(session) {
  if (!session.pendingResizes) {
    // userId -> { elementId -> { x, y, w, h } }
    session.pendingResizes = new Map();
  }
}

/** Return (and possibly create) the map for a given user’s pending resizes. */
function getUserResizeMap(session, userId) {
  ensurePendingResizes(session);
  let userMap = session.pendingResizes.get(userId);
  if (!userMap) {
    userMap = new Map();
    session.pendingResizes.set(userId, userMap);
  }
  return userMap;
}

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

  broadcastElementState(session);
}

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

export function handleElementRelease(session, data, ws) {
  if (!session) return;
  const { userId, elementId } = data;

  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (el.lockedBy === userId) {
    // (No special finalize logic for simple moves in this code,
    //  but you could create an undo action here if you prefer.)
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

export function handleElementDelete(session, data, ws) {
  if (!session) return;
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds) || elementIds.length === 0) return;

  const toDelete = [];
  for (const id of elementIds) {
    const idx = session.elements.findIndex(e => e.id === id);
    if (idx >= 0) {
      const el = session.elements[idx];
      if (el.lockedBy && el.lockedBy !== userId) {
        continue; // locked by someone else => skip
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
 * handleElementResize => user is dragging a shape corner/edge.
 * If shape is not locked, auto-lock it. Then store the shape’s original (x,y,w,h)
 * in session.pendingResizes if not already stored. Update the shape, broadcast.
 */
export function handleElementResize(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y, w, h } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // If locked by someone else, do nothing
  if (el.lockedBy && el.lockedBy !== userId) {
    return;
  }
  // If not locked, auto-lock it to this user
  if (!el.lockedBy) {
    el.lockedBy = userId;
  }

  // Store original position if not already in pendingResizes
  const userMap = getUserResizeMap(session, userId);
  if (!userMap.has(elementId)) {
    userMap.set(elementId, {
      x: el.x, y: el.y, w: el.w, h: el.h,
    });
  }

  // Update the shape
  el.x = x;
  el.y = y;
  el.w = w;
  el.h = h;

  broadcastElementState(session);
}

/**
 * handleElementResizeEnd => finalize multi-element transform. We gather all shapes that
 * user was resizing, see which ones actually changed, push a single 'resize' undo action,
 * and then clear them from session.pendingResizes.
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
    if (!original) {
      continue; // no original stored => no diff
    }
    // Check if there's an actual change
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

    // Clean up the stored pending data
    userMap.delete(elementId);
  }

  // If userMap is now empty, remove it from session
  if (userMap.size === 0) {
    session.pendingResizes.delete(userId);
  }

  // If any changes, push a single group 'resize' action
  if (diffs.length > 0) {
    const action = {
      type: 'resize',
      diffs,
    };
    pushUndoAction(session, action);
  }

  broadcastElementState(session);
}
