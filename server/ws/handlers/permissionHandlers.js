// server/ws/handlers/permissionHandlers.js

import { broadcastUserList, broadcastElementState } from '../collabUtils.js';
import { WebSocket } from 'ws';
import { sessionGuard } from './handlerUtils.js';
import { canManageOthers, canKickUser } from '../../utils/Permissions.js';

export const handleMakeEditor = sessionGuard((session, data, ws) => {
  const { userId, targetUserId } = data;
  const manager = session.users.get(userId);
  const target = session.users.get(targetUserId);
  if (!manager || !target) return;

  if (!canManageOthers(manager)) {
    return;
  }

  // set sessionRole='editor' if target isn't already 'owner' or 'admin' 
  // (though admin is global, we could allow an admin to also be an 'editor', 
  // but that may be redundant).
  if (target.sessionRole !== 'owner') {
    session.setEditorRole(targetUserId, true);
    broadcastUserList(session);
  }
});

export const handleRemoveEditor = sessionGuard((session, data, ws) => {
  const { userId, targetUserId } = data;
  const manager = session.users.get(userId);
  const target = session.users.get(targetUserId);
  if (!manager || !target) return;

  if (!canManageOthers(manager)) {
    return;
  }

  if (target.sessionRole === 'editor') {
    session.setEditorRole(targetUserId, false);
    broadcastUserList(session);
  }
});

export const handleKickUser = sessionGuard((session, data, ws) => {
  const { userId, targetUserId } = data;
  const kicker = session.users.get(userId);
  const target = session.users.get(targetUserId);
  if (!kicker || !target) return;

  if (!canKickUser(kicker, target)) {
    return;
  }

  const kickedUser = session.kickUser(userId, targetUserId);
  if (!kickedUser) {
    return;
  }

  broadcastUserList(session);
  broadcastElementState(session);

  if (kickedUser.socket && kickedUser.socket.readyState === WebSocket.OPEN) {
    kickedUser.socket.send(JSON.stringify({ type: 'kicked' }), () => {
      setTimeout(() => kickedUser.socket.close(), 50);
    });
  } else {
    kickedUser.socket?.close();
  }
});
