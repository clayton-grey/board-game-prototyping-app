/**
 * ./server/ws/collabUtils.js
 *
 * Shared utility functions used by multiple handlers.
 */
import { WebSocket } from 'ws';
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

/**
 * Broadcast a data object (JSON) to all sockets in session.
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

/**
 * If no owners remain, pick the earliest joined user as owner.
 * If session is now empty, remove it from memory (the caller might do so).
 */
export function reassignOwnerIfNeeded(session) {
  const owners = [...session.users.values()].filter(u => u.isOwner);
  if (owners.length > 0) return;

  const arr = [...session.users.values()];
  if (arr.length === 0) {
    // It's empty, let caller remove the session from map if desired
    return;
  }
  arr.sort((a, b) => a.joinOrder - b.joinOrder);
  arr[0].isOwner = true;
}

/**
 * If userId = "user_5", returns 5; else returns null.
 * Used to map ephemeral "user_#" IDs to a DB user ID.
 */
export function getDbUserId(userId) {
  if (userId.startsWith("user_")) {
    return parseInt(userId.split("_")[1], 10);
  }
  return null;
}

/**
 * Compute a color from the userId string, used to give each user a stable color.
 */
export function colorFromUserId(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const r = (hash >> 16) & 0xff;
  const g = (hash >> 8) & 0xff;
  const b = hash & 0xff;
  return `rgb(${r},${g},${b})`;
}
