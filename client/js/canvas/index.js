/**
 * client/js/canvas/index.js
 *
 * The main orchestrator that initializes the canvas, sets up
 * event listeners for the Zoom In / Zoom Out / Frame All buttons,
 * and re-exports relevant functions.
 */

import { MESSAGE_TYPES } from "../../../shared/wsMessageTypes.js";
import { state, setCurrentProjectName } from "./canvasState.js";
import { initPointerAndKeyEvents } from "./canvasEvents.js";
import {
  setLocalUserId,
  createOrUpdateElementsFromServer,
  removeObsoleteSelections,
  handleCursorData,
  removeStaleRemoteCursors,
} from "./canvasTools.js";
import { requestRender } from "./canvasRender.js";
import { handleUserColorUpdate } from "./canvasUsers.js";
import { zoomAroundCenter, frameAllElements } from "./canvasCamera.js";

/**
 * Initialize the canvas with the current userId,
 * attach event handlers, set up the tools palette, etc.
 */
export function initCanvas(initialUserId) {
  setLocalUserId(initialUserId);

  // Attach pointer events & key events
  initPointerAndKeyEvents();

  // Initialize the Tools Palette (click => "selected" class)
  initToolsPalette();

  // Wire up zoom-in, zoom-out, frame-all
  setupZoomUI();

  // Start initial render
  requestRender();
}

/** Handle a canvas-related message from the server. */
export function handleCanvasMessage(data, myUserId) {
  switch (data.type) {
    case MESSAGE_TYPES.ELEMENT_STATE: {
      createOrUpdateElementsFromServer(data.elements);
      if (typeof data.projectName === "string") {
        setCurrentProjectName(data.projectName);
        window.currentProjectName = data.projectName; // fallback for UI
      }
      // Remove local selections that are invalid
      removeObsoleteSelections(myUserId);
      break;
    }
    case MESSAGE_TYPES.CURSOR_UPDATE:
    case MESSAGE_TYPES.CURSOR_UPDATES:
      handleCursorData(data, myUserId);
      break;
    default:
      // Other server messages (move, grab, etc.)
      // get handled indirectly by the local pointer logic or do nothing.
      break;
  }
  requestRender();
}

/** If local user ID changes (e.g. login/out), update references. */
export function updateCanvasUserId(newId) {
  setLocalUserId(newId);
}

/** The server can rename the project => store it. */
export function setProjectNameFromServer(newName) {
  setCurrentProjectName(newName);
  window.currentProjectName = newName;
  requestRender();
}

/** Remove remote cursors for user IDs not in the new user list. */
export function removeCursorsForMissingUsers(currentUserIds) {
  removeStaleRemoteCursors(currentUserIds);
  requestRender();
}

// Re-export so other code can do handleUserColorUpdate
export { handleUserColorUpdate };

/* ------------------------------------------------------------------
   Tools Palette
------------------------------------------------------------------ */
function initToolsPalette() {
  const palette = document.getElementById("tools-palette");
  if (!palette) return;
  const buttons = palette.querySelectorAll(".tool-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
  });
}

/* ------------------------------------------------------------------
   Zoom UI => wire up the #zoom-in, #zoom-out, #frame-all buttons
------------------------------------------------------------------ */
function setupZoomUI() {
  const zoomInBtn = document.getElementById("zoom-in");
  const zoomOutBtn = document.getElementById("zoom-out");
  const frameBtn = document.getElementById("frame-all");

  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
      zoomAroundCenter(+0.25);
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      zoomAroundCenter(-0.25);
    });
  }
  if (frameBtn) {
    frameBtn.addEventListener("click", () => {
      frameAllElements();
    });
  }
}
