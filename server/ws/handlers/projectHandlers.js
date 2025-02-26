// ./server/ws/handlers/projectHandlers.js
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { broadcastToSession, broadcastElementState } from '../collabUtils.js';

/**
 * handleProjectNameChange => only if the user isOwner or isAdmin.
 */
export function handleProjectNameChange(session, data, ws) {
  if (!session) return;

  const { userId, newName } = data;
  if (!newName || !userId) return;

  const user = session.users.get(userId);
  if (!user) return;

  // Only owner or admin can rename
  if (user.isOwner || user.isAdmin) {
    session.projectName = newName;

    // Notify everyone that the project name changed
    broadcastToSession(session, {
      type: MESSAGE_TYPES.PROJECT_NAME_CHANGE,
      newName,
    });

    // Re-broadcast the element state (ensures consistent data for all)
    broadcastElementState(session);
  }
}
