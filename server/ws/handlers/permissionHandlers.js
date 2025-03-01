// server/ws/handlers/permissionHandlers.js

import { broadcastUserList, broadcastElementState } from '../collabUtils.js';
import { WebSocket } from 'ws';
import { sessionGuard } from './handlerUtils.js';

export const handleMakeEditor = sessionGuard((session, data, ws) => {
  const { userId, targetUserId } = data;
  if (!session.canManage(userId)) {
    return;
  }
  const tgtUser = session.users.get(targetUserId);
  if (!tgtUser) return;

  if (!tgtUser.isOwner && !tgtUser.isAdmin) {
    session.setEditorRole(targetUserId, true);
    broadcastUserList(session);
  }
});

export const handleRemoveEditor = sessionGuard((session, data, ws) => {
  const { userId, targetUserId } = data;
  if (!session.canManage(userId)) {
    return;
  }
  const tgtUser = session.users.get(targetUserId);
  if (!tgtUser) return;

  if (tgtUser.isEditor) {
    session.setEditorRole(targetUserId, false);
    broadcastUserList(session);
  }
});

export const handleKickUser = sessionGuard((session, data, ws) => {
  const { userId, targetUserId } = data;
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
