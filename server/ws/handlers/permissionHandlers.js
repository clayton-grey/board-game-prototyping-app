// server/ws/handlers/permissionHandlers.js
import { getDbUserId, broadcastUserList, broadcastElementState, broadcastToSession } from '../collabUtils.js';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { WebSocket } from 'ws';
import { SessionService } from '../../services/SessionService.js';

export function handleMakeEditor(session, data, ws) {
  if (!session) return;
  const { userId, targetUserId } = data;
  const reqUser = session.users.get(userId);
  const tgtUser = session.users.get(targetUserId);
  if (!reqUser || !tgtUser) return;

  if (reqUser.isOwner || reqUser.isAdmin) {
    if (!tgtUser.isAdmin && !tgtUser.isOwner) {
      tgtUser.isEditor = true;
      const dbUid = getDbUserId(targetUserId);
      if (dbUid) {
        const ex = session.ephemeralRoles.get(dbUid) || {};
        ex.isEditor = true;
        session.ephemeralRoles.set(dbUid, ex);
      }
      broadcastUserList(session);
    }
  }
}

export function handleRemoveEditor(session, data, ws) {
  if (!session) return;
  const { userId, targetUserId } = data;
  const reqUser = session.users.get(userId);
  const tgtUser = session.users.get(targetUserId);
  if (!reqUser || !tgtUser) return;

  if (reqUser.isOwner || reqUser.isAdmin) {
    if (tgtUser.isEditor) {
      tgtUser.isEditor = false;
      const dbUid = getDbUserId(targetUserId);
      if (dbUid) {
        const ex = session.ephemeralRoles.get(dbUid) || {};
        ex.isEditor = false;
        session.ephemeralRoles.set(dbUid, ex);
      }
      broadcastUserList(session);
    }
  }
}

/**
 * KICK_USER => forcibly remove them from the session
 */
export function handleKickUser(session, data, ws) {
  if (!session) return;
  const { userId, targetUserId } = data;

  // We'll ask SessionService to do the logic
  const kickedUser = SessionService.kickUser(session, userId, targetUserId);
  if (!kickedUser) {
    // Means either not authorized or user is admin/owner => no action
    return;
  }

  // Now that they're removed, broadcast user changes
  broadcastUserList(session);
  broadcastElementState(session);

  // If the kicked user is still connected, notify them
  if (kickedUser.socket && kickedUser.socket.readyState === WebSocket.OPEN) {
    kickedUser.socket.send(JSON.stringify({ type: MESSAGE_TYPES.KICKED }), () => {
      setTimeout(() => kickedUser.socket.close(), 50);
    });
  } else {
    kickedUser.socket?.close();
  }
}
