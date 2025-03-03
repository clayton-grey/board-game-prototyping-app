// ./server/ws/handlers/undoRedoHandlers.js
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { broadcastElementState } from '../collabUtils.js';
import { sessionGuard } from './handlerUtils.js';

/**
 * pushUndoAction:
 *  - Clears the redoStack
 *  - Appends this action to the undoStack
 */
export function pushUndoAction(session, action) {
  session.redoStack = [];
  session.undoStack.push(action);
  // Optional cap to avoid huge stack
  if (session.undoStack.length > 50) {
    session.undoStack.shift();
  }
}

/**
 * handleUndo:
 *  - Finalizes any pending moves for the user
 *  - Pops the last action from undoStack if present
 *  - Reverts it (if possible)
 *  - Pushes it onto redoStack
 */
export const handleUndo = sessionGuard((session, data, ws) => {
  const { userId } = data;

  // First finalize any partial moves/resizes for this user
  finalizeAllPendingMovesForUser(session, userId);
  finalizeAllPendingResizesForUser(session, userId);

  if (session.undoStack.length === 0) {
    return;
  }

  const action = session.undoStack[session.undoStack.length - 1];
  if (!canApplyAction(session, action, userId)) {
    ws.send(
      JSON.stringify({
        type: MESSAGE_TYPES.UNDO_REDO_FAILED,
        reason: 'Element locked by another user or concurrency issue.',
      })
    );
    return;
  }

  session.undoStack.pop();
  revertAction(session, action);
  session.redoStack.push(action);

  broadcastElementState(session);
});

/**
 * handleRedo:
 *  - Finalizes any pending moves/resizes for the user
 *  - Pops the last undone action from redoStack
 *  - Re-applies it (if possible)
 *  - Pushes it onto undoStack
 */
export const handleRedo = sessionGuard((session, data, ws) => {
  const { userId } = data;

  // First finalize any partial moves/resizes for this user
  finalizeAllPendingMovesForUser(session, userId);
  finalizeAllPendingResizesForUser(session, userId);

  if (session.redoStack.length === 0) {
    return;
  }

  const action = session.redoStack[session.redoStack.length - 1];
  if (!canApplyAction(session, action, userId)) {
    ws.send(
      JSON.stringify({
        type: MESSAGE_TYPES.UNDO_REDO_FAILED,
        reason: 'Element locked by another user or concurrency issue.',
      })
    );
    return;
  }

  session.redoStack.pop();
  applyAction(session, action);
  session.undoStack.push(action);

  broadcastElementState(session);
});

/**
 * In some workflows, we want to ensure partial moves are consolidated
 * before an undo/redo. The new approach is to rely on finalization in
 * element release/deselect. However, if someone hits undo *while still
 * dragging*, we can also finalize them here to avoid confusion.
 */
function finalizeAllPendingMovesForUser(session, userId) {
  if (!session.pendingMoves) return;
  const diffs = [];
  for (const [elementId, moveData] of session.pendingMoves.entries()) {
    if (moveData.userId !== userId) continue;
    const el = session.elements.find(e => e.id === elementId);
    session.pendingMoves.delete(elementId);
    if (!el) continue;

    const oldX = moveData.oldX;
    const oldY = moveData.oldY;
    const newX = el.x;
    const newY = el.y;

    if (oldX !== newX || oldY !== newY) {
      diffs.push({
        elementId,
        from: { x: oldX, y: oldY },
        to: { x: newX, y: newY },
      });
    }
  }
  if (diffs.length > 0) {
    const action = { type: 'move', diffs };
    pushUndoAction(session, action);
  }
}

function finalizeAllPendingResizesForUser(session, userId) {
  if (!session.pendingResizes) return;
  const userMap = session.pendingResizes.get(userId);
  if (!userMap) return;

  const diffs = [];
  for (const [elementId, original] of userMap.entries()) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) continue;

    if (original.x !== el.x || original.y !== el.y ||
        original.w !== el.w || original.h !== el.h) {
      diffs.push({
        elementId,
        from: { ...original },
        to: { x: el.x, y: el.y, w: el.w, h: el.h },
      });
    }
  }
  // Clear that map
  session.pendingResizes.delete(userId);

  if (diffs.length > 0) {
    const action = { type: 'resize', diffs };
    pushUndoAction(session, action);
  }
}

/** Returns false if any element is locked by another user. */
function canApplyAction(session, action, userId) {
  if (!action?.diffs || !Array.isArray(action.diffs)) return true;
  if (!['move','create','delete','resize'].includes(action.type)) return true;

  for (const diff of action.diffs) {
    const elId = action.type === 'delete' ? diff.id : diff.elementId;
    const el = session.elements.find(e => e.id === elId);
    if (!el) continue; // might be deleted
    if (el.lockedBy && el.lockedBy !== userId) {
      return false;
    }
  }
  return true;
}

function applyAction(session, action) {
  switch (action.type) {
    case 'move':
      for (const diff of action.diffs) {
        const el = session.elements.find(e => e.id === diff.elementId);
        if (!el) continue;
        el.x = diff.to.x;
        el.y = diff.to.y;
      }
      break;

    case 'create':
      // Redo a creation => re-add if missing
      for (const diff of action.diffs) {
        const existing = session.elements.find(e => e.id === diff.elementId);
        if (!existing) {
          session.elements.push({
            id: diff.elementId,
            shape: diff.shape,
            x: diff.x,
            y: diff.y,
            w: diff.w,
            h: diff.h,
            lockedBy: null,
          });
        }
      }
      break;

    case 'delete':
      // Redo a delete => remove them
      for (const d of action.diffs) {
        const idx = session.elements.findIndex(e => e.id === d.id);
        if (idx >= 0) {
          session.elements.splice(idx, 1);
        }
      }
      break;

    case 'resize':
      for (const diff of action.diffs) {
        const el = session.elements.find(e => e.id === diff.elementId);
        if (!el) continue;
        el.x = diff.to.x;
        el.y = diff.to.y;
        el.w = diff.to.w;
        el.h = diff.to.h;
      }
      break;
    default:
      break;
  }
}

function revertAction(session, action) {
  switch (action.type) {
    case 'move':
      for (const diff of action.diffs) {
        const el = session.elements.find(e => e.id === diff.elementId);
        if (!el) continue;
        el.x = diff.from.x;
        el.y = diff.from.y;
      }
      break;

    case 'create':
      // Undo create => remove them
      for (const diff of action.diffs) {
        const idx = session.elements.findIndex(e => e.id === diff.elementId);
        if (idx >= 0) {
          session.elements.splice(idx, 1);
        }
      }
      break;

    case 'delete':
      // Undo a delete => re-add them
      for (const d of action.diffs) {
        const exists = session.elements.find(e => e.id === d.id);
        if (!exists) {
          session.elements.push({
            id: d.id,
            shape: d.shape,
            x: d.x,
            y: d.y,
            w: d.w,
            h: d.h,
            lockedBy: null,
          });
        }
      }
      break;

    case 'resize':
      for (const diff of action.diffs) {
        const el = session.elements.find(e => e.id === diff.elementId);
        if (!el) continue;
        el.x = diff.from.x;
        el.y = diff.from.y;
        el.w = diff.from.w;
        el.h = diff.from.h;
      }
      break;

    default:
      break;
  }
}
