// =========================
// FILE: client/js/canvas/canvasEvents.js
// =========================

import { state } from './canvasState.js';
import { requestRender } from './canvasRender.js';
import { handleWheelZoom } from './canvasCamera.js';
import {
  onPointerDownSelectOrCreate,
  onPointerMoveCommon,
  onPointerUpCommon,
  onPointerCancelOrLeaveCommon
} from './canvasTools.js';
import { sendCursorUpdate } from './canvasUtils.js';

export function initPointerAndKeyEvents() {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancelOrLeave);
  canvas.addEventListener('pointerleave', onPointerCancelOrLeave);

  canvas.addEventListener('wheel', (e) => handleWheelZoom(e, canvas), { passive: false });

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

  window.addEventListener('keydown', handleGlobalKeyDown);
}

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

function onPointerDown(e) {
  const canvas = e.currentTarget;
  if (e.button === 1 || e.button === 2) {
    state.isPanning = true;
    return;
  }
  if (e.button === 0) {
    onPointerDownSelectOrCreate(e, canvas);
  }
}

function onPointerMove(e) {
  const canvas = e.currentTarget;
  if (state.isPanning && (e.buttons & (2 | 4))) {
    doPan(e);
    requestRender();
    sendLocalCursor(e, canvas);
    return;
  }
  if (state.isResizing && (e.buttons & 1)) {
    onPointerMoveCommon(e, canvas);
    requestRender();
    sendLocalCursor(e, canvas);
    return;
  }
  onPointerMoveCommon(e, canvas);
  requestRender();
  sendLocalCursor(e, canvas);
}

function onPointerUp(e) {
  const canvas = e.currentTarget;
  if (e.button === 1 || e.button === 2) {
    state.isPanning = false;
    return;
  }
  if (state.isResizing && e.button === 0) {
    onPointerUpCommon(e, canvas);
    requestRender();
    return;
  }
  onPointerUpCommon(e, canvas);
  requestRender();
}

function onPointerCancelOrLeave(e) {
  if (state.isResizing) {
    onPointerCancelOrLeaveCommon(e);
    requestRender();
    return;
  }
  onPointerCancelOrLeaveCommon(e);
  requestRender();
}

function doPan(e) {
  const dx = e.movementX;
  const dy = e.movementY;
  state.camX -= dx / state.scale;
  state.camY -= dy / state.scale;
}

function handleGlobalKeyDown(e) {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    return;
  }
  switch (e.key) {
    case 'Escape':
      if (state.creationState?.active) {
        state.creationState.active = false;
      } else if (state.isResizing) {
        onPointerCancelOrLeaveCommon(e);
      } else {
        deselectAll();
      }
      break;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      if (state.selectedElementIds.length) {
        import('./canvasTools.js').then(module => {
          module.sendDeleteElements(state.selectedElementIds);
          state.selectedElementIds = [];
        });
      }
      break;
    default:
      // Undo/Redo handled in app.js with Ctrl+Z, etc.
      break;
  }
}

function sendLocalCursor(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scrX = e.clientX - rect.left;
  const scrY = e.clientY - rect.top;
  const wx = state.camX + scrX / state.scale;
  const wy = state.camY + scrY / state.scale;
  sendCursorUpdate(state.localUserId, wx, wy);
}
