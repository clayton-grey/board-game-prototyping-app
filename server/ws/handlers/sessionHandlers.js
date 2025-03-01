// server/ws/sessionHandlers.js

import { SessionService } from '../../services/SessionService.js';
import { broadcastUserList, broadcastElementState } from '../collabUtils.js';

/**
 * handleJoinSession
 */
export function handleJoinSession(session, data, ws) {
  const { userId, name, sessionCode, userRole } = data;
  if (!userId) return;

  // If userRole === 'admin', isAdmin = true, else undefined (not false)
  let isAdmin;
  if (userRole === 'admin') {
    isAdmin = true;
  }

  const theSession = session || SessionService.getOrCreateSession(sessionCode || 'defaultSession');
  const userObj = theSession.addUser(userId, name, isAdmin, ws);

  ws.sessionCode = theSession.code;
  ws.userId = userObj.userId;

  broadcastUserList(theSession);
  broadcastElementState(theSession);
}

/**
 * handleUpgradeUserId
 */
export function handleUpgradeUserId(session, data, ws) {
  if (!session) return;
  const { oldUserId, newUserId, newName, newIsAdmin } = data;

  const userObj = session.upgradeUserId(
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

/**
 * handleDowngradeUserId
 */
export function handleDowngradeUserId(session, data, ws) {
  if (!session) return;
  const { oldUserId, newUserId } = data;

  const userObj = session.downgradeUserId(oldUserId, newUserId, ws);
  if (!userObj) return;

  ws.userId = userObj.userId;
  broadcastUserList(session);
  broadcastElementState(session);
}
