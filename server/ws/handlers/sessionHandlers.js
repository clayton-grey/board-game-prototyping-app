// =========================
// FILE: server/ws/handlers/sessionHandlers.js
// =========================

import { SessionService } from '../../services/SessionService.js';
import { broadcastUserList, broadcastElementState } from '../collabUtils.js';
import { sessionGuard } from './handlerUtils.js';

/**
 * handleJoinSession remains unguarded because it can create or retrieve a session
 * if none is provided.
 */
export function handleJoinSession(session, data, ws) {
  const { userId, name, sessionCode, userRole } = data;
  if (!userId) return;

  // If session is not explicitly passed, we fetch or create:
  const theSession = session || SessionService.getOrCreateSession(sessionCode || 'defaultSession');

  // Instead of always "false" for non-admin, we pass `undefined` if userRole != 'admin'.
  const isAdmin = (userRole === 'admin') ? true : undefined;

  const userObj = theSession.addUser(userId, name, isAdmin, ws);

  ws.sessionCode = theSession.code;
  ws.userId = userObj.userId;

  broadcastUserList(theSession);
  broadcastElementState(theSession);
}

export const handleUpgradeUserId = sessionGuard((session, data, ws) => {
  const { oldUserId, newUserId, newName, newIsAdmin } = data;
  // Merge old ephemeral user → newly logged-in user
  const userObj = session.upgradeUserId(
    oldUserId,
    newUserId,
    newName,
    newIsAdmin,
    ws
  );
  if (!userObj) return;

  // Update the ws fields to reflect the new ID
  ws.userId = userObj.userId;

  // *** CRITICAL FIX: Always broadcast after upgrade ***
  broadcastUserList(session);
  broadcastElementState(session);
});

export const handleDowngradeUserId = sessionGuard((session, data, ws) => {
  const { oldUserId, newUserId } = data;

  const userObj = session.downgradeUserId(oldUserId, newUserId, ws);
  if (!userObj) return;

  ws.userId = userObj.userId;
  broadcastUserList(session);
  broadcastElementState(session);
});
