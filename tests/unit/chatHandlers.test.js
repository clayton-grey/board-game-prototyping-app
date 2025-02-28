// tests/unit/chatHandlers.test.js

import { handleChatMessage } from '../../server/ws/handlers/chatHandlers.js';
import { broadcastToSession } from '../../server/ws/collabUtils.js';
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

jest.mock('../../server/ws/collabUtils.js', () => ({
  broadcastToSession: jest.fn()
}));

describe('chatHandlers', () => {
  let mockSession, mockWs;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWs = { send: jest.fn() };

    mockSession = {
      code: 'test-chat',
      users: new Map(),
      chatMessages: []
    };
  });

  test('handleChatMessage => appends message to session.chatMessages & broadcasts', () => {
    const data = {
      userId: 'userA',
      text: 'Hello World'
    };
    handleChatMessage(mockSession, data, mockWs);

    expect(mockSession.chatMessages).toHaveLength(1);
    const msgObj = mockSession.chatMessages[0];
    expect(msgObj.userId).toBe('userA');
    expect(msgObj.text).toBe('Hello World');
    expect(typeof msgObj.timestamp).toBe('number');

    expect(broadcastToSession).toHaveBeenCalledWith(mockSession, {
      type: MESSAGE_TYPES.CHAT_MESSAGE,
      message: msgObj
    });
  });

  test('handleChatMessage => does nothing if text or userId missing', () => {
    handleChatMessage(mockSession, { text: '' }, mockWs);
    expect(mockSession.chatMessages).toHaveLength(0);
    expect(broadcastToSession).not.toHaveBeenCalled();

    handleChatMessage(mockSession, { userId: 'u1' }, mockWs);
    expect(mockSession.chatMessages).toHaveLength(0);
    expect(broadcastToSession).not.toHaveBeenCalled();
  });
});
