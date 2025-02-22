import { SessionService } from '../../services/SessionService.js';
import { broadcastUserList, broadcastElementState } from '../collabUtils.js';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';

/**
 * handleJoinSession
 *   - fetch or create session
 *   - add user to session
 *   - attach ws fields
 *   - broadcast
 */
export function handleJoinSession(session, data, ws) {
  let { userId, name, sessionCode, userRole } = data;
  if (!userId) return;

  if (!sessionCode) {
    sessionCode = "defaultSession";
  }

  // If no session, create or fetch
  if (!session) {
    session = SessionService.getOrCreateSession(sessionCode);
  }

  const userObj = SessionService.joinSession(session, userId, name, userRole, ws);
  ws.sessionCode = session.code;
  ws.userId = userId;

  // broadcast
  broadcastUserList(session);
  broadcastElementState(session);
}

export function handleUpgradeUserId(session, data, ws) {
  if (!session) return;
  const { oldUserId, newUserId, newName, newIsAdmin } = data;

  const userObj = SessionService.upgradeUserId(session, oldUserId, newUserId, newName, newIsAdmin, ws);
  if (!userObj) return;

  ws.userId = newUserId;
  broadcastUserList(session);
  broadcastElementState(session);
}

export function handleDowngradeUserId(session, data, ws) {
  if (!session) return;
  const { oldUserId, newUserId } = data;

  const userObj = SessionService.downgradeUserId(session, oldUserId, newUserId, ws);
  if (!userObj) return;

  ws.userId = newUserId;
  broadcastUserList(session);
  broadcastElementState(session);
}
