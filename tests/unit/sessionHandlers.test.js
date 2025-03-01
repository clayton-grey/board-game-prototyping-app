// tests/unit/sessionHandlers.test.js

import {
  handleJoinSession,
  handleUpgradeUserId,
  handleDowngradeUserId
} from '../../server/ws/handlers/sessionHandlers.js';
import { SessionService } from '../../server/services/SessionService.js';
import {
  broadcastUserList,
  broadcastElementState
} from '../../server/ws/collabUtils.js';

jest.mock('../../server/services/SessionService.js');
jest.mock('../../server/ws/collabUtils.js', () => ({
  broadcastUserList: jest.fn(),
  broadcastElementState: jest.fn(),
}));

describe('sessionHandlers', () => {
  let mockSession;
  let mockWs;

  beforeEach(() => {
    jest.clearAllMocks();

    mockWs = { send: jest.fn(), sessionCode: undefined, userId: undefined };

    // Our "session" object is the actual one passed to handlers. We'll provide
    // mock methods where needed: addUser, upgradeUserId, etc.
    mockSession = {
      code: 'test-session-code',
      addUser: jest.fn(),
      upgradeUserId: jest.fn(),
      downgradeUserId: jest.fn(),
      users: new Map(),
      elements: [
        { id: 1, lockedBy: null },
        { id: 2, lockedBy: null },
      ],
    };
  });

  describe('handleJoinSession', () => {
    test('creates or fetches session, joins user, sets ws fields, broadcasts', () => {
      SessionService.getOrCreateSession.mockReturnValue(mockSession);

      // Mock addUser to illustrate returning some user object
      mockSession.addUser.mockReturnValue({
        userId: 'userA',
        name: 'Alice',
        isAdmin: true
      });

      const data = {
        type: 'join-session',
        userId: 'userA',
        sessionCode: 'test-session-code',
        name: 'Alice',
        userRole: 'admin',
      };

      handleJoinSession(null, data, mockWs);

      expect(SessionService.getOrCreateSession).toHaveBeenCalledWith('test-session-code');
      expect(mockSession.addUser).toHaveBeenCalledWith('userA', 'Alice', true, mockWs);

      expect(mockWs.sessionCode).toBe('test-session-code');
      expect(mockWs.userId).toBe('userA');

      expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
      expect(broadcastElementState).toHaveBeenCalledWith(mockSession);
    });

    test('if session is already passed in, does not call getOrCreateSession again', () => {
      // We do NOT want SessionService.getOrCreateSession called
      mockSession.addUser.mockReturnValue({
        userId: 'userA',
        name: 'TestUser'
      });

      const data = {
        userId: 'userA',
        sessionCode: 'some-other-code',
        name: 'Test',
      };

      handleJoinSession(mockSession, data, mockWs);

      // We already have a session => no fetch
      expect(SessionService.getOrCreateSession).not.toHaveBeenCalled();

      // We do expect addUser => third param is undefined if userRole not 'admin'
      expect(mockSession.addUser).toHaveBeenCalledWith('userA', 'Test', undefined, mockWs);

      expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
      expect(broadcastElementState).toHaveBeenCalledWith(mockSession);
    });

    test('if userId is missing, does nothing', () => {
      handleJoinSession(mockSession, { sessionCode: 'test' }, mockWs);

      expect(mockSession.addUser).not.toHaveBeenCalled();
      expect(broadcastUserList).not.toHaveBeenCalled();
      expect(broadcastElementState).not.toHaveBeenCalled();
    });
  });

  describe('handleUpgradeUserId', () => {
    test('calls session.upgradeUserId, reassigns ws.userId, then broadcasts', () => {
      mockSession.upgradeUserId.mockReturnValue({ userId: 'newUid' });

      const data = {
        oldUserId: 'temp_1',
        newUserId: 'real_99',
        newName: 'Bob',
        newIsAdmin: true,
      };

      handleUpgradeUserId(mockSession, data, mockWs);

      expect(mockSession.upgradeUserId).toHaveBeenCalledWith(
        'temp_1',
        'real_99',
        'Bob',
        true,
        mockWs
      );
      expect(mockWs.userId).toBe('newUid');

      expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
      expect(broadcastElementState).toHaveBeenCalledWith(mockSession);
    });

    test('does nothing if session is null', () => {
      handleUpgradeUserId(null, { oldUserId: 'u1' }, mockWs);

      expect(broadcastUserList).not.toHaveBeenCalled();
      expect(broadcastElementState).not.toHaveBeenCalled();
    });
  });

  describe('handleDowngradeUserId', () => {
    test('calls session.downgradeUserId, reassigns ws.userId, then broadcasts', () => {
      mockSession.downgradeUserId.mockReturnValue({ userId: 'anon_123' });

      const data = { oldUserId: 'user_7', newUserId: 'anon_111' };
      handleDowngradeUserId(mockSession, data, mockWs);

      expect(mockSession.downgradeUserId).toHaveBeenCalledWith(
        'user_7',
        'anon_111',
        mockWs
      );
      expect(mockWs.userId).toBe('anon_123');

      expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
      expect(broadcastElementState).toHaveBeenCalledWith(mockSession);
    });

    test('does nothing if session is null', () => {
      handleDowngradeUserId(null, { oldUserId: 'u1' }, mockWs);

      expect(broadcastUserList).not.toHaveBeenCalled();
      expect(broadcastElementState).not.toHaveBeenCalled();
    });
  });
});
