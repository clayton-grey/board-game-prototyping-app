// tests/unit/cursorHandlers.test.js
import { handleCursorUpdate } from '../../server/ws/handlers/cursorHandlers.js';
import { broadcastToSession } from '../../server/ws/collabUtils.js';
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

jest.mock('../../server/ws/collabUtils.js', () => ({
  broadcastToSession: jest.fn(),
}));

describe('cursorHandlers', () => {
  let mockSession;
  let mockWs;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWs = { send: jest.fn() };
    mockSession = {
      code: 'cursor-test',
      users: new Map(),
    };
    mockSession.users.set('userA', { userId: 'userA', x: 0, y: 0 });
    mockSession.users.set('userB', { userId: 'userB', x: 100, y: 100 });
  });

  test('handleCursorUpdate => updates user x,y and broadcasts', () => {
    handleCursorUpdate(mockSession, { userId: 'userA', x: 50, y: 60 }, mockWs);

    const updated = mockSession.users.get('userA');
    expect(updated.x).toBe(50);
    expect(updated.y).toBe(60);

    expect(broadcastToSession).toHaveBeenCalledWith(mockSession, {
      type: MESSAGE_TYPES.CURSOR_UPDATE,
      userId: 'userA',
      x: 50,
      y: 60,
    });
  });

  test('handleCursorUpdate => does nothing if user not in session', () => {
    broadcastToSession.mockClear();
    handleCursorUpdate(mockSession, { userId: 'unknown', x: 99, y: 99 }, mockWs);
    expect(broadcastToSession).not.toHaveBeenCalled();
  });

  test('handleCursorUpdate => does nothing if session is null or undefined', () => {
    handleCursorUpdate(null, { userId: 'userA', x: 10, y: 10 }, mockWs);
    expect(broadcastToSession).not.toHaveBeenCalled();
  });
});
