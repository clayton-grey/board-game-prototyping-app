// server/collaboration.js
import { WebSocket } from 'ws';

// We'll store user cursor positions and their corresponding sockets
const activeUsers = new Map();

/**
 * A small enumerated set of message types to avoid typos
 */
export const MESSAGE_TYPES = {
  CURSOR_UPDATE: 'cursor-update',
  CURSOR_UPDATES: 'cursor-updates'
};

/**
 * Broadcast a message to all connected WebSocket clients.
 */
function broadcast(wss, data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Handle a new WebSocket connection and subsequent messages.
 */
export function handleWebSocketConnection(ws, wss) {
  console.log('New WebSocket connection');

  ws.on('message', (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage);

      if (data.type === MESSAGE_TYPES.CURSOR_UPDATE) {
        // Store user cursor position
        activeUsers.set(data.userId, {
          x: data.x,
          y: data.y,
          socket: ws,
        });

        /* Also store userId on ws so we can remove quickly on disconnect */
        ws.userId = data.userId;

        // Broadcast updated cursor positions to all
        const cursorData = {
          type: MESSAGE_TYPES.CURSOR_UPDATES,
          cursors: Object.fromEntries(
            [...activeUsers].map(([userId, { x, y }]) => [userId, { x, y }])
          ),
        };
        broadcast(wss, cursorData);
      }
      // You can handle other event types here...
    } catch (error) {
      console.error('WebSocket JSON Parse Error:', error.message);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket disconnected');

    // Remove the user from activeUsers if ws.userId is set
    if (ws.userId) {
      activeUsers.delete(ws.userId);
    }

    // Optional: broadcast that user left
    const cursorData = {
      type: MESSAGE_TYPES.CURSOR_UPDATES,
      cursors: Object.fromEntries(
        [...activeUsers].map(([userId, { x, y }]) => [userId, { x, y }])
      ),
    };
    broadcast(wss, cursorData);
  });
}
