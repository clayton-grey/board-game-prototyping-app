// tests/unit/messageDispatcher.test.js

import { handleIncomingMessage } from '../../server/ws/messageDispatcher.js';
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

// We’ll mock each handler we dispatch to:
import * as sessionHandlers from '../../server/ws/handlers/sessionHandlers.js';
import * as cursorHandlers from '../../server/ws/handlers/cursorHandlers.js';
import * as elementHandlers from '../../server/ws/handlers/elementHandlers.js';
import * as permissionHandlers from '../../server/ws/handlers/permissionHandlers.js';
import * as projectHandlers from '../../server/ws/handlers/projectHandlers.js';
import * as undoRedoHandlers from '../../server/ws/handlers/undoRedoHandlers.js';
import * as chatHandlers from '../../server/ws/handlers/chatHandlers.js';

jest.mock('../../server/ws/handlers/sessionHandlers.js');
jest.mock('../../server/ws/handlers/cursorHandlers.js');
jest.mock('../../server/ws/handlers/elementHandlers.js');
jest.mock('../../server/ws/handlers/permissionHandlers.js');
jest.mock('../../server/ws/handlers/projectHandlers.js');
jest.mock('../../server/ws/handlers/undoRedoHandlers.js');
jest.mock('../../server/ws/handlers/chatHandlers.js');

describe('messageDispatcher.js - handleIncomingMessage', () => {
  let mockSession, mockWs;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = { code: 'fake-session' };
    mockWs = { readyState: 1, send: jest.fn() };
  });

  test('handles JOIN_SESSION => handleJoinSession', () => {
    const data = { type: MESSAGE_TYPES.JOIN_SESSION };
    handleIncomingMessage(mockSession, data, mockWs);
    expect(sessionHandlers.handleJoinSession).toHaveBeenCalledWith(mockSession, data, mockWs);
  });

  test('handles UPGRADE_USER_ID => handleUpgradeUserId', () => {
    const data = { type: MESSAGE_TYPES.UPGRADE_USER_ID };
    handleIncomingMessage(mockSession, data, mockWs);
    expect(sessionHandlers.handleUpgradeUserId).toHaveBeenCalledWith(mockSession, data, mockWs);
  });

  test('handles CURSOR_UPDATE => handleCursorUpdate', () => {
    const data = { type: MESSAGE_TYPES.CURSOR_UPDATE };
    handleIncomingMessage(mockSession, data, mockWs);
    expect(cursorHandlers.handleCursorUpdate).toHaveBeenCalledWith(mockSession, data, mockWs);
  });

  test('handles ELEMENT_MOVE => handleElementMove', () => {
    const data = { type: MESSAGE_TYPES.ELEMENT_MOVE };
    handleIncomingMessage(mockSession, data, mockWs);
    expect(elementHandlers.handleElementMove).toHaveBeenCalledWith(mockSession, data, mockWs);
  });

  test('handles MAKE_EDITOR => handleMakeEditor', () => {
    const data = { type: MESSAGE_TYPES.MAKE_EDITOR };
    handleIncomingMessage(mockSession, data, mockWs);
    expect(permissionHandlers.handleMakeEditor).toHaveBeenCalledWith(mockSession, data, mockWs);
  });

  test('handles PROJECT_NAME_CHANGE => handleProjectNameChange', () => {
    const data = { type: MESSAGE_TYPES.PROJECT_NAME_CHANGE };
    handleIncomingMessage(mockSession, data, mockWs);
    expect(projectHandlers.handleProjectNameChange).toHaveBeenCalledWith(mockSession, data, mockWs);
  });

  test('handles UNDO => handleUndo', () => {
    const data = { type: MESSAGE_TYPES.UNDO };
    handleIncomingMessage(mockSession, data, mockWs);
    expect(undoRedoHandlers.handleUndo).toHaveBeenCalledWith(mockSession, data, mockWs);
  });

  test('handles REDO => handleRedo', () => {
    const data = { type: MESSAGE_TYPES.REDO };
    handleIncomingMessage(mockSession, data, mockWs);
    expect(undoRedoHandlers.handleRedo).toHaveBeenCalledWith(mockSession, data, mockWs);
  });

  test('handles CHAT_MESSAGE => handleChatMessage', () => {
    const data = { type: MESSAGE_TYPES.CHAT_MESSAGE };
    handleIncomingMessage(mockSession, data, mockWs);
    expect(chatHandlers.handleChatMessage).toHaveBeenCalledWith(mockSession, data, mockWs);
  });

  test('unknown message type => does nothing', () => {
    const data = { type: 'some-unsupported-type' };
    handleIncomingMessage(mockSession, data, mockWs);
    // No calls
    expect(sessionHandlers.handleJoinSession).not.toHaveBeenCalled();
    expect(cursorHandlers.handleCursorUpdate).not.toHaveBeenCalled();
  });
});
