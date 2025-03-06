// ./server/ws/handlers/cursorHandlers.js

import { broadcastToSession } from "../collabUtils.js";
import { MESSAGE_TYPES } from "../../../shared/wsMessageTypes.js";
import { sessionGuard } from "./handlerUtils.js";

export const handleCursorUpdate = sessionGuard((session, data, ws) => {
  const { userId, x, y } = data;

  const user = session.users.get(userId);
  if (!user) return;

  user.x = x;
  user.y = y;

  broadcastToSession(session, {
    type: MESSAGE_TYPES.CURSOR_UPDATE,
    userId,
    x,
    y,
  });
});
