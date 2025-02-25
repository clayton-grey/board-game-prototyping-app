// ./server/ws/handlers/chatHandlers.js
// feat: ephemeral chat - store and broadcast chat messages

import { broadcastToSession } from '../collabUtils.js';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { SessionService } from '../../services/SessionService.js';

/**
 * handleChatMessage:
 *   - Store in ephemeral session.chatMessages
 *   - Broadcast the new message to the entire session
 */
export function handleChatMessage(session, data, ws) {
  if (!session) return;
  const { userId, text } = data;
  if (!text || !userId) return;

  // Ensure there's a chatMessages array in the session
  if (!session.chatMessages) {
    session.chatMessages = [];
  }

  const msgObj = {
    userId,
    text,
    timestamp: Date.now(),
  };

  session.chatMessages.push(msgObj);

  // Broadcast the new chat message
  broadcastToSession(session, {
    type: MESSAGE_TYPES.CHAT_MESSAGE,
    message: msgObj,
  });
}
