// ./server/ws/handlers/undoRedoHandlers.js
// Removed unused import of WebSocket (no longer needed).
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

function finalizeAllPendingResizesForUser(session, userId) {
  if (!session.pendingResizes) {
    session.pendingResizes = new Map();
  }
  const toFinalize = [];
  for (const [elementId, pending] of session.pendingResizes.entries()) {
    if (pending.userId === userId) {
      toFinalize.push(elementId);
    }
  }
  for (const elementId of toFinalize) {
    const el = session.elements.find(e => e.id === elementId);
    if (!el) {
      session.pendingResizes.delete(elementId);
      continue;
    }
    const { oldX, oldY, oldW, oldH } = pending;
    const newX = el.x;
    const newY = el.y;
    const newW = el.w;
    const newH = el.h;
    session.pendingResizes.delete(elementId);

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

function canApplyAction(session, action, userId) {
  if (action.type === 'move') {
    for (const diff of action.diffs) {
      const el = session.elements.find(e => e.id === diff.elementId);
      if (!el) continue;
      if (el.lockedBy && el.lockedBy !== userId) {
        return false;
      }
    }
  } else if (action.type === 'create') {
    for (const diff of action.diffs) {
      const el = session.elements.find(e => e.id === diff.elementId);
      if (el && el.lockedBy && el.lockedBy !== userId) {
        return false;
      }
    }
  } else if (action.type === 'delete') {
    for (const d of action.diffs) {
      const el = session.elements.find(e => e.id === d.id);
      if (el && el.lockedBy && el.lockedBy !== userId) {
        return false;
      }
    }
  } else if (action.type === 'resize') {
    for (const diff of action.diffs) {
      const el = session.elements.find(e => e.id === diff.elementId);
      if (el && el.lockedBy && el.lockedBy !== userId) {
        return false;
      }
    }
  }
  return true;
}

function applyAction(session, action) {
  if (action.type === 'move') {
    for (const diff of action.diffs) {
      const el = session.elements.find(e => e.id === diff.elementId);
      if (!el) continue;
      el.x = diff.to.x;
      el.y = diff.to.y;
    }
  } else if (action.type === 'create') {
    // minimal re-create not fully stored
  } else if (action.type === 'delete') {
    // Re-DELETE
    for (const d of action.diffs) {
      const idx = session.elements.findIndex(e => e.id === d.id);
      if (idx >= 0) {
        session.elements.splice(idx, 1);
      }
    }
  } else if (action.type === 'resize') {
    for (const diff of action.diffs) {
      const el = session.elements.find(e => e.id === diff.elementId);
      if (!el) continue;
      el.x = diff.to.x;
      el.y = diff.to.y;
      el.w = diff.to.w;
      el.h = diff.to.h;
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
  } else if (action.type === 'create') {
    for (const diff of action.diffs) {
      const idx = session.elements.findIndex(e => e.id === diff.elementId);
      if (idx >= 0) {
        session.elements.splice(idx, 1);
      }
    }
  } else if (action.type === 'delete') {
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
  } else if (action.type === 'resize') {
    for (const diff of action.diffs) {
      const el = session.elements.find(e => e.id === diff.elementId);
      if (!el) continue;
      el.x = diff.from.x;
      el.y = diff.from.y;
      el.w = diff.from.w;
      el.h = diff.from.h;
    }
  }
}
