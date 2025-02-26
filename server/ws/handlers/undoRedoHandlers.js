// ./server/ws/handlers/undoRedoHandlers.js
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { broadcastElementState } from '../collabUtils.js';

/**
 * A small helper to push an action onto the undo stack,
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
  finalizeAllPendingResizesForUser(session, userId);

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
  finalizeAllPendingResizesForUser(session, userId);

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

/**
 * If a user has any "pendingMoves" (e.g. mid-drag) for shapes,
 * finalize them so they become part of the undo history.
 */
function finalizeAllPendingMovesForUser(session, userId) {
  if (!session.pendingMoves) {
    session.pendingMoves = new Map();
  }

  // Gather all elementIds whose pending move belongs to this user
  const toFinalize = [];
  for (const [elementId, moveData] of session.pendingMoves.entries()) {
    if (moveData.userId === userId) {
      toFinalize.push(elementId);
    }
  }

  // Finalize each
  for (const elementId of toFinalize) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) {
      // If the element was removed or doesn't exist, just delete the pending entry
      session.pendingMoves.delete(elementId);
      continue;
    }

    const moveData = session.pendingMoves.get(elementId);
    if (!moveData) continue;  // might already have been deleted

    const oldX = moveData.oldX;
    const oldY = moveData.oldY;
    const newX = el.x;
    const newY = el.y;

    session.pendingMoves.delete(elementId);

    // If the element didn't actually move, no need to create an action
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

/**
 * Similar logic for pending resizes.
 */
function finalizeAllPendingResizesForUser(session, userId) {
  if (!session.pendingResizes) {
    session.pendingResizes = new Map();
  }

  // Identify all elementIds that the given user is resizing
  const toFinalize = [];
  for (const [elementId, resizeData] of session.pendingResizes.entries()) {
    if (resizeData.userId === userId) {
      toFinalize.push(elementId);
    }
  }

  for (const elementId of toFinalize) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) {
      // If the element was removed or doesn't exist, just delete the pending
      session.pendingResizes.delete(elementId);
      continue;
    }

    const resizeData = session.pendingResizes.get(elementId);
    if (!resizeData) continue;  // might already have been deleted

    const { oldX, oldY, oldW, oldH } = resizeData;
    const newX = el.x;
    const newY = el.y;
    const newW = el.w;
    const newH = el.h;

    session.pendingResizes.delete(elementId);

    // If there's no actual size change, skip
    if (oldX === newX && oldY === newY && oldW === newW && oldH === newH) {
      continue;
    }

    const action = {
      type: 'resize',
      diffs: [
        {
          elementId,
          from: { x: oldX, y: oldY, w: oldW, h: oldH },
          to: { x: newX, y: newY, w: newW, h: newH },
        }
      ],
    };
    pushUndoAction(session, action);
  }
}

/**
 * Determines whether the user can apply the given action
 * (i.e., no shape is locked by a different user).
 */
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

/**
 * Re-applies an action to the session (redo).
 */
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
      // Minimal re-create not fully stored,
      // typically you only do partial re-create on an undo->redo.
      // If needed, store full shape data in `diffs`.
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

/**
 * Reverts an action (undo).
 */
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
