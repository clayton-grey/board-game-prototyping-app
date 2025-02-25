// server/ws/collaboration.js
import { WebSocket } from 'ws';
import { handleIncomingMessage } from './messageDispatcher.js';
import { SessionService } from '../services/SessionService.js';
import { broadcastUserList, broadcastElementState } from './collabUtils.js';

/**
 * Each new WebSocket connection => store references, handle messages, handle close.
 */
export function handleWebSocketConnection(ws, wss) {
  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      // ignore parse errors
      return;
    }

    // fetch session if known
    const session = ws.sessionCode ? SessionService.getSession(ws.sessionCode) : null;
    handleIncomingMessage(session, data, ws);
  });

  ws.on('close', () => {
    const code = ws.sessionCode;
    const userId = ws.userId;
    if (!code || !userId) return;

    const session = SessionService.getSession(code);
    if (!session) return;

    // Remove user => frees locks, etc.
    SessionService.removeUser(session, userId);

    // Now broadcast updated user list & element state so
    // other clients see the freed locks & updated session users
    broadcastUserList(session);
    broadcastElementState(session);

    // If no users remain, remove the session from memory
    if (session.users.size === 0) {
      SessionService.removeSession(code);
    }
  });
}
