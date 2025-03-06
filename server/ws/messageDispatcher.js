// ./server/ws/messageDispatcher.js
import { MESSAGE_TYPES } from "../../shared/wsMessageTypes.js";
import {
  handleJoinSession,
  handleUpgradeUserId,
  handleDowngradeUserId,
} from "./handlers/sessionHandlers.js";
import { handleCursorUpdate } from "./handlers/cursorHandlers.js";
import {
  handleElementGrab,
  handleElementMove,
  handleElementRelease,
  handleElementDeselect,
  handleElementCreate,
  handleElementDelete,
  handleElementResize,
  handleElementResizeEnd,
} from "./handlers/elementHandlers.js";
import {
  handleMakeEditor,
  handleRemoveEditor,
  handleKickUser,
} from "./handlers/permissionHandlers.js";
import { handleProjectNameChange } from "./handlers/projectHandlers.js";
import { handleUndo, handleRedo } from "./handlers/undoRedoHandlers.js";
import { handleChatMessage } from "./handlers/chatHandlers.js";

export function handleIncomingMessage(session, data, ws) {
  switch (data.type) {
    // Session join/upgrade/downgrade
    case MESSAGE_TYPES.JOIN_SESSION:
      handleJoinSession(session, data, ws);
      break;
    case MESSAGE_TYPES.UPGRADE_USER_ID:
      handleUpgradeUserId(session, data, ws);
      break;
    case MESSAGE_TYPES.DOWNGRADE_USER_ID:
      handleDowngradeUserId(session, data, ws);
      break;

    // Cursor & element manipulation
    case MESSAGE_TYPES.CURSOR_UPDATE:
      handleCursorUpdate(session, data, ws);
      break;

    case MESSAGE_TYPES.ELEMENT_GRAB:
      handleElementGrab(session, data, ws);
      break;
    case MESSAGE_TYPES.ELEMENT_MOVE:
      handleElementMove(session, data, ws);
      break;
    case MESSAGE_TYPES.ELEMENT_RELEASE:
      handleElementRelease(session, data, ws);
      break;
    case MESSAGE_TYPES.ELEMENT_DESELECT:
      handleElementDeselect(session, data, ws);
      break;
    case MESSAGE_TYPES.ELEMENT_CREATE:
      handleElementCreate(session, data, ws);
      break;
    case MESSAGE_TYPES.ELEMENT_DELETE:
      handleElementDelete(session, data, ws);
      break;
    case MESSAGE_TYPES.ELEMENT_RESIZE:
      handleElementResize(session, data, ws);
      break;
    case MESSAGE_TYPES.ELEMENT_RESIZE_END:
      handleElementResizeEnd(session, data, ws);
      break;

    // Permissions
    case MESSAGE_TYPES.MAKE_EDITOR:
      handleMakeEditor(session, data, ws);
      break;
    case MESSAGE_TYPES.REMOVE_EDITOR:
      handleRemoveEditor(session, data, ws);
      break;
    case MESSAGE_TYPES.KICK_USER:
      handleKickUser(session, data, ws);
      break;

    // Project name changes
    case MESSAGE_TYPES.PROJECT_NAME_CHANGE:
      handleProjectNameChange(session, data, ws);
      break;

    // Undo/redo
    case MESSAGE_TYPES.UNDO:
      handleUndo(session, data, ws);
      break;
    case MESSAGE_TYPES.REDO:
      handleRedo(session, data, ws);
      break;

    // Chat messages
    case MESSAGE_TYPES.CHAT_MESSAGE:
      handleChatMessage(session, data, ws);
      break;

    default:
      break;
  }
}
