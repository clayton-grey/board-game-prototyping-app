/**
 * ./server/ws/collabUtils.js
 *
 * Shared utility functions used by multiple handlers.
 */
import { WebSocket } from 'ws';
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

/**
 * Broadcast a data object (JSON) to all sockets in a given session.
 */
export function broadcastToSession(session, data) {
  const msg = JSON.stringify(data);
  for (const user of session.users.values()) {
    if (user.socket && user.socket.readyState === WebSocket.OPEN) {
      user.socket.send(msg);
    }
  }
}

/**
 * Broadcast the current element state (elements array + projectName) to all in the session.
 */
export function broadcastElementState(session) {
  broadcastToSession(session, {
    type: MESSAGE_TYPES.ELEMENT_STATE,
    elements: session.elements,
    projectName: session.projectName,
  });
}

/**
 * Broadcast the current user list, sorted by joinOrder, plus info about the current owner.
 */
export function broadcastUserList(session) {
  const sorted = [...session.users.values()].sort((a, b) => a.joinOrder - b.joinOrder);
  let currentOwnerId = null;
  const userList = sorted.map(u => {
    if (u.isOwner) currentOwnerId = u.userId;
    return {
      userId: u.userId,
      name: u.name,
      color: u.color,
      isOwner: !!u.isOwner,
      isEditor: !!u.isEditor,
      isAdmin: !!u.isAdmin,
    };
  });

  broadcastToSession(session, {
    type: MESSAGE_TYPES.SESSION_USERS,
    users: userList,
    ownerUserId: currentOwnerId,
  });
}
