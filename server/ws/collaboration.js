// server/ws/collaboration.js
import { WebSocket } from 'ws';
import { handleIncomingMessage } from './messageDispatcher.js';
import { SessionService } from '../services/SessionService.js';

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

    SessionService.removeUser(session, userId);
    if (session.users.size === 0) {
      SessionService.removeSession(code);
    }
  });
}
