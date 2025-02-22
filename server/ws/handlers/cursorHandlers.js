/**
 * ./server/ws/handlers/cursorHandlers.js
 *
 * Handles messages for cursor updates.
 */
import { broadcastToSession } from '../collabUtils.js';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';

export function handleCursorUpdate(session, data, ws) {
  if (!session) return;
  const { userId, x, y } = data;

  const user = session.users.get(userId);
  if (!user) return;

  user.x = x;
  user.y = y;

  // Optionally, you can broadcast either single or aggregated updates.
  // The older code sometimes broadcasted CURSOR_UPDATES as a bulk object.
  // We'll do single for simplicity:
  broadcastToSession(session, {
    type: MESSAGE_TYPES.CURSOR_UPDATE,
    userId,
    x,
    y,
  });
}
