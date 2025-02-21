// ./client/js/wsMessageTypes.js

/**
 * Centralized list of WebSocket message types to avoid typos.
 * You can import this file in both client and server if desired.
 */
export const MESSAGE_TYPES = {
  CURSOR_UPDATE: 'cursor-update',
  CURSOR_UPDATES: 'cursor-updates',
  
  ELEMENT_GRAB: 'element-grab',
  ELEMENT_MOVE: 'element-move',
  ELEMENT_RELEASE: 'element-release',
  
  ELEMENT_STATE: 'element-state',
};
