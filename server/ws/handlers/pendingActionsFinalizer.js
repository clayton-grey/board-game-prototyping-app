// =========================
// FILE: server/ws/handlers/pendingActionsFinalizer.js
// =========================

import { pushUndoAction } from './undoRedoHandlers.js';

/**
 * finalizePendingMovesForUser(session, userId, isUndoRedo=false)
 *  - Finds all pending moves for the given user that are no longer locked
 *    and pushes an undo action if they changed position.
 *  - If `isUndoRedo` is true, we skip the pushUndoAction (because undoRedo flow
 *    might handle it differently). Typically used by elementHandlers.
 */
export function finalizePendingMovesForUser(session, userId, isUndoRedo = false) {
  if (!session.pendingMoves) {
    session.pendingMoves = new Map();
    return;
  }
  const diffs = [];

  for (const [elementId, moveData] of session.pendingMoves.entries()) {
    if (moveData.userId !== userId) continue;
    const el = session.elements.find(e => e.id === elementId);
    // If the element was deleted or does not exist anymore, remove from map
    if (!el) {
      session.pendingMoves.delete(elementId);
      continue;
    }
    // Only finalize if user no longer locks it:
    if (el.lockedBy === userId) {
      continue;
    }
    // Otherwise finalize
    const oldX = moveData.oldX;
    const oldY = moveData.oldY;
    const newX = el.x;
    const newY = el.y;
    session.pendingMoves.delete(elementId);

    if (oldX !== newX || oldY !== newY) {
      diffs.push({
        elementId,
        from: { x: oldX, y: oldY },
        to: { x: newX, y: newY },
      });
    }
  }

  if (diffs.length > 0 && !isUndoRedo) {
    const action = { type: 'move', diffs };
    pushUndoAction(session, action);
  }
}

/**
 * finalizePendingResizesForUser(session, userId, isUndoRedo=false)
 *  - Similar logic for resizes. 
 *  - If `isUndoRedo` is false, we push an undo action immediately.
 */
export function finalizePendingResizesForUser(session, userId, isUndoRedo = false) {
  if (!session.pendingResizes) return;
  const userMap = session.pendingResizes.get(userId);
  if (!userMap) return;

  const diffs = [];
  for (const [elementId, original] of userMap.entries()) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) continue;
    if (
      original.x !== el.x ||
      original.y !== el.y ||
      original.w !== el.w ||
      original.h !== el.h
    ) {
      diffs.push({
        elementId,
        from: { ...original },
        to: { x: el.x, y: el.y, w: el.w, h: el.h },
      });
    }
  }
  session.pendingResizes.delete(userId);

  if (diffs.length > 0 && !isUndoRedo) {
    const action = { type: 'resize', diffs };
    pushUndoAction(session, action);
  }
}
