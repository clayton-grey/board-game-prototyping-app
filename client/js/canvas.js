// ./client/js/canvas.js
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

/**
 * client/js/canvas.js
 *
 * Aggregator file so that existing imports/tests still work:
 *   import { initCanvas, handleCanvasMessage, ... } from './canvas.js';
 *
 * This re-exports the real logic from ./canvas/index.js,
 * including the missing handleUserColorUpdate.
 */

export {
  // Main public API
  initCanvas,
  handleCanvasMessage,
  updateCanvasUserId,
  setProjectNameFromServer,
  removeCursorsForMissingUsers,
  handleUserColorUpdate
} from './canvas/index.js';

// Optionally export MESSAGE_TYPES if your code/tests expect it from here:
export { MESSAGE_TYPES };
