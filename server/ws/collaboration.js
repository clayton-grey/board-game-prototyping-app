// ./server/ws/collaboration.js

import { WebSocket } from 'ws';
// server file at ./server/ws/collaboration.js
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

/**
 * Example in-memory server state:
 * For demonstration, we have two rectangles on the board.
 * Each element has an id, x, y, w, h, and lockedBy (indicating which user is holding it).
 */
const serverState = {
  elements: [
    { id: 1, x: 100, y: 100, w: 50, h: 50, lockedBy: null },
    { id: 2, x: 300, y: 200, w: 60, h: 80, lockedBy: null },
  ]
};

// Keep track of connected users/cursors from the earlier example
const activeUsers = new Map();

/**
 * Broadcast a JSON-serializable message to all connected WebSocket clients.
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
 * Send the full element state to a single socket or broadcast to everyone.
 */
function sendElementState(wsOrWss, isBroadcast = false) {
  const payload = {
    type: MESSAGE_TYPES.ELEMENT_STATE,
    elements: serverState.elements
  };

  if (isBroadcast) {
    broadcast(wsOrWss, payload);
  } else {
    wsOrWss.send(JSON.stringify(payload));
  }
}

/**
 * Handle a new WebSocket connection and subsequent messages.
 */
export function handleWebSocketConnection(ws, wss) {
  console.log('New WebSocket connection');

  // On connect, send the current element state so the client can render immediately
  sendElementState(ws);

  ws.on('message', (rawMessage) => {
    let data;
    try {
      data = JSON.parse(rawMessage);
    } catch (error) {
      console.error('WebSocket JSON Parse Error:', error.message);
      return;
    }

    // Store user’s ID on the socket if it’s a cursor-update
    if (data.type === MESSAGE_TYPES.CURSOR_UPDATE) {
      // keep old cursor logic
      activeUsers.set(data.userId, {
        x: data.x,
        y: data.y,
        socket: ws,
      });
      ws.userId = data.userId;

      // broadcast cursors to all
      const cursorData = {
        type: MESSAGE_TYPES.CURSOR_UPDATES,
        cursors: Object.fromEntries(
          [...activeUsers].map(([userId, { x, y }]) => [userId, { x, y }])
        ),
      };
      broadcast(wss, cursorData);
      return;
    }

    // Handle element-based messages
    switch (data.type) {
      case MESSAGE_TYPES.ELEMENT_GRAB: {
        // User wants to grab an element
        const { userId, elementId } = data;
        const elem = serverState.elements.find(e => e.id === elementId);
        if (!elem) return; // Invalid element

        // If not locked, or locked by this same user, let them grab it
        if (elem.lockedBy === null || elem.lockedBy === userId) {
          elem.lockedBy = userId;
          sendElementState(wss, true); // broadcast updated state
        }
        break;
      }

      case MESSAGE_TYPES.ELEMENT_MOVE: {
        // A user is dragging an already-locked element
        const { userId, elementId, x, y } = data;
        const elem = serverState.elements.find(e => e.id === elementId);
        if (!elem) return; // no such element
        if (elem.lockedBy !== userId) return; // not allowed to move

        // Update position
        elem.x = x;
        elem.y = y;
        sendElementState(wss, true); // broadcast updated position
        break;
      }

      case MESSAGE_TYPES.ELEMENT_RELEASE: {
        // User releases the element
        const { userId, elementId } = data;
        const elem = serverState.elements.find(e => e.id === elementId);
        if (!elem) return;
        if (elem.lockedBy === userId) {
          elem.lockedBy = null; // free it
          sendElementState(wss, true);
        }
        break;
      }

      default:
        // ignore unknown message types
        break;
    }
  });

  ws.on('close', () => {
    console.log('WebSocket disconnected');

    // Remove the user from activeUsers if ws.userId is set
    if (ws.userId) {
      activeUsers.delete(ws.userId);
      // If the user was holding an element, release it
      for (const elem of serverState.elements) {
        if (elem.lockedBy === ws.userId) {
          elem.lockedBy = null;
        }
      }
    }

    // Broadcast cursors
    const cursorData = {
      type: MESSAGE_TYPES.CURSOR_UPDATES,
      cursors: Object.fromEntries(
        [...activeUsers].map(([userId, { x, y }]) => [userId, { x, y }])
      ),
    };
    broadcast(wss, cursorData);

    // Also broadcast new element state if any were released
    sendElementState(wss, true);
  });
}
