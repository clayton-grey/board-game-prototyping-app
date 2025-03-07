// ./server/ws/messageDispatcher.js
import { MESSAGE_TYPES } from "../../shared/wsMessageTypes.js";
import * as sessionHandlers from "./handlers/sessionHandlers.js";
import * as cursorHandlers from "./handlers/cursorHandlers.js";
import * as elementHandlers from "./handlers/elementHandlers.js";
import * as permissionHandlers from "./handlers/permissionHandlers.js";
import * as projectHandlers from "./handlers/projectHandlers.js";
import * as undoRedoHandlers from "./handlers/undoRedoHandlers.js";
import * as chatHandlers from "./handlers/chatHandlers.js";

const handlerMap = {
  [MESSAGE_TYPES.JOIN_SESSION]: sessionHandlers.handleJoinSession,
  [MESSAGE_TYPES.UPGRADE_USER_ID]: sessionHandlers.handleUpgradeUserId,
  [MESSAGE_TYPES.DOWNGRADE_USER_ID]: sessionHandlers.handleDowngradeUserId,
  [MESSAGE_TYPES.CURSOR_UPDATE]: cursorHandlers.handleCursorUpdate,

  [MESSAGE_TYPES.ELEMENT_GRAB]: elementHandlers.handleElementGrab,
  [MESSAGE_TYPES.ELEMENT_MOVE]: elementHandlers.handleElementMove,
  [MESSAGE_TYPES.ELEMENT_RELEASE]: elementHandlers.handleElementRelease,
  [MESSAGE_TYPES.ELEMENT_DESELECT]: elementHandlers.handleElementDeselect,
  [MESSAGE_TYPES.ELEMENT_CREATE]: elementHandlers.handleElementCreate,
  [MESSAGE_TYPES.ELEMENT_DELETE]: elementHandlers.handleElementDelete,
  [MESSAGE_TYPES.ELEMENT_RESIZE]: elementHandlers.handleElementResize,
  [MESSAGE_TYPES.ELEMENT_RESIZE_END]: elementHandlers.handleElementResizeEnd,
  [MESSAGE_TYPES.ELEMENT_ROTATE]: elementHandlers.handleElementRotate,
  [MESSAGE_TYPES.ELEMENT_ROTATE_END]: elementHandlers.handleElementRotateEnd,
  [MESSAGE_TYPES.MAKE_EDITOR]: permissionHandlers.handleMakeEditor,
  [MESSAGE_TYPES.REMOVE_EDITOR]: permissionHandlers.handleRemoveEditor,
  [MESSAGE_TYPES.KICK_USER]: permissionHandlers.handleKickUser,
  [MESSAGE_TYPES.PROJECT_NAME_CHANGE]: projectHandlers.handleProjectNameChange,
  [MESSAGE_TYPES.UNDO]: undoRedoHandlers.handleUndo,
  [MESSAGE_TYPES.REDO]: undoRedoHandlers.handleRedo,
  [MESSAGE_TYPES.CHAT_MESSAGE]: chatHandlers.handleChatMessage,
};

export function handleIncomingMessage(session, data, ws) {
  const handler = handlerMap[data.type];
  if (handler) {
    handler(session, data, ws);
  }
}
