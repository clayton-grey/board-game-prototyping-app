// tests/unit/permissionHandlers.test.js
// Only changes shown; the rest is the same structure.

import {
  handleMakeEditor,
  handleRemoveEditor,
  handleKickUser
} from '../../server/ws/handlers/permissionHandlers.js';
import {
  broadcastUserList,
  broadcastElementState,
  broadcastToSession
} from '../../server/ws/collabUtils.js';
import { WebSocket } from 'ws';

jest.mock('../../server/ws/collabUtils.js', () => ({
  broadcastUserList: jest.fn(),
  broadcastElementState: jest.fn(),
  broadcastToSession: jest.fn()
}));

describe('permissionHandlers', () => {
  let mockSession, mockWs;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWs = { send: jest.fn(), readyState: WebSocket.OPEN };

    mockSession = {
      code: 'test-permissions',
      users: new Map(),
      elements: [],
      canManage: jest.fn(),  // we still mock it
      setEditorRole: jest.fn(),
      kickUser: jest.fn(),
    };
  });

  test('handleMakeEditor => only works if canManage returns true and user is found', () => {
    const user1 = { userId: 'user1', sessionRole: 'owner', globalRole: 'user' };
    const user2 = { userId: 'user2', sessionRole: 'viewer', globalRole: 'user' };
    mockSession.users.set('user1', user1);
    mockSession.users.set('user2', user2);

    mockSession.canManage.mockReturnValue(true);

    handleMakeEditor(mockSession, { userId: 'user1', targetUserId: 'user2' }, mockWs);
    expect(mockSession.setEditorRole).toHaveBeenCalledWith('user2', true);
    expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
  });

  test('handleMakeEditor => does nothing if session.canManage = false', () => {
    mockSession.canManage.mockReturnValue(false);
    handleMakeEditor(mockSession, { userId: 'x', targetUserId: 'y' }, mockWs);

    expect(mockSession.setEditorRole).not.toHaveBeenCalled();
    expect(broadcastUserList).not.toHaveBeenCalled();
  });

  test('handleRemoveEditor => unsets editor role if canManage = true', () => {
    const adminUser = { userId: 'admin', globalRole: 'admin', sessionRole: 'viewer' };
    const normalUser = { userId: 'u100', sessionRole: 'editor', globalRole: 'user' };
    mockSession.users.set('admin', adminUser);
    mockSession.users.set('u100', normalUser);

    mockSession.canManage.mockReturnValue(true);

    handleRemoveEditor(mockSession, { userId: 'admin', targetUserId: 'u100' }, mockWs);
    expect(mockSession.setEditorRole).toHaveBeenCalledWith('u100', false);
    expect(broadcastUserList).toHaveBeenCalled();
  });

  test('handleKickUser => calls session.kickUser if canManage, broadcasts', () => {
    const userA = { userId: 'userA', sessionRole: 'owner', globalRole: 'user' };
    const userB = { userId: 'userB', sessionRole: 'viewer', globalRole: 'user' };
    mockSession.users.set('userA', userA);
    mockSession.users.set('userB', userB);

    mockSession.kickUser.mockReturnValue({
      userId: 'userB',
      socket: { send: jest.fn(), readyState: WebSocket.OPEN }
    });

    handleKickUser(mockSession, { userId: 'userA', targetUserId: 'userB' }, mockWs);

    expect(mockSession.kickUser).toHaveBeenCalledWith('userA', 'userB');
    expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
    expect(broadcastElementState).toHaveBeenCalledWith(mockSession);

    // Check kicked user's socket
    const kickedUser = mockSession.kickUser.mock.results[0].value;
    expect(kickedUser.socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'kicked' }),
      expect.any(Function)
    );
  });
});
