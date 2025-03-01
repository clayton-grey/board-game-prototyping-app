// ./server/ws/handlers/projectHandlers.js

import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { broadcastToSession, broadcastElementState } from '../collabUtils.js';
import { sessionGuard } from './handlerUtils.js';

/**
 * Only owner or admin can rename:
 */
export const handleProjectNameChange = sessionGuard((session, data, ws) => {
  const { userId, newName } = data;
  if (!newName || !userId) return;

  const user = session.users.get(userId);
  if (!user) return;

  if (user.isOwner || user.isAdmin) {
    session.projectName = newName;
    broadcastToSession(session, {
      type: MESSAGE_TYPES.PROJECT_NAME_CHANGE,
      newName,
    });
    broadcastElementState(session);
  }
});
