// =========================
// FILE: server/ws/handlers/elementHandlers.js
// =========================

import { broadcastElementState } from "../collabUtils.js";
import { pushUndoAction } from "./undoRedoHandlers.js";
import { sessionGuard } from "./handlerUtils.js";

/** Helper to check if element is locked by another user. */
function isElementLockedByOthers(element, userId) {
  return element.lockedBy && element.lockedBy !== userId;
}

/**
 * finalizeAllPendingMovesForUser:
 *  - For every entry in session.pendingMoves belonging to userId,
 *    create a "move" diff if the element's current position is different
 *    from the old position, then push a single "move" action.
 *  - Clears those entries from session.pendingMoves so they won't be combined.
 */
function finalizeAllPendingMovesForUser(session, userId) {
  if (!session.pendingMoves) return;
  const diffs = [];

  for (const [elId, moveData] of session.pendingMoves.entries()) {
    if (moveData.userId !== userId) continue;

    const el = session.elements.find((e) => e.id === elId);
    // remove from map
    session.pendingMoves.delete(elId);

    if (!el) continue;
    const changed = el.x !== moveData.oldX || el.y !== moveData.oldY;
    if (changed) {
      diffs.push({
        elementId: elId,
        from: { x: moveData.oldX, y: moveData.oldY },
        to: { x: el.x, y: el.y },
      });
    }
  }
  if (diffs.length > 0) {
    const action = { type: "move", diffs };
    pushUndoAction(session, action);
  }
}

/**
 * finalizeAllPendingResizesForUser:
 *  - Looks up the userMap in session.pendingResizes
 *  - For each element, if it has changed size/pos from original => create a diff.
 *  - Then push one "resize" action.
 *  - Clears userMap from session.pendingResizes.
 */
function finalizeAllPendingResizesForUser(session, userId) {
  if (!session.pendingResizes) return;
  const userMap = session.pendingResizes.get(userId);
  if (!userMap) return;

  const diffs = [];
  for (const [elId, original] of userMap.entries()) {
    const el = session.elements.find((e) => e.id === elId);
    if (!el) continue;

    const changed =
      el.x !== original.x ||
      el.y !== original.y ||
      el.w !== original.w ||
      el.h !== original.h;
    if (changed) {
      diffs.push({
        elementId: elId,
        from: { ...original },
        to: { x: el.x, y: el.y, w: el.w, h: el.h },
      });
    }
  }
  userMap.clear();
  session.pendingResizes.delete(userId);

  if (diffs.length > 0) {
    const action = {
      type: "resize",
      diffs,
    };
    pushUndoAction(session, action);
  }
}

export const handleElementGrab = sessionGuard((session, data, ws) => {
  const { userId, elementId } = data;

  // If user was previously resizing but never ended, finalize it,
  // so we don't merge a move operation with a partial resize.
  finalizeAllPendingResizesForUser(session, userId);

  const el = session.elements.find((e) => e.id === elementId);
  if (!el) return;

  if (isElementLockedByOthers(el, userId)) return;
  el.lockedBy = userId;
  broadcastElementState(session);
});

export const handleElementMove = sessionGuard((session, data, ws) => {
  const { userId, elementId, x, y } = data;

  // Switching from a resize to a move => finalize any partial resizes
  finalizeAllPendingResizesForUser(session, userId);

  const el = session.elements.find((e) => e.id === elementId);
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
  const { userId } = data;

  // On pointer up for a move => finalize all pending moves for this user
  finalizeAllPendingMovesForUser(session, userId);

  // We intentionally do NOT unlock the element here.
  // This allows the user to continue a subsequent operation (like resize)
  // without re-selecting. If you prefer to unlock on pointer-up, re-add:
  //
  //   const el = session.elements.find((e) => e.id === elementId);
  //   if (el && el.lockedBy === userId) {
  //     el.lockedBy = null;
  //   }

  broadcastElementState(session);
});

export const handleElementDeselect = sessionGuard((session, data, ws) => {
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds)) return;

  // Finalize any moves for user
  finalizeAllPendingMovesForUser(session, userId);
  // Also finalize any resizes for user
  finalizeAllPendingResizesForUser(session, userId);

  // Unlock all requested elements
  for (const elementId of elementIds) {
    const el = session.elements.find((e) => e.id === elementId);
    if (el && el.lockedBy === userId) {
      el.lockedBy = null;
    }
  }
  broadcastElementState(session);
});

export const handleElementCreate = sessionGuard((session, data, ws) => {
  const { userId, shape, x, y, w, h } = data;
  if (!userId || !shape) return;

  // If user had a pending move or resize, finalize them first
  finalizeAllPendingMovesForUser(session, userId);
  finalizeAllPendingResizesForUser(session, userId);

  let maxId = 0;
  for (const e of session.elements) {
    if (e.id > maxId) maxId = e.id;
  }
  const newId = maxId + 1;

  const newElement = {
    id: newId,
    shape,
    x,
    y,
    w,
    h,
    lockedBy: userId,
  };
  session.elements.push(newElement);

  const action = {
    type: "create",
    diffs: [
      {
        elementId: newId,
        shape,
        x,
        y,
        w,
        h,
      },
    ],
  };
  pushUndoAction(session, action);

  broadcastElementState(session);
});

export const handleElementDelete = sessionGuard((session, data, ws) => {
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds) || elementIds.length === 0) return;

  // If user had a pending move or resize, finalize them
  finalizeAllPendingMovesForUser(session, userId);
  finalizeAllPendingResizesForUser(session, userId);

  const toDelete = [];
  for (const id of elementIds) {
    const idx = session.elements.findIndex((e) => e.id === id);
    if (idx >= 0) {
      const el = session.elements[idx];
      if (isElementLockedByOthers(el, userId)) {
        continue; // skip locked by another user
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
    type: "delete",
    diffs: toDelete.map((el) => ({
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

  // Switching from a move to a resize => finalize any partial moves
  finalizeAllPendingMovesForUser(session, userId);

  const el = session.elements.find((e) => e.id === elementId);
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

  // finalize all resizes for this user
  finalizeAllPendingResizesForUser(session, userId);

  // We do NOT unlock the elements here,
  // so the user can continue to move them without reselecting.
  // If you want them unlocked, you can do so here, but that would require reselecting.

  broadcastElementState(session);
});
