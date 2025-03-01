// tests/unit/collaboration.test.js

import { handleWebSocketConnection } from '../../server/ws/collaboration.js';
import { SessionService } from '../../server/services/SessionService.js';
import { broadcastUserList, broadcastElementState } from '../../server/ws/collabUtils.js';
import { WebSocketServer } from 'ws';

jest.mock('../../server/services/SessionService.js');
jest.mock('../../server/ws/collabUtils.js', () => ({
  broadcastUserList: jest.fn(),
  broadcastElementState: jest.fn()
}));

describe('collaboration.js - handleWebSocketConnection', () => {
  let mockWss;
  let mockWs;

  beforeEach(() => {
    jest.clearAllMocks();

    mockWss = new WebSocketServer({ noServer: true });

    mockWs = {
      on: jest.fn(),
      send: jest.fn(),
      sessionCode: undefined,
      userId: undefined
    };
  });

  test('attaches message and close handlers to the incoming ws', () => {
    handleWebSocketConnection(mockWs, mockWss);

    expect(mockWs.on).toHaveBeenCalledTimes(2);
    expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
  });

  test('if message is invalid JSON, it is ignored (no crash)', () => {
    handleWebSocketConnection(mockWs, mockWss);

    const onMessage = mockWs.on.mock.calls.find(([evt]) => evt === 'message')[1];
    expect(() => onMessage('invalid json}')).not.toThrow();
  });

  test('on close: if no sessionCode or userId, does nothing', () => {
    handleWebSocketConnection(mockWs, mockWss);

    const closeHandler = mockWs.on.mock.calls.find(([evt]) => evt === 'close')[1];
    closeHandler();

    expect(SessionService.getSession).not.toHaveBeenCalled();
    expect(broadcastUserList).not.toHaveBeenCalled();
    expect(broadcastElementState).not.toHaveBeenCalled();
  });

  test('on close: if session found, remove user, broadcast, possibly remove session', () => {
    mockWs.sessionCode = 'test-session-code';
    mockWs.userId = 'test-user';

    const mockSession = {
      code: 'test-session-code',
      users: new Map([['test-user', { userId: 'test-user' }]]),
      removeUser: jest.fn(),
      // We'll fake the user map size as 1
      usersSize: 1
    };

    // Suppose after removeUser is called, there are 0 users left:
    mockSession.removeUser.mockImplementation((uid) => {
      mockSession.users.delete(uid);
    });

    SessionService.getSession.mockReturnValue(mockSession);

    handleWebSocketConnection(mockWs, mockWss);

    const closeHandler = mockWs.on.mock.calls.find(([evt]) => evt === 'close')[1];
    closeHandler();

    expect(SessionService.getSession).toHaveBeenCalledWith('test-session-code');
    expect(mockSession.removeUser).toHaveBeenCalledWith('test-user');

    expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
    expect(broadcastElementState).toHaveBeenCalledWith(mockSession);

    // Now that test-user is removed, the map is empty => session.users.size=0
    expect(SessionService.removeSession).toHaveBeenCalledWith('test-session-code');
  });
});
