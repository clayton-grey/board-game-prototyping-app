// ./server/ws/handlers/elementHandlers.js
import { broadcastElementState } from '../collabUtils.js';

/**
 * 1) handleElementGrab:
 *   - If the element is unlocked or locked by the same user, lock it.
 *   - If not in pendingMoves, store oldX,oldY for undo.
 */
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

  // If we do not have a pending record, store old position
  if (!session.pendingMoves.has(elementId)) {
    session.pendingMoves.set(elementId, {
      userId,
      oldX: el.x,
      oldY: el.y,
    });
  }

  broadcastElementState(session);
}

/**
 * 2) handleElementMove:
 *   - If locked by me, update position in real time.
 */
export function handleElementMove(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y } = data;

  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (el.lockedBy === userId) {
    el.x = x;
    el.y = y;
    broadcastElementState(session);
  }
}

/**
 * 3) handleElementRelease:
 *   - Finalizes the move in the undo stack so user can immediately Undo.
 *   - We do NOT unlock => user keeps the lock until they explicitly deselect.
 */
export function handleElementRelease(session, data, ws) {
  if (!session) return;
  const { userId, elementId } = data;

  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  if (el.lockedBy === userId) {
    finalizePendingMove(session, elementId, userId);
    // Notice: we do NOT do "el.lockedBy = null" => user remains lock holder
    broadcastElementState(session);
  }
}

/**
 * 4) handleElementDeselect:
 *   - The user is removing one or more elements from their selection,
 *     so we free the lock for each.
 *   - If they had a partial/pending move, we finalize it first so it doesn't get lost.
 */
export function handleElementDeselect(session, data, ws) {
  if (!session) return;
  const { userId, elementIds } = data; 
  // elementIds is an array of items the user is deselecting.

  if (!Array.isArray(elementIds)) return;

  elementIds.forEach((elementId) => {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) return;

    // If locked by me, finalize & unlock
    if (el.lockedBy === userId) {
      finalizePendingMove(session, elementId, userId);
      el.lockedBy = null; 
    }
  });

  broadcastElementState(session);
}

/**
 * finalizePendingMove => if there's a record in pendingMoves for (elementId,userId),
 * we create a "move" action in undoStack and remove pendingMoves entry.
 */
function finalizePendingMove(session, elementId, userId) {
  const pending = session.pendingMoves.get(elementId);
  if (!pending || pending.userId !== userId) {
    return;
  }

  const el = session.elements.find(e => e.id === elementId);
  session.pendingMoves.delete(elementId);
  if (!el) return;

  const oldX = pending.oldX;
  const oldY = pending.oldY;
  const newX = el.x;
  const newY = el.y;
  if (oldX === newX && oldY === newY) {
    return; // no actual movement
  }

  // Clear redo stack because we have a new action
  session.redoStack = [];

  const action = {
    type: 'move',
    diffs: [
      {
        elementId,
        from: { x: oldX, y: oldY },
        to: { x: newX, y: newY },
      },
    ],
  };
  session.undoStack.push(action);
  if (session.undoStack.length > 50) {
    session.undoStack.shift();
  }
}
