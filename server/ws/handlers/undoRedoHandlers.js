// ./server/ws/handlers/undoRedoHandlers.js
import { MESSAGE_TYPES } from "../../../shared/wsMessageTypes.js";
import { broadcastElementState } from "../collabUtils.js";
import { sessionGuard } from "./handlerUtils.js";

export function pushUndoAction(session, action) {
  session.redoStack = [];
  session.undoStack.push(action);
  if (session.undoStack.length > 50) {
    session.undoStack.shift();
  }
}

export const handleUndo = sessionGuard((session, data, ws) => {
  const { userId } = data;

  if (session.undoStack.length === 0) {
    return;
  }
  const action = session.undoStack[session.undoStack.length - 1];
  if (!canApplyAction(session, action, userId)) {
    ws.send(
      JSON.stringify({
        type: MESSAGE_TYPES.UNDO_REDO_FAILED,
        reason: "Element locked by another user or concurrency issue.",
      }),
    );
    return;
  }

  session.undoStack.pop();
  revertAction(session, action);
  session.redoStack.push(action);

  broadcastElementState(session);
});

export const handleRedo = sessionGuard((session, data, ws) => {
  const { userId } = data;

  if (session.redoStack.length === 0) {
    return;
  }
  const action = session.redoStack[session.redoStack.length - 1];
  if (!canApplyAction(session, action, userId)) {
    ws.send(
      JSON.stringify({
        type: MESSAGE_TYPES.UNDO_REDO_FAILED,
        reason: "Element locked by another user or concurrency issue.",
      }),
    );
    return;
  }

  session.redoStack.pop();
  applyAction(session, action);
  session.undoStack.push(action);

  broadcastElementState(session);
});

function canApplyAction(session, action, userId) {
  if (!action?.diffs || !Array.isArray(action.diffs)) return true;
  if (!["move", "create", "delete", "resize", "rotate"].includes(action.type))
    return true;

  for (const diff of action.diffs) {
    let elId;
    if (action.type === "delete") {
      elId = diff.id;
    } else if (action.type === "rotate") {
      elId = diff.elementId;
    } else {
      elId = diff.elementId;
    }

    const el = session.elements.find((e) => e.id === elId);
    if (!el) continue;
    if (el.lockedBy && el.lockedBy !== userId) {
      return false;
    }
  }
  return true;
}

function applyAction(session, action) {
  switch (action.type) {
    case "move":
      for (const diff of action.diffs) {
        const el = session.elements.find((e) => e.id === diff.elementId);
        if (!el) continue;
        el.x = diff.to.x;
        el.y = diff.to.y;
      }
      break;
    case "create":
      for (const diff of action.diffs) {
        const existing = session.elements.find((e) => e.id === diff.elementId);
        if (!existing) {
          session.elements.push({
            id: diff.elementId,
            shape: diff.shape,
            x: diff.x,
            y: diff.y,
            w: diff.w,
            h: diff.h,
            angle: diff.angle || 0,
            lockedBy: null,
          });
        }
      }
      break;
    case "delete":
      for (const d of action.diffs) {
        const idx = session.elements.findIndex((e) => e.id === d.id);
        if (idx >= 0) {
          session.elements.splice(idx, 1);
        }
      }
      break;
    case "resize":
      for (const diff of action.diffs) {
        const el = session.elements.find((e) => e.id === diff.elementId);
        if (!el) continue;
        el.x = diff.to.x;
        el.y = diff.to.y;
        el.w = diff.to.w;
        el.h = diff.to.h;
      }
      break;
    case "rotate":
      for (const diff of action.diffs) {
        const el = session.elements.find((e) => e.id === diff.elementId);
        if (!el) continue;
        el.angle = diff.toAngle;
      }
      break;
    default:
      break;
  }
}

function revertAction(session, action) {
  switch (action.type) {
    case "move":
      for (const diff of action.diffs) {
        const el = session.elements.find((e) => e.id === diff.elementId);
        if (!el) continue;
        el.x = diff.from.x;
        el.y = diff.from.y;
      }
      break;
    case "create":
      for (const diff of action.diffs) {
        const idx = session.elements.findIndex((e) => e.id === diff.elementId);
        if (idx >= 0) {
          session.elements.splice(idx, 1);
        }
      }
      break;
    case "delete":
      for (const d of action.diffs) {
        const exists = session.elements.find((e) => e.id === d.id);
        if (!exists) {
          session.elements.push({
            id: d.id,
            shape: d.shape,
            x: d.x,
            y: d.y,
            w: d.w,
            h: d.h,
            angle: d.angle || 0,
            lockedBy: null,
          });
        }
      }
      break;
    case "resize":
      for (const diff of action.diffs) {
        const el = session.elements.find((e) => e.id === diff.elementId);
        if (!el) continue;
        el.x = diff.from.x;
        el.y = diff.from.y;
        el.w = diff.from.w;
        el.h = diff.from.h;
      }
      break;
    case "rotate":
      for (const diff of action.diffs) {
        const el = session.elements.find((e) => e.id === diff.elementId);
        if (!el) continue;
        el.angle = diff.fromAngle;
      }
      break;
    default:
      break;
  }
}
