// =========================
// FILE: client/js/canvas/canvasEvents.js
// =========================

import { state } from "./canvasState.js";
import { requestRender } from "./canvasRender.js";
import { handleWheelZoom } from "./canvasCamera.js";
import {
  onPointerDownSelectOrCreate,
  onPointerMoveCommon,
  onPointerUpCommon,
  onPointerCancelOrLeaveCommon,
  hitTestResizeHandles,
  startResizing,
  updateResizing,
  endResizing,
} from "./canvasTools.js";
import { sendCursorUpdate } from "./canvasUtils.js";

export function initPointerAndKeyEvents() {
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancelOrLeave);
  canvas.addEventListener("pointerleave", onPointerCancelOrLeave);

  canvas.addEventListener("wheel", (e) => handleWheelZoom(e, canvas), {
    passive: false,
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Shift") {
      state.shiftDown = true;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "Shift") {
      state.shiftDown = false;
    }
  });

  // For Escape / Delete / Backspace
  window.addEventListener("keydown", handleGlobalKeyDown);
}

function resizeCanvas() {
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  canvas.width = cssWidth * window.devicePixelRatio;
  canvas.height = cssHeight * window.devicePixelRatio;
  ctx.setTransform(
    window.devicePixelRatio,
    0,
    0,
    window.devicePixelRatio,
    0,
    0,
  );
  requestRender();
}

function onPointerDown(e) {
  const canvas = e.currentTarget;
  if (e.button === 1 || e.button === 2) {
    // Middle or right => panning
    state.isPanning = true;
    return;
  }
  if (e.button === 0) {
    // Left click => either resizing or normal selection
    // Check if user is about to resize
    if (!state.isResizing) {
      const tool = getCurrentTool();
      console.log(tool);
      if (tool === "select" && canTransformSelection()) {
        const handle = hitTestResizeHandles(e, canvas);
        console.log(handle);
        if (handle) {
          // Start resizing
          startResizing(handle, e, canvas);
          return;
        }
      }
    }
    onPointerDownSelectOrCreate(e, canvas);
  }
}

function onPointerMove(e) {
  const canvas = e.currentTarget;

  if (state.isPanning && e.buttons & (2 | 4)) {
    doPan(e);
    requestRender();
    sendLocalCursor(e, canvas);
    return;
  }

  if (state.isResizing && e.buttons & 1) {
    // Update resizing
    updateResizing(e, canvas);
    requestRender();
    sendLocalCursor(e, canvas);
    return;
  }

  // Otherwise, normal pointer-move logic (drag select, marquee, shape creation, hover)
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
    endResizing(false); // finalize
    requestRender();
    return;
  }
  onPointerUpCommon(e, canvas);
  requestRender();
}

function onPointerCancelOrLeave(e) {
  if (state.isResizing) {
    endResizing(true); // force-cancel
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
  // Skip if focused on input/textarea
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea") {
    return;
  }

  switch (e.key) {
    case "Escape":
      if (state.creationState?.active) {
        state.creationState.active = false;
      } else if (state.isResizing) {
        endResizing(true);
      } else {
        import("./canvasTools.js").then((module) => {
          module.deselectAll();
        });
      }
      break;
    case "Delete":
    case "Backspace":
      // Avoid going back in history
      e.preventDefault();
      if (state.selectedElementIds.length) {
        import("./canvasTools.js").then((module) => {
          module.sendDeleteElements(state.selectedElementIds);
          state.selectedElementIds = [];
        });
      }
      break;
    default:
      // Let other global combos pass
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

function getCurrentTool() {
  const palette = document.getElementById("tools-palette");
  if (!palette) return "select";
  const btn = palette.querySelector(".tool-btn.selected");
  return btn?.dataset?.tool || "select";
}

function canTransformSelection() {
  if (!state.selectedElementIds.length) return false;
  for (const id of state.selectedElementIds) {
    const el = state.elements.find((e) => e.id === id);
    if (!el) continue;
    if (el.lockedBy && el.lockedBy !== state.localUserId) {
      return false;
    }
  }
  return true;
}
