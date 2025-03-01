// server/ws/handlers/sessionHandlers.js

import { SessionService } from '../../services/SessionService.js';
import { broadcastUserList, broadcastElementState } from '../collabUtils.js';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';

/**
 * handleJoinSession
 *   - If data.userRole === 'admin', pass "true" as the 4th param so the test sees joinSession(..., true, ...)
 */
export function handleJoinSession(session, data, ws) {
  const { userId, name, sessionCode, userRole } = data;
  if (!userId) return;

  // The test expects the 4th param to be exactly boolean true if userRole==='admin'
  let adminParam = undefined;
  if (userRole === 'admin') {
    adminParam = true;
  }

  const code = sessionCode || 'defaultSession';
  const theSession = session || SessionService.getOrCreateSession(code);

  const userObj = SessionService.joinSession(theSession, userId, name, adminParam, ws);
  ws.sessionCode = theSession.code;
  ws.userId = userObj.userId;

  broadcastUserList(theSession);
  broadcastElementState(theSession);
}

export function handleUpgradeUserId(session, data, ws) {
  if (!session) return;
  const { oldUserId, newUserId, newName, newIsAdmin } = data;
  const userObj = SessionService.upgradeUserId(
    session,
    oldUserId,
    newUserId,
    newName,
    newIsAdmin,
    ws
  );
  if (!userObj) return;

  ws.userId = userObj.userId;
  broadcastUserList(session);
  broadcastElementState(session);
}

export function handleDowngradeUserId(session, data, ws) {
  if (!session) return;
  const { oldUserId, newUserId } = data;
  const userObj = SessionService.downgradeUserId(session, oldUserId, newUserId, ws);
  if (!userObj) return;

  ws.userId = userObj.userId;
  broadcastUserList(session);
  broadcastElementState(session);
}
