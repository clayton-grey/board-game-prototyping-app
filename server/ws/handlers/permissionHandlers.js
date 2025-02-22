// server/ws/handlers/permissionHandlers.js
import { broadcastUserList, broadcastElementState, broadcastToSession } from '../collabUtils.js';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { WebSocket } from 'ws';
import { SessionService } from '../../services/SessionService.js';

export function handleMakeEditor(session, data, ws) {
  if (!session) return;
  const { userId, targetUserId } = data;

  // Only an owner or admin can manage ephemeral roles
  if (!SessionService.canManage(session, userId)) {
    return;
  }
  const tgtUser = session.users.get(targetUserId);
  if (!tgtUser) return;

  // Prevent toggling an owner/admin
  if (!tgtUser.isOwner && !tgtUser.isAdmin) {
    SessionService.setEditorRole(session, targetUserId, true);
    broadcastUserList(session);
  }
}

export function handleRemoveEditor(session, data, ws) {
  if (!session) return;
  const { userId, targetUserId } = data;

  if (!SessionService.canManage(session, userId)) {
    return;
  }
  const tgtUser = session.users.get(targetUserId);
  if (!tgtUser) return;

  if (tgtUser.isEditor) {
    SessionService.setEditorRole(session, targetUserId, false);
    broadcastUserList(session);
  }
}

/**
 * KICK_USER => forcibly remove them from the session
 */
export function handleKickUser(session, data, ws) {
  if (!session) return;
  const { userId, targetUserId } = data;

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
