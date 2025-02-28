// tests/unit/permissionHandlers.test.js

import { handleMakeEditor, handleRemoveEditor, handleKickUser } from '../../server/ws/handlers/permissionHandlers.js';
import { SessionService } from '../../server/services/SessionService.js';
import { broadcastUserList, broadcastElementState, broadcastToSession } from '../../server/ws/collabUtils.js';
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';
import { WebSocket } from 'ws';

jest.mock('../../server/services/SessionService.js');
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
      elements: []
    };
  });

  test('handleMakeEditor => only works if canManage returns true and user is found', () => {
    // Suppose user1 is the one sending the request, user2 is the target
    const user1 = { userId: 'user1', isOwner: true };
    const user2 = { userId: 'user2', isEditor: false };
    mockSession.users.set('user1', user1);
    mockSession.users.set('user2', user2);

    SessionService.canManage.mockReturnValue(true);

    handleMakeEditor(mockSession, { userId: 'user1', targetUserId: 'user2' }, mockWs);
    expect(SessionService.setEditorRole).toHaveBeenCalledWith(mockSession, 'user2', true);
    expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
  });

  test('handleMakeEditor => does nothing if SessionService.canManage = false', () => {
    SessionService.canManage.mockReturnValue(false);
    handleMakeEditor(mockSession, { userId: 'x', targetUserId: 'y' }, mockWs);
    expect(SessionService.setEditorRole).not.toHaveBeenCalled();
    expect(broadcastUserList).not.toHaveBeenCalled();
  });

  test('handleRemoveEditor => unsets editor role if canManage = true', () => {
    const adminUser = { userId: 'admin', isAdmin: true };
    const normalUser = { userId: 'u100', isEditor: true };
    mockSession.users.set('admin', adminUser);
    mockSession.users.set('u100', normalUser);

    SessionService.canManage.mockReturnValue(true);

    handleRemoveEditor(mockSession, { userId: 'admin', targetUserId: 'u100' }, mockWs);
    expect(SessionService.setEditorRole).toHaveBeenCalledWith(mockSession, 'u100', false);
    expect(broadcastUserList).toHaveBeenCalled();
  });

  test('handleKickUser => calls SessionService.kickUser if can manage, broadcasts', () => {
    const userA = { userId: 'userA', isOwner: true };
    const userB = { userId: 'userB' };
    mockSession.users.set('userA', userA);
    mockSession.users.set('userB', userB);

    SessionService.kickUser.mockReturnValue({
      userId: 'userB',
      socket: { send: jest.fn(), readyState: WebSocket.OPEN }
    });

    handleKickUser(mockSession, { userId: 'userA', targetUserId: 'userB' }, mockWs);

    expect(SessionService.kickUser).toHaveBeenCalledWith(mockSession, 'userA', 'userB');
    expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
    expect(broadcastElementState).toHaveBeenCalledWith(mockSession);

    // Also expect kicked user's socket to receive a "KICKED" message
    const kickedUser = SessionService.kickUser.mock.results[0].value;
    expect(kickedUser.socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: MESSAGE_TYPES.KICKED }),
      expect.any(Function)
    );
  });

  test('handleKickUser => no action if SessionService.kickUser returns null', () => {
    SessionService.kickUser.mockReturnValue(null);
    handleKickUser(mockSession, { userId: 'admin', targetUserId: 'somebody' }, mockWs);
    expect(broadcastUserList).not.toHaveBeenCalled();
    expect(broadcastElementState).not.toHaveBeenCalled();
    expect(broadcastToSession).not.toHaveBeenCalled();
  });
});
