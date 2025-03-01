// ./server/ws/handlers/undoRedoHandlers.js
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { broadcastElementState } from '../collabUtils.js';

/**
 * A helper to push an action onto the undo stack,
 * clearing the redo stack and limiting size.
 */
export function pushUndoAction(session, action) {
  session.redoStack = [];
  session.undoStack.push(action);
  if (session.undoStack.length > 50) {
    session.undoStack.shift();
  }
}

export function handleUndo(session, data, ws) {
  if (!session) return;
  const { userId } = data;

  finalizeAllPendingMovesForUser(session, userId);
  // We no longer do finalizeAllPendingResizesForUser here — resizing is
  // finalized by handleElementResizeEnd.

  if (session.undoStack.length === 0) {
    return;
  }

  const action = session.undoStack[session.undoStack.length - 1];
  if (!canApplyAction(session, action, userId)) {
    ws.send(JSON.stringify({
      type: MESSAGE_TYPES.UNDO_REDO_FAILED,
      reason: 'Element locked by another user or concurrency issue.',
    }));
    return;
  }

  session.undoStack.pop();
  revertAction(session, action);
  session.redoStack.push(action);

  broadcastElementState(session);
}

export function handleRedo(session, data, ws) {
  if (!session) return;
  const { userId } = data;

  finalizeAllPendingMovesForUser(session, userId);

  if (session.redoStack.length === 0) {
    return;
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

function finalizeAllPendingMovesForUser(session, userId) {
  if (!session.pendingMoves) {
    session.pendingMoves = new Map();
  }

  const toFinalize = [];
  for (const [elementId, moveData] of session.pendingMoves.entries()) {
    if (moveData.userId === userId) {
      toFinalize.push(elementId);
    }
  }

  for (const elementId of toFinalize) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) {
      session.pendingMoves.delete(elementId);
      continue;
    }

    const moveData = session.pendingMoves.get(elementId);
    if (!moveData) continue;

    const oldX = moveData.oldX;
    const oldY = moveData.oldY;
    const newX = el.x;
    const newY = el.y;

    session.pendingMoves.delete(elementId);

    if (oldX === newX && oldY === newY) {
      continue;
    }

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
    pushUndoAction(session, action);
  }
}

function canApplyAction(session, action, userId) {
  if (!action?.diffs || !Array.isArray(action.diffs)) return true;

  if (['move','create','delete','resize'].includes(action.type)) {
    for (const diff of action.diffs) {
      const elId = action.type === 'delete' ? diff.id : diff.elementId;
      const el = session.elements.find(e => e.id === elId);
      if (!el) continue; // shape no longer exists => skip
      if (el.lockedBy && el.lockedBy !== userId) {
        return false;
      }
    }
  }
  return true;
}

function applyAction(session, action) {
  if (!action?.type) return;

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
      // In the current code, we only store partial data for create. 
      // Possibly expand if you need to fully re-create shapes on redo.
      break;

    case 'delete':
      // Re-DELETE
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
  if (!action?.type) return;

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
      // Undo a create => remove the shape
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
