/**
 * client/js/canvas/canvasUsers.js
 *
 * Restores the missing handleUserColorUpdate function
 * for setting each user's color/name in userInfoMap.
 */

import { state } from './canvasState.js';

/**
 * handleUserColorUpdate(userId, name, color):
 *   - Updates the userInfoMap so remote cursors
 *     or other UI can display the correct color & name.
 */
export function handleUserColorUpdate(userId, name, color) {
  state.userInfoMap.set(userId, { name, color });
}
