// ./server/ws/handlers/undoRedoHandlers.js
import { WebSocket } from 'ws';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { broadcastElementState } from '../collabUtils.js';

/**
 * handleUndo:
 *   - 1) finalize any pending moves for this user
 *   - 2) revert the top item in undoStack if concurrency checks pass
 */
export function handleUndo(session, data, ws) {
  if (!session) return;
  const { userId } = data;

  finalizeAllPendingMovesForUser(session, userId);

  if (session.undoStack.length === 0) {
    return; // no action to undo
  }

  const action = session.undoStack[session.undoStack.length - 1];
  if (!canApplyAction(session, action, userId)) {
    ws.send(JSON.stringify({
      type: MESSAGE_TYPES.UNDO_REDO_FAILED,
      reason: 'Element locked by another user or concurrency issue.',
    }));
    return;
  }

  // Remove from undo
  session.undoStack.pop();
  revertAction(session, action);

  // Add to redo
  session.redoStack.push(action);

  broadcastElementState(session);
}

/**
 * handleRedo:
 *   - 1) finalize leftover moves for user
 *   - 2) re-apply top item in redoStack if concurrency checks pass
 */
export function handleRedo(session, data, ws) {
  if (!session) return;
  const { userId } = data;

  finalizeAllPendingMovesForUser(session, userId);

  if (session.redoStack.length === 0) {
    return; // nothing to redo
  }

  const action = session.redoStack[session.redoStack.length - 1];
  if (!canApplyAction(session, action, userId)) {
    ws.send(JSON.stringify({
      type: MESSAGE_TYPES.UNDO_REDO_FAILED,
      reason: 'Element locked by another user or concurrency issue.',
    }));
    return;
  }

  session.redoStack.pop();
  applyAction(session, action);

  session.undoStack.push(action);

  broadcastElementState(session);
}

/**
 * finalizeAllPendingMovesForUser:
 *   - for any pendingMoves that belong to userId, we finalize them
 *     as undoStack actions
 */
function finalizeAllPendingMovesForUser(session, userId) {
  const toFinalize = [];
  for (const [elementId, pending] of session.pendingMoves.entries()) {
    if (pending.userId === userId) {
      toFinalize.push(elementId);
    }
  }

  for (const elementId of toFinalize) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) {
      session.pendingMoves.delete(elementId);
      continue;
    }
    const pending = session.pendingMoves.get(elementId);
    if (!pending) continue;

    const oldX = pending.oldX;
    const oldY = pending.oldY;
    const newX = el.x;
    const newY = el.y;
    session.pendingMoves.delete(elementId);

    if (oldX === newX && oldY === newY) {
      continue; // no actual move
    }

    // Clear redo since we have a new action
    session.redoStack = [];

    const action = {
      type: 'move',
      diffs: [
        {
          elementId,
          from: { x: oldX, y: oldY },
          to: { x: newX, y: newY },
        }
      ],
    };
    session.undoStack.push(action);
    if (session.undoStack.length > 50) {
      session.undoStack.shift();
    }
  }
}

/**
 * canApplyAction: 
 *   - If an element is locked by another user, we reject the undo/redo
 *   - If locked by the same user or unlocked => allow
 */
function canApplyAction(session, action, userId) {
  if (action.type === 'move') {
    for (const diff of action.diffs) {
      const el = session.elements.find(e => e.id === diff.elementId);
      if (!el) continue;

      if (el.lockedBy && el.lockedBy !== userId) {
        return false; // locked by someone else => fail
      }
    }
  }
  return true;
}

/**
 * applyAction => set x,y to 'to'
 * revertAction => set x,y to 'from'
 * We do NOT unlock or alter lockedBy.
 */
function applyAction(session, action) {
  if (action.type === 'move') {
    for (const diff of action.diffs) {
      const el = session.elements.find(e => e.id === diff.elementId);
      if (!el) continue;
      el.x = diff.to.x;
      el.y = diff.to.y;
    }
  }
}

function revertAction(session, action) {
  if (action.type === 'move') {
    for (const diff of action.diffs) {
      const el = session.elements.find(e => e.id === diff.elementId);
      if (!el) continue;
      el.x = diff.from.x;
      el.y = diff.from.y;
    }
  }
}
