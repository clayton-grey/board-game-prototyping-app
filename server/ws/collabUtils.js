/**
 * ./server/ws/collabUtils.js
 */
import { WebSocket } from "ws";
import { MESSAGE_TYPES } from "../../shared/wsMessageTypes.js";

/**
 * Broadcast a data object (JSON) to all connected user sockets in a session.
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
 * (Logging removed for cleanliness. If you want logs, you can add them here.)
 */
export function broadcastElementState(session) {
  broadcastToSession(session, {
    type: MESSAGE_TYPES.ELEMENT_STATE,
    elements: session.elements,
    projectName: session.projectName,
  });
}

/**
 * Broadcast the current user list, sorted by joinOrder.
 */
export function broadcastUserList(session) {
  const sorted = [...session.users.values()].sort(
    (a, b) => a.joinOrder - b.joinOrder,
  );

  const userList = sorted.map((u) => ({
    userId: u.userId,
    name: u.name,
    color: u.color,
    sessionRole: u.sessionRole,
    globalRole: u.globalRole,
  }));

  broadcastToSession(session, {
    type: MESSAGE_TYPES.SESSION_USERS,
    users: userList,
  });
}
