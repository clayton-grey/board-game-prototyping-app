// ./server/ws/handlers/undoRedoHandlers.js
import { WebSocket } from 'ws';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { broadcastElementState } from '../collabUtils.js';

export function handleUndo(session, data, ws) {
  if (!session) return;
  const { userId } = data;

  finalizeAllPendingMovesForUser(session, userId);

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
    // If these elements exist, ensure not locked by another user
    for (const d of action.diffs) {
      // If the element is currently in the session, check lock
      const el = session.elements.find(e => e.id === d.id);
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
    // Minimal. If undone, the shape was removed. 
    // Without storing shape details in 'create' diffs, we can't fully re-add it.
    // For quick demo, we skip a thorough re-hydration. 
  } else if (action.type === 'delete') {
    // Re-DELETE the elements if redoing a delete
    for (const d of action.diffs) {
      const idx = session.elements.findIndex(e => e.id === d.id);
      if (idx >= 0) {
        session.elements.splice(idx, 1);
      }
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
    // removing the newly created element
    for (const diff of action.diffs) {
      const idx = session.elements.findIndex(e => e.id === diff.elementId);
      if (idx >= 0) {
        session.elements.splice(idx, 1);
      }
    }
  } else if (action.type === 'delete') {
    // Undoing a delete => re-add them
    for (const d of action.diffs) {
      // If they don't exist, re-insert
      const exists = session.elements.find(e => e.id === d.id);
      if (!exists) {
        session.elements.push({
          id: d.id,
          shape: d.shape,
          x: d.x,
          y: d.y,
          w: d.w,
          h: d.h,
          lockedBy: null, // Usually re-adding unlocked or store d.lockedBy if you want
        });
      }
    }
  }
}
