// ./server/ws/handlers/chatHandlers.js

import { broadcastToSession } from '../collabUtils.js';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { sessionGuard } from './handlerUtils.js';

export const handleChatMessage = sessionGuard((session, data, ws) => {
  const { userId, text } = data;
  if (!text || !userId) return;

  if (!session.chatMessages) {
    session.chatMessages = [];
  }

  const msgObj = {
    userId,
    text,
    timestamp: Date.now(),
  };

  session.chatMessages.push(msgObj);

  broadcastToSession(session, {
    type: MESSAGE_TYPES.CHAT_MESSAGE,
    message: msgObj,
  });
});
