// server/ws/messageDispatcher.js
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';
import { handleJoinSession, handleUpgradeUserId, handleDowngradeUserId } from './handlers/sessionHandlers.js';
import { handleCursorUpdate } from './handlers/cursorHandlers.js';
import { handleElementGrab, handleElementMove, handleElementRelease } from './handlers/elementHandlers.js';
import { handleMakeEditor, handleRemoveEditor, handleKickUser } from './handlers/permissionHandlers.js';
import { handleProjectNameChange } from './handlers/projectHandlers.js';

export function handleIncomingMessage(session, data, ws) {
  switch (data.type) {
    case MESSAGE_TYPES.JOIN_SESSION:
      handleJoinSession(session, data, ws);
      break;
    case MESSAGE_TYPES.UPGRADE_USER_ID:
      handleUpgradeUserId(session, data, ws);
      break;
    case MESSAGE_TYPES.DOWNGRADE_USER_ID:
      handleDowngradeUserId(session, data, ws);
      break;

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

    case MESSAGE_TYPES.MAKE_EDITOR:
      handleMakeEditor(session, data, ws);
      break;
    case MESSAGE_TYPES.REMOVE_EDITOR:
      handleRemoveEditor(session, data, ws);
      break;
    case MESSAGE_TYPES.KICK_USER:
      handleKickUser(session, data, ws);
      break;

    // NEW: Handle project name changes in the real-time session
    case MESSAGE_TYPES.PROJECT_NAME_CHANGE:
      handleProjectNameChange(session, data, ws);
      break;

    default:
      // unknown message type
      break;
  }
}
