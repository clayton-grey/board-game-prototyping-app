// tests/unit/collabUtils.test.js
import { broadcastToSession, broadcastElementState, broadcastUserList } from '../../server/ws/collabUtils.js';
import { WebSocket } from 'ws';
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

// We’ll mock out the actual WebSocket send method
jest.mock('ws', () => {
  const MockWebSocket = jest.fn().mockImplementation(() => ({
    readyState: 1,
    send: jest.fn((msg, cb) => {
      if (cb) cb(); // mimic behavior
    })
  }));

  // Provide the “OPEN” constant
  MockWebSocket.OPEN = 1;

  return { WebSocket: MockWebSocket };
});

describe('collabUtils', () => {
  let mockSession;

  beforeEach(() => {
    mockSession = {
      code: 'test-session',
      projectName: 'TestProject',
      elements: [
        { id: 1, x: 10, y: 10, w: 50, h: 50, lockedBy: null },
      ],
      users: new Map(),
    };
    // Create a few fake user objects with mock sockets
    const user1Socket = new WebSocket();
    const user2Socket = new WebSocket();
    mockSession.users.set('user1', {
      userId: 'user1',
      socket: user1Socket
    });
    mockSession.users.set('user2', {
      userId: 'user2',
      socket: user2Socket
    });
  });

  test('broadcastToSession sends stringified data to all connected user sockets', () => {
    broadcastToSession(mockSession, { type: 'TEST_MESSAGE', hello: 'world' });

    // For each user, confirm `socket.send` was called
    for (const user of mockSession.users.values()) {
      expect(user.socket.send).toHaveBeenCalledTimes(1);
      const sentMsg = user.socket.send.mock.calls[0][0];
      expect(JSON.parse(sentMsg)).toMatchObject({
        type: 'TEST_MESSAGE',
        hello: 'world',
      });
    }
  });

  test('broadcastElementState sends ELEMENT_STATE with elements & projectName', () => {
    broadcastElementState(mockSession);

    for (const user of mockSession.users.values()) {
      expect(user.socket.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(user.socket.send.mock.calls[0][0]);
      expect(msg.type).toBe(MESSAGE_TYPES.ELEMENT_STATE);
      expect(msg.elements).toEqual(mockSession.elements);
      expect(msg.projectName).toBe(mockSession.projectName);
    }
  });

  test('broadcastUserList sends SESSION_USERS with sorted user array & ownerUserId', () => {
    // Let’s mark user1 as owner
    mockSession.users.get('user1').isOwner = true;
    // Mark user2 as admin, just as an example
    mockSession.users.get('user2').isAdmin = true;

    broadcastUserList(mockSession);

    for (const user of mockSession.users.values()) {
      expect(user.socket.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(user.socket.send.mock.calls[0][0]);
      expect(msg.type).toBe(MESSAGE_TYPES.SESSION_USERS);
      expect(Array.isArray(msg.users)).toBe(true);
      // We expect two
      expect(msg.users.length).toBe(2);

      // user1 is the owner
      const foundOwner = msg.users.find(u => u.userId === 'user1');
      expect(foundOwner.isOwner).toBe(true);
      expect(msg.ownerUserId).toBe('user1');

      // user2 is admin
      const foundAdmin = msg.users.find(u => u.userId === 'user2');
      expect(foundAdmin.isAdmin).toBe(true);
    }
  });

  test('broadcastToSession does nothing if user socket is missing or not open', () => {
    // Remove socket for user2
    mockSession.users.get('user2').socket = null;

    // Mark user1’s socket as closed
    mockSession.users.get('user1').socket.readyState = 3; // WebSocket.CLOSED is often 3

    broadcastToSession(mockSession, { type: 'ANY', data: 1 });

    // No calls for a closed or null socket
    for (const user of mockSession.users.values()) {
      if (!user.socket) continue;
      expect(user.socket.send).not.toHaveBeenCalled();
    }
  });
});
