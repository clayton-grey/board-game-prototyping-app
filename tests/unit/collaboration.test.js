// tests/unit/collaboration.test.js

import { handleWebSocketConnection } from '../../server/ws/collaboration.js';
import { SessionService } from '../../server/services/SessionService.js';
import { broadcastUserList, broadcastElementState } from '../../server/ws/collabUtils.js';
import { WebSocketServer } from 'ws';

// We mock these modules so we can inspect calls
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

    // A mock WebSocket server
    mockWss = new WebSocketServer({ noServer: true });
    
    // A mock WebSocket instance
    mockWs = {
      on: jest.fn(),
      send: jest.fn(),
      sessionCode: undefined,
      userId: undefined
    };
  });

  test('attaches message and close handlers to the incoming ws', () => {
    handleWebSocketConnection(mockWs, mockWss);

    // We expect two .on calls: one for 'message' and one for 'close'
    expect(mockWs.on).toHaveBeenCalledTimes(2);
    expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
  });

  test('if message is invalid JSON, it is ignored (no crash)', () => {
    handleWebSocketConnection(mockWs, mockWss);

    const [_, onMessage] = mockWs.on.mock.calls.find(call => call[0] === 'message');
    // Simulate a malformed JSON string:
    expect(() => onMessage('not valid json}')).not.toThrow();
  });


  test('on close: if no sessionCode or userId, does nothing', () => {
    // Simulate ws.on('close', callback)
    handleWebSocketConnection(mockWs, mockWss);
    
    // Find the 'close' callback
    const closeHandler = mockWs.on.mock.calls.find(
      call => call[0] === 'close'
    )[1];
    
    // Invoke it with ws.sessionCode = undefined
    closeHandler();
    
    // SessionService should not be called
    expect(SessionService.getSession).not.toHaveBeenCalled();
    expect(SessionService.removeUser).not.toHaveBeenCalled();
  });

  test('on close: if session found, remove user, broadcast, possibly remove session', () => {
    // Suppose the ws gets a sessionCode/userId set at some point
    mockWs.sessionCode = 'test-session-code';
    mockWs.userId = 'test-user';

    // The session object returned
    const mockSession = {
      code: 'test-session-code',
      users: new Map([['test-user',{ userId:'test-user' }]]),
    };

    // Stubs
    SessionService.getSession.mockReturnValue(mockSession);
    SessionService.removeUser.mockImplementation((sess, uid) => {
      sess.users.delete(uid);
    });
    
    // handleWebSocketConnection => sets up 'close' 
    handleWebSocketConnection(mockWs, mockWss);

    // Grab the close handler
    const closeHandler = mockWs.on.mock.calls.find(c => c[0] === 'close')[1];
    
    closeHandler();
    
    expect(SessionService.getSession).toHaveBeenCalledWith('test-session-code');
    expect(SessionService.removeUser).toHaveBeenCalledWith(mockSession, 'test-user');
    // After removing user, we broadcast user list & element state
    expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
    expect(broadcastElementState).toHaveBeenCalledWith(mockSession);
    // Then sees if session is empty => remove it
    expect(SessionService.removeSession).toHaveBeenCalledWith('test-session-code');
  });
});
