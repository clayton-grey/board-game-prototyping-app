// ./server/ws/collaboration.js

import { WebSocket } from 'ws';
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

/**
 * Example in-memory server state.
 * The serverName is "Default Project" so clients see it on first load.
 */
const serverState = {
  projectName: 'Default Project',
  elements: [
    { id: 1, x: 100, y: 100, w: 50, h: 50, lockedBy: null },
    { id: 2, x: 300, y: 200, w: 60, h: 80, lockedBy: null },
  ],
};

/**
 * Keep track of connected users as a Map: userId => {
 *   userId, name, color, x, y, socket
 * }
 */
const activeUsers = new Map();

/**
 * Hash-based color assignment for consistent user colors across sessions.
 */
function colorFromUserId(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const r = (hash >> 16) & 0xff;
  const g = (hash >> 8) & 0xff;
  const b = hash & 0xff;
  return `rgb(${r},${g},${b})`;
}

function broadcast(wss, data) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Send the full element state (elements + project name) to either one socket
 * or broadcast to all if isBroadcast=true.
 */
function sendElementState(wsOrWss, isBroadcast = false) {
  const payload = {
    type: MESSAGE_TYPES.ELEMENT_STATE,
    elements: serverState.elements,
    projectName: serverState.projectName,
  };
  if (isBroadcast) {
    broadcast(wsOrWss, payload);
  } else {
    wsOrWss.send(JSON.stringify(payload));
  }
}

/**
 * Broadcast list of connected users (IDs, names, colors).
 */
function broadcastUserList(wss) {
  const users = [...activeUsers.values()].map((u) => ({
    userId: u.userId,
    name: u.name,
    color: u.color,
  }));
  broadcast(wss, {
    type: MESSAGE_TYPES.SESSION_USERS,
    users,
  });
}

/**
 * Broadcast all cursor positions so each client sees all cursors.
 */
function broadcastCursors(wss) {
  const cursors = {};
  for (const [uid, user] of activeUsers.entries()) {
    cursors[uid] = { x: user.x || 0, y: user.y || 0 };
  }
  broadcast(wss, {
    type: MESSAGE_TYPES.CURSOR_UPDATES,
    cursors,
  });
}

export function handleWebSocketConnection(ws, wss) {
  console.log('New WebSocket connection');
  // Immediately send the initial element state
  sendElementState(ws);

  ws.on('message', (rawMessage) => {
    let data;
    try {
      data = JSON.parse(rawMessage);
    } catch (error) {
      console.error('WebSocket JSON Parse Error:', error.message);
      return;
    }

    switch (data.type) {
      case MESSAGE_TYPES.JOIN_SESSION: {
        const { userId, name } = data;
        if (!userId) return;

        // Derive user color from userId
        const color = colorFromUserId(userId);

        activeUsers.set(userId, {
          userId,
          name: name || 'Unknown',
          color,
          x: 0,
          y: 0,
          socket: ws,
        });
        ws.userId = userId;

        broadcastUserList(wss);
        break;
      }

      case MESSAGE_TYPES.CURSOR_UPDATE: {
        const { userId, x, y } = data;
        if (!userId) return;
        const user = activeUsers.get(userId);
        if (!user) return;
        user.x = x;
        user.y = y;

        // Broadcast updated cursor positions
        broadcastCursors(wss);

        // For older "cursor-update" code:
        broadcast(wss, {
          type: 'cursor-update',
          userId,
          x,
          y,
        });
        break;
      }

      case MESSAGE_TYPES.ELEMENT_GRAB: {
        const { userId, elementId } = data;
        const elem = serverState.elements.find((e) => e.id === elementId);
        if (!elem) return;
        // Lock if free or already locked by same user
        if (!elem.lockedBy || elem.lockedBy === userId) {
          elem.lockedBy = userId;
          sendElementState(wss, true);
        }
        break;
      }

      case MESSAGE_TYPES.ELEMENT_MOVE: {
        const { userId, elementId, x, y } = data;
        const elem = serverState.elements.find((e) => e.id === elementId);
        if (!elem) return;
        if (elem.lockedBy !== userId) return; // locked by someone else => ignore

        elem.x = x;
        elem.y = y;
        sendElementState(wss, true);
        break;
      }

      case MESSAGE_TYPES.ELEMENT_RELEASE: {
        const { userId, elementId } = data;
        const elem = serverState.elements.find((e) => e.id === elementId);
        if (!elem) return;
        if (elem.lockedBy === userId) {
          elem.lockedBy = null;
          sendElementState(wss, true);
        }
        break;
      }

      case MESSAGE_TYPES.PROJECT_NAME_CHANGE: {
        const { newName } = data;
        if (typeof newName === 'string') {
          serverState.projectName = newName;
          broadcast(wss, {
            type: MESSAGE_TYPES.PROJECT_NAME_CHANGE,
            newName,
          });
        }
        break;
      }

      default:
        // ignore
        break;
    }
  });

  ws.on('close', () => {
    console.log('WebSocket disconnected');
    if (ws.userId && activeUsers.has(ws.userId)) {
      // Release any elements locked by that user
      for (const el of serverState.elements) {
        if (el.lockedBy === ws.userId) {
          el.lockedBy = null;
        }
      }
      activeUsers.delete(ws.userId);
      broadcastUserList(wss);
      sendElementState(wss, true);
    }
  });
}
