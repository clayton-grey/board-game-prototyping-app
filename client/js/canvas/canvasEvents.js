/**
 * client/js/canvas/canvasEvents.js
 *
 * Integrates all pointer & key events for the canvas:
 * - SHIFT key logic remains mostly as-is for pointer constraints.
 * - The global keyboard shortcuts for Escape, Delete, Undo/Redo, etc.
 *   are consolidated here in handleGlobalKeyDown.
 */

import { state } from './canvasState.js';
import { requestRender } from './canvasRender.js';
import { handleWheelZoom } from './canvasCamera.js';
import {
  onPointerDownSelectOrCreate,
  onPointerMoveCommon,
  onPointerUpCommon,
  onPointerCancelOrLeaveCommon,
  hitTestResizeHandles,
  startResizing,
  updateResizing,
  endResizing, 
  deselectAll,
  sendDeleteElements
} from './canvasTools.js';

// *** NEW IMPORT: so we can broadcast local pointer updates again ***
import { sendCursorUpdate } from './canvasUtils.js';

import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';

/** Initialize pointer and key events on #gameCanvas. */
export function initPointerAndKeyEvents() {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;

  // Window resize => adjust canvas size
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Pointer events
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancelOrLeave);
  canvas.addEventListener('pointerleave', onPointerCancelOrLeave);

  // Wheel => zoom
  canvas.addEventListener('wheel', (e) => handleWheelZoom(e, canvas), { passive: false });

  // SHIFT key (already separate)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
      state.shiftDown = true;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      state.shiftDown = false;
    }
  });

  // Our new "global" keyboard shortcuts for Escape, Delete, Undo/Redo, etc.
  window.addEventListener('keydown', handleGlobalKeyDown);
}

/** resize canvas to match its client size * devicePixelRatio. */
function resizeCanvas() {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  canvas.width = cssWidth * window.devicePixelRatio;
  canvas.height = cssHeight * window.devicePixelRatio;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

  requestRender();
}

/** pointerdown => check if resizing handle is clicked, else do normal select/creation. */
function onPointerDown(e) {
  const canvas = e.currentTarget;

  // Right or middle => panning
  if (e.button === 1 || e.button === 2) {
    state.isPanning = true;
    return;
  }

  // Left => possibly resizing or normal select
  if (e.button === 0) {
    if (!state.isResizing && getCurrentTool() === 'select' && state.selectedElementIds.length > 0) {
      const handle = hitTestResizeHandles(e, canvas);
      if (handle) {
        startResizing(handle, e, canvas);
        requestRender();
        return;
      }
    }
    // else normal pointerdown => select or shape creation
    onPointerDownSelectOrCreate(e, canvas);
  }
}

/** pointermove => if resizing, call updateResizing; else do normal pointer logic. */
function onPointerMove(e) {
  const canvas = e.currentTarget;

  // If user is panning with right/middle mouse
  if (state.isPanning && (e.buttons & (2 | 4))) {
    doPan(e);
    requestRender();

    // Also update the local cursor position for remote viewers
    sendLocalCursor(e, canvas);
    return;
  }

  // Resizing
  if (state.isResizing && (e.buttons & 1)) {
    updateResizing(e, canvas);
    requestRender();

    // Also update local cursor for remote
    sendLocalCursor(e, canvas);
    return;
  }

  // Otherwise the "common" pointer logic (drag shapes, marquee, shape creation, etc.)
  onPointerMoveCommon(e, canvas);
  requestRender();

  // *** The key fix: broadcast local pointer after the standard logic. ***
  sendLocalCursor(e, canvas);
}

/** pointerup => end panning or resizing or normal pointer-up. */
function onPointerUp(e) {
  if (e.button === 1 || e.button === 2) {
    // end panning
    state.isPanning = false;
    return;
  }
  if (state.isResizing && e.button === 0) {
    endResizing(false);
    requestRender();
    return;
  }
  onPointerUpCommon(e, e.currentTarget);
  requestRender();
}

/** pointercancel/leave => forcibly end dragging/resizing if needed. */
function onPointerCancelOrLeave(e) {
  if (state.isResizing) {
    endResizing(true);
    requestRender();
    return;
  }
  onPointerCancelOrLeaveCommon(e);
  requestRender();
}

/** Pan the camera if user is dragging with right/middle. */
function doPan(e) {
  const dx = e.movementX;
  const dy = e.movementY;
  state.camX -= dx / state.scale;
  state.camY -= dy / state.scale;
}

/** Return which tool is currently selected, defaulting to "select". */
function getCurrentTool() {
  const palette = document.getElementById('tools-palette');
  if (!palette) return 'select';
  const btn = palette.querySelector('.tool-btn.selected');
  return btn?.dataset?.tool || 'select';
}

/* ------------------------------------------------------------------
   Unified Keyboard Handling (Escape, Delete, Undo/Redo, etc.)
------------------------------------------------------------------ */
function handleGlobalKeyDown(e) {
  // We skip SHIFT logic here because we track SHIFT separately above.
  // Also skip if user is typing in an input/textarea.
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    return;
  }

  switch (e.key) {
    case 'Escape':
      // If creating a shape => cancel creation
      if (state.creationState?.active) {
        state.creationState.active = false;
      }
      // If resizing => force end
      else if (state.isResizing) {
        endResizing(true);
      }
      // else deselect all
      else {
        deselectAll();
      }
      break;

    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      // delete selected shapes
      if (state.selectedElementIds.length) {
        sendDeleteElements(state.selectedElementIds);
        state.selectedElementIds = [];
      }
      break;

    default:
      // Ctrl+Z => Undo; Ctrl+Shift+Z => Redo
      // We also watch for Mac Cmd keys (metaKey).
      if ((e.key.toLowerCase() === 'z') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) {
          if (window.__sendWSMessage) {
            window.__sendWSMessage({
              type: MESSAGE_TYPES.REDO,
              userId: state.localUserId
            });
          }
        } else {
          if (window.__sendWSMessage) {
            window.__sendWSMessage({
              type: MESSAGE_TYPES.UNDO,
              userId: state.localUserId
            });
          }
        }
      }
      break;
  }
}

/**
 * Small helper to consistently send the local pointer
 * position as CURSOR_UPDATE to the server.
 */
function sendLocalCursor(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scrX = e.clientX - rect.left;
  const scrY = e.clientY - rect.top;
  const wx = state.camX + scrX / state.scale;
  const wy = state.camY + scrY / state.scale;
  sendCursorUpdate(state.localUserId, wx, wy);
}
