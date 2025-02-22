/**
 * ./server/ws/handlers/elementHandlers.js
 *
 * Handles messages: ELEMENT_GRAB, ELEMENT_MOVE, ELEMENT_RELEASE
 */
import { broadcastElementState } from '../collabUtils.js';

export function handleElementGrab(session, data, ws) {
  if (!session) return;
  const { userId, elementId } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // Lock if no lock or lockedBy me
  if (!el.lockedBy || el.lockedBy === userId) {
    el.lockedBy = userId;
    broadcastElementState(session);
  }
}

export function handleElementMove(session, data, ws) {
  if (!session) return;
  const { userId, elementId, x, y } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // Only move if locked by me
  if (el.lockedBy === userId) {
    el.x = x;
    el.y = y;
    broadcastElementState(session);
  }
}

export function handleElementRelease(session, data, ws) {
  if (!session) return;
  const { userId, elementId } = data;
  const el = session.elements.find(e => e.id === elementId);
  if (!el) return;

  // Only release if locked by me
  if (el.lockedBy === userId) {
    el.lockedBy = null;
    broadcastElementState(session);
  }
}
