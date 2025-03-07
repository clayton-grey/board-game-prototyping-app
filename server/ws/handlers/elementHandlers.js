// ./server/ws/handlers/elementHandlers.js
import { broadcastElementState } from "../collabUtils.js";
import { pushUndoAction } from "./undoRedoHandlers.js";
import { sessionGuard } from "./handlerUtils.js";

function isElementLockedByOthers(element, userId) {
  return element.lockedBy && element.lockedBy !== userId;
}

// Finalize all pending moves for user ...
function finalizeAllPendingMovesForUser(session, userId) {
  if (!session.pendingMoves) return;
  const diffs = [];

  for (const [elId, moveData] of session.pendingMoves.entries()) {
    if (moveData.userId !== userId) continue;

    const el = session.elements.find((e) => e.id === elId);
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

// Finalize all pending resizes ...
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
    const action = { type: "resize", diffs };
    pushUndoAction(session, action);
  }
}

/**
 * NEW: finalizeAllPendingRotationsForUser
 * Similar approach: gather "from->to" angle diffs and push to undo stack.
 */
function finalizeAllPendingRotationsForUser(session, userId) {
  if (!session.pendingRotations) return;
  const userMap = session.pendingRotations.get(userId);
  if (!userMap) return;

  const diffs = [];
  for (const [elId, originalAngle] of userMap.entries()) {
    const el = session.elements.find((e) => e.id === elId);
    if (!el) continue;

    if (el.angle !== originalAngle) {
      diffs.push({
        elementId: elId,
        fromAngle: originalAngle,
        toAngle: el.angle,
      });
    }
  }
  userMap.clear();
  session.pendingRotations.delete(userId);

  if (diffs.length > 0) {
    const action = { type: "rotate", diffs };
    pushUndoAction(session, action);
  }
}

export const handleElementGrab = sessionGuard((session, data, ws) => {
  const { userId, elementId } = data;
  finalizeAllPendingResizesForUser(session, userId);
  finalizeAllPendingRotationsForUser(session, userId);

  const el = session.elements.find((e) => e.id === elementId);
  if (!el) return;

  if (isElementLockedByOthers(el, userId)) return;
  el.lockedBy = userId;
  broadcastElementState(session);
});

export const handleElementMove = sessionGuard((session, data, ws) => {
  const { userId, elementId, x, y } = data;

  finalizeAllPendingResizesForUser(session, userId);
  finalizeAllPendingRotationsForUser(session, userId);

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

  // finalize moves only
  finalizeAllPendingMovesForUser(session, userId);
  // we do NOT unlock the element here by design
  broadcastElementState(session);
});

export const handleElementDeselect = sessionGuard((session, data, ws) => {
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds)) return;

  finalizeAllPendingMovesForUser(session, userId);
  finalizeAllPendingResizesForUser(session, userId);
  finalizeAllPendingRotationsForUser(session, userId);

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

  finalizeAllPendingMovesForUser(session, userId);
  finalizeAllPendingResizesForUser(session, userId);
  finalizeAllPendingRotationsForUser(session, userId);

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
    angle: 0, // NEW: default angle
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

  finalizeAllPendingMovesForUser(session, userId);
  finalizeAllPendingResizesForUser(session, userId);
  finalizeAllPendingRotationsForUser(session, userId);

  const toDelete = [];
  for (const id of elementIds) {
    const idx = session.elements.findIndex((e) => e.id === id);
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

  finalizeAllPendingMovesForUser(session, userId);
  finalizeAllPendingRotationsForUser(session, userId);

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
  finalizeAllPendingResizesForUser(session, userId);
  broadcastElementState(session);
});

/* ------------------------------------------------------------------
   NEW: Rotation Handlers
------------------------------------------------------------------ */
export const handleElementRotate = sessionGuard((session, data, ws) => {
  const { userId, elementId, angle } = data;
  console.log(userId, elementId, angle);
  // finalize moves/resizes so they don't merge
  finalizeAllPendingMovesForUser(session, userId);
  finalizeAllPendingResizesForUser(session, userId);

  const el = session.elements.find((e) => e.id === elementId);
  if (!el) return;
  if (isElementLockedByOthers(el, userId)) return;

  // auto-lock if not locked
  if (!el.lockedBy) {
    el.lockedBy = userId;
  }
  if (el.lockedBy !== userId) return;

  if (!session.pendingRotations) {
    session.pendingRotations = new Map();
  }
  let userMap = session.pendingRotations.get(userId);
  if (!userMap) {
    userMap = new Map();
    session.pendingRotations.set(userId, userMap);
  }
  if (!userMap.has(elementId)) {
    userMap.set(elementId, el.angle); // store original angle
  }

  // update element's angle
  el.angle = angle;
  broadcastElementState(session);
});

export const handleElementRotateEnd = sessionGuard((session, data, ws) => {
  const { userId, elementIds } = data;
  if (!Array.isArray(elementIds) || elementIds.length === 0) {
    broadcastElementState(session);
    return;
  }
  // finalize rotation diffs into an undo action
  finalizeAllPendingRotationsForUser(session, userId);
  broadcastElementState(session);
});
