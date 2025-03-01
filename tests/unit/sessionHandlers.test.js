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
    mockSession = {
      code: 'test-session-code',
      users: new Map(),
      elements: [
        { id: 1, lockedBy: null },
        { id: 2, lockedBy: null },
      ],
      ephemeralRoles: new Map(),
    };
  });

  describe('handleJoinSession', () => {
    test('creates or fetches session, joins user, sets ws fields, broadcasts', () => {
      // Mock the session retrieval
      SessionService.getOrCreateSession.mockReturnValue(mockSession);

      // Mock the joinSession in such a way that we replicate the ephemeralRoles update
      SessionService.joinSession.mockImplementation((session, userId, userName, isAdminFlag, wsSocket) => {
        // We'll do a minimal imitation of the real logic:
        if (isAdminFlag === true) {
          const existing = session.ephemeralRoles.get(userId) || {};
          existing.isAdmin = true;
          session.ephemeralRoles.set(userId, existing);
        }
        return { userId, name: userName, isAdmin: isAdminFlag === true };
      });

      const data = {
        type: 'join-session',
        userId: 'userA',
        sessionCode: 'test-session-code',
        name: 'Alice',
        userRole: 'admin',  // test wants boolean `true` sent to joinSession
      };

      handleJoinSession(null, data, mockWs);

      expect(SessionService.getOrCreateSession).toHaveBeenCalledWith('test-session-code');
      // The 4th param must be true (not 'admin')
      expect(SessionService.joinSession).toHaveBeenCalledWith(
        mockSession,
        'userA',
        'Alice',
        true, 
        mockWs
      );

      expect(mockWs.sessionCode).toBe('test-session-code');
      expect(mockWs.userId).toBe('userA');

      // We'll assume the SessionService (mock) sets ephemeralRoles. Check it:
      const roleData = mockSession.ephemeralRoles.get('userA');
      expect(roleData).toBeDefined();
      expect(roleData.isAdmin).toBe(true);

      // broadcasts
      expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
      expect(broadcastElementState).toHaveBeenCalledWith(mockSession);
    });

    test('if session is already passed in, does not call getOrCreateSession again', () => {
      // Still need to mock joinSession so userObj is not undefined
      SessionService.joinSession.mockImplementation((session, userId, userName, isAdminFlag, wsSocket) => {
        return { userId, name: userName, isAdmin: isAdminFlag === true };
      });

      const data = {
        userId: 'userA',
        sessionCode: 'some-other-code',
        name: 'Test',
      };

      handleJoinSession(mockSession, data, mockWs);

      // We already have a session, so getOrCreateSession is not called
      expect(SessionService.getOrCreateSession).not.toHaveBeenCalled();
      // We pass undefined for 4th param (because userRole not 'admin')
      expect(SessionService.joinSession).toHaveBeenCalledWith(
        mockSession,
        'userA',
        'Test',
        undefined,
        mockWs
      );

      // ephemeralRoles or broadcast calls not tested here
    });

    test('if userId is missing, does nothing', () => {
      // No mocking needed; we expect no calls
      handleJoinSession(mockSession, { sessionCode: 'test' }, mockWs);

      expect(SessionService.joinSession).not.toHaveBeenCalled();
      expect(broadcastUserList).not.toHaveBeenCalled();
      expect(broadcastElementState).not.toHaveBeenCalled();
    });
  });

  describe('handleUpgradeUserId', () => {
    test('calls SessionService.upgradeUserId, reassigns ws.userId, then broadcasts', () => {
      SessionService.upgradeUserId.mockReturnValue({ userId: 'newUid' });

      const data = {
        oldUserId: 'temp_1',
        newUserId: 'real_99',
        newName: 'Bob',
        newIsAdmin: true,
      };

      handleUpgradeUserId(mockSession, data, mockWs);

      expect(SessionService.upgradeUserId).toHaveBeenCalledWith(
        mockSession,
        'temp_1',
        'real_99',
        'Bob',
        true,
        mockWs
      );

      // userObj.userId -> 'newUid'
      expect(mockWs.userId).toBe('newUid');

      expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
      expect(broadcastElementState).toHaveBeenCalledWith(mockSession);
    });

    test('does nothing if session is null', () => {
      handleUpgradeUserId(null, { oldUserId: 'u1' }, mockWs);
      expect(SessionService.upgradeUserId).not.toHaveBeenCalled();
      expect(broadcastUserList).not.toHaveBeenCalled();
      expect(broadcastElementState).not.toHaveBeenCalled();
    });
  });

  describe('handleDowngradeUserId', () => {
    test('calls SessionService.downgradeUserId, reassigns ws.userId, then broadcasts', () => {
      SessionService.downgradeUserId.mockReturnValue({ userId: 'anon_123' });

      const data = { oldUserId: 'user_7', newUserId: 'anon_111' };
      handleDowngradeUserId(mockSession, data, mockWs);

      expect(SessionService.downgradeUserId).toHaveBeenCalledWith(
        mockSession,
        'user_7',
        'anon_111',
        mockWs
      );

      // userObj.userId -> 'anon_123'
      expect(mockWs.userId).toBe('anon_123');

      expect(broadcastUserList).toHaveBeenCalledWith(mockSession);
      expect(broadcastElementState).toHaveBeenCalledWith(mockSession);
    });

    test('does nothing if session is null', () => {
      handleDowngradeUserId(null, { oldUserId: 'u1' }, mockWs);
      expect(SessionService.downgradeUserId).not.toHaveBeenCalled();
      expect(broadcastUserList).not.toHaveBeenCalled();
      expect(broadcastElementState).not.toHaveBeenCalled();
    });
  });
});
