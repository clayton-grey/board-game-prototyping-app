// ./server/ws/handlers/elementHandlers.js
import { broadcastElementState } from '../collabUtils.js';
import { pushUndoAction } from './undoRedoHandlers.js';

/**
 * In this updated approach, we store multi-element transforms as a single group action.
 * We no longer finalize each shape's resize individually. Instead, we:
 * 1) track the first time user resizes a shape => we store "old positions" if not stored
 * 2) update shape positions in real time
 * 3) on ELEMENT_RESIZE_END => create a single "resize" action with diffs for all shapes
 */

if (!global.__groupResizes) {
  // userId -> { [elementId]: { x, y, w, h } }
  // On first 'ELEMENT_RESIZE' from user, we store old positions for each shape if not present
  // Then at 'ELEMENT_RESIZE_END', we finalize as a single group action
  global.__groupResizes = new Map();
}

function getUserGroupResize(userId) {
  let gr = global.__groupResizes.get(userId);
  if (!gr) {
    gr = {};
    global.__groupResizes.set(userId, gr);
  }
  return gr;
}

function clearUserGroupResize(userId) {
  global.__groupResizes.delete(userId);
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
    // If you want a single-step for moves, you can finalize here (like old approach),
    // but let's keep it the same for moves. We'll do a "release" if you want.
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
    lockedBy: userId, // automatically lock?
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

/** Called repeatedly as user drags to resize shapes. We store the original position in a user-based groupResizes object. */
export function handleElementResize(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y, w, h } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (el.lockedBy && el.lockedBy !== userId) {
    return;
  }
  // If not locked, automatically lock
  if (!el.lockedBy) {
    el.lockedBy = userId;
  }

  // Start / Update the group-resize record for this user
  const group = getUserGroupResize(userId);
  if (!group[elementId]) {
    // store old position the first time we see it
    group[elementId] = { x: el.x, y: el.y, w: el.w, h: el.h };
  }

  // now update the shape
  el.x = x;
  el.y = y;
  el.w = w;
  el.h = h;

  broadcastElementState(session);
}

/**
 * Finalize multi-element transform: create a single 'resize' action
 * with diffs for all shapes that changed.
 */
export function handleElementResizeEnd(session, data, ws) {
  if (!session) return;
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds) || elementIds.length === 0) return;

  const group = getUserGroupResize(userId);
  if (!group) {
    // no group data => nothing to finalize
    return broadcastElementState(session);
  }

  const diffs = [];
  for (const elementId of elementIds) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) continue;
    if (el.lockedBy !== userId) continue; // skip shapes not locked

    // If we never stored an old position, skip
    const oldPos = group[elementId];
    if (!oldPos) {
      continue;
    }
    // If no real changes, skip
    if (
      oldPos.x === el.x &&
      oldPos.y === el.y &&
      oldPos.w === el.w &&
      oldPos.h === el.h
    ) {
      continue;
    }
    diffs.push({
      elementId,
      from: { x: oldPos.x, y: oldPos.y, w: oldPos.w, h: oldPos.h },
      to: { x: el.x, y: el.y, w: el.w, h: el.h },
    });
  }

  // If no actual diffs, do nothing
  if (diffs.length > 0) {
    const action = {
      type: 'resize',
      diffs,
    };
    pushUndoAction(session, action);
  }

  // Clean up group data, unlock shapes if desired
  clearUserGroupResize(userId);
  for (const elementId of elementIds) {
    const el = session.elements.find(e => e.id === elementId);
    if (el && el.lockedBy === userId) {
      // Decide if you want to auto-unlock them:
      // el.lockedBy = null; 
    }
  }

  broadcastElementState(session);
}
