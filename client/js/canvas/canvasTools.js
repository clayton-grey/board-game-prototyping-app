// =========================
// FILE: client/js/canvas/canvasTools.js
// =========================

import { state } from "./canvasState.js";
import { requestRender } from "./canvasRender.js";
import { MESSAGE_TYPES } from "../../../shared/wsMessageTypes.js";
import { boxesOverlap } from "./canvasUtils.js";
import { sendWSMessage } from "../../js/wsClient.js";

/**
 * UTILITY: Called by canvasRender to get bounding box data
 * for the selected shapes. Returns { minX, minY, maxX, maxY } or null.
 */
export function getSelectionBoundingBox() {
  if (!state.selectedElementIds.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const id of state.selectedElementIds) {
    const el = state.elements.find((e) => e.id === id);
    if (!el) continue;
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  if (minX > maxX || minY > maxY) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * drawRotationHandleScreenSpace(ctx, {minX, minY, maxX, maxY})
 *   - Called by canvasRender after the bounding box is drawn
 *   - We compute bottom-right corner in world coords => convert to SCREEN coords
 *   - Then offset by +20,+20 pixels and draw a circle in device pixels
 */
export function drawRotationHandleScreenSpace(ctx, bounds) {
  const { minX, minY, maxX, maxY } = bounds;
  const brWorldX = maxX;
  const brWorldY = maxY;

  // -- The core fix: multiply by window.devicePixelRatio so that
  //    everything lines up consistently on HiDPI screens
  const dpr = window.devicePixelRatio || 1;

  const brScreenX = (brWorldX - state.camX) * state.scale * dpr;
  const brScreenY = (brWorldY - state.camY) * state.scale * dpr;

  const handleScreenX = brScreenX + 20; // +20 px offset in device coords
  const handleScreenY = brScreenY + 20;

  ctx.save();
  // reset transform => we’re drawing in absolute screen coords
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  ctx.beginPath();
  ctx.arc(handleScreenX, handleScreenY, 10, 0, Math.PI * 2);
  ctx.fillStyle = "white";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "blue";
  ctx.stroke();

  // optional small arc or arrow shape
  ctx.beginPath();
  ctx.arc(handleScreenX, handleScreenY, 8, 0, 2.2, false);
  ctx.stroke();

  ctx.restore();
}

/**
 * Check if the pointer event is on the rotation handle in screen space.
 * Returns true if yes, false otherwise.
 */
function hitTestRotationHandle(e, canvas) {
  const bounds = getSelectionBoundingBox();
  if (!bounds) return false;

  const { maxX, maxY } = bounds;
  const dpr = window.devicePixelRatio || 1;

  // Convert bounding-box corner to device coords
  const brScreenX = (maxX - state.camX) * state.scale * dpr;
  const brScreenY = (maxY - state.camY) * state.scale * dpr;

  const handleX = brScreenX + 20;
  const handleY = brScreenY + 20;
  const radius = 10;

  const rect = canvas.getBoundingClientRect();
  // Convert pointer from clientX/clientY to device coords
  const px = (e.clientX - rect.left) * dpr;
  const py = (e.clientY - rect.top) * dpr;

  const dx = px - handleX;
  const dy = py - handleY;
  return dx * dx + dy * dy <= radius * radius;
}

/* ------------------------------------------------------------------
   CREATE / UPDATE / DELETE
------------------------------------------------------------------ */

export function createOrUpdateElementsFromServer(serverElements) {
  state.elements = serverElements || [];
}

export function removeObsoleteSelections(myUserId) {
  state.selectedElementIds = state.selectedElementIds.filter((id) => {
    const el = state.elements.find((e) => e.id === id);
    if (!el) return false;
    if (el.lockedBy && el.lockedBy !== myUserId) return false;
    return true;
  });
  for (const k of Object.keys(state.lockedOffsets)) {
    if (!state.selectedElementIds.includes(+k)) {
      delete state.lockedOffsets[k];
    }
  }
}

export function handleCursorData(data, myUserId) {
  if (data.type === MESSAGE_TYPES.CURSOR_UPDATE) {
    if (data.userId !== myUserId) {
      state.remoteCursors.set(data.userId, { x: data.x, y: data.y });
    }
  } else if (data.type === MESSAGE_TYPES.CURSOR_UPDATES) {
    for (const [uId, pos] of Object.entries(data.cursors)) {
      state.remoteCursors.set(uId, pos);
    }
    for (const oldId of state.remoteCursors.keys()) {
      if (!data.cursors[oldId]) {
        state.remoteCursors.delete(oldId);
      }
    }
  }
}

export function removeStaleRemoteCursors(currentUserIds) {
  for (const [uId] of state.remoteCursors) {
    if (!currentUserIds.includes(uId)) {
      state.remoteCursors.delete(uId);
    }
  }
}

export function setLocalUserId(newId) {
  state.localUserId = newId;
}

/* ------------------------------------------------------------------
   Pointer logic for select/drag/resize/marquee/creation/ROTATION
------------------------------------------------------------------ */

export function onPointerDownSelectOrCreate(e, canvas) {
  const tool = getCurrentTool();
  // 1) Check rotation handle first
  if (tool === "select" && hitTestRotationHandle(e, canvas)) {
    startRotating(e, canvas);
    canvas.classList.add("grabbing");
    return;
  }

  // 2) Otherwise do the usual shape selection / marquee / creation
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const wx = state.camX + sx / state.scale;
  const wy = state.camY + sy / state.scale;

  if (tool === "select") {
    const clicked = findTopmostElementAt(wx, wy);
    if (clicked) {
      if (clicked.lockedBy && clicked.lockedBy !== state.localUserId) return;
      if (e.shiftKey) {
        if (state.selectedElementIds.includes(clicked.id)) {
          sendDeselectElement([clicked.id]);
          state.selectedElementIds = state.selectedElementIds.filter(
            (id) => id !== clicked.id,
          );
          delete state.lockedOffsets[clicked.id];
        } else {
          sendGrabElement(clicked.id);
          state.selectedElementIds.push(clicked.id);
        }
        return;
      }
      if (!state.selectedElementIds.includes(clicked.id)) {
        sendDeselectElement(state.selectedElementIds);
        state.selectedElementIds = [];
        sendGrabElement(clicked.id);
        state.selectedElementIds.push(clicked.id);
      }
      for (const id of state.selectedElementIds) {
        const el = state.elements.find((ele) => ele.id === id);
        if (el?.lockedBy === state.localUserId) {
          state.lockedOffsets[id] = {
            dx: wx - el.x,
            dy: wy - el.y,
          };
        }
      }
      state.isDragging = true;
      canvas.classList.add("grabbing");
    } else {
      // marquee
      state.isMarqueeSelecting = true;
      state.isDragging = false;
      canvas.classList.add("grabbing");

      // For the marquee, store in both world and device coords
      state.marqueeStart.xCanvas = sx * window.devicePixelRatio;
      state.marqueeStart.yCanvas = sy * window.devicePixelRatio;
      state.marqueeEnd.xCanvas = state.marqueeStart.xCanvas;
      state.marqueeEnd.yCanvas = state.marqueeStart.yCanvas;

      state.marqueeStart.xWorld = wx;
      state.marqueeStart.yWorld = wy;
      state.marqueeEnd.xWorld = wx;
      state.marqueeEnd.yWorld = wy;

      if (!e.shiftKey) {
        deselectAll();
      }
    }
  } else {
    // shape creation
    startShapeCreation(tool, wx, wy);
  }
}

export function onPointerMoveCommon(e, canvas) {
  if (state.isRotating) {
    updateRotating(e, canvas);
    requestRender();
    return;
  }
  if (state.isDragging && e.buttons & 1) {
    doDragSelected(e, canvas);
    return;
  }
  if (state.isMarqueeSelecting && e.buttons & 1) {
    updateMarquee(e, canvas);
    return;
  }
  if (state.creationState?.active && e.buttons & 1) {
    updateShapeCreation(e, canvas);
    return;
  }
  updateHoverCursor(e, canvas);
}

export function onPointerUpCommon(e, canvas) {
  if (state.isRotating && e.button === 0) {
    endRotating(false);
    canvas.classList.remove("grabbing");
    return;
  }
  if (state.isDragging && e.button === 0) {
    state.isDragging = false;
    canvas.classList.remove("grabbing");
    for (const k of Object.keys(state.lockedOffsets)) {
      delete state.lockedOffsets[k];
    }
  }
  if (state.creationState?.active && e.button === 0) {
    finalizeShapeCreation();
  }
  if (state.isMarqueeSelecting && e.button === 0) {
    finalizeMarquee(e, canvas);
  }
}

export function onPointerCancelOrLeaveCommon(e) {
  if (state.isRotating) {
    endRotating(true);
  }
  if (state.isDragging) {
    state.isDragging = false;
    for (const k of Object.keys(state.lockedOffsets)) {
      delete state.lockedOffsets[k];
    }
  }
}

/* ------------------------------------------------------------------
   ROTATION LOGIC
------------------------------------------------------------------ */

export function startRotating(e, canvas) {
  state.isRotating = true;
  state.rotationSnapshot = [];

  const bounds = getSelectionBoundingBox();
  if (!bounds) return;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  state.rotationCenter = { x: cx, y: cy };

  // store old angles
  for (const id of state.selectedElementIds) {
    const el = state.elements.find((x) => x.id === id);
    if (!el) continue;
    if (el.lockedBy === state.localUserId) {
      state.rotationSnapshot.push({ id, angle: el.angle || 0 });
    }
  }

  const { pointerAngle } = pointerAngleFromCenter(e, canvas, cx, cy);
  state.rotationPointerStart = pointerAngle;
}

export function updateRotating(e, canvas) {
  if (!state.isRotating) return;
  const { x: cx, y: cy } = state.rotationCenter;
  const { pointerAngle } = pointerAngleFromCenter(e, canvas, cx, cy);

  let delta = pointerAngle - state.rotationPointerStart;
  // SHIFT => snap to 15 degree increments
  if (state.shiftDown) {
    const degrees = (delta * 180) / Math.PI;
    const snapped = Math.round(degrees / 15) * 15;
    delta = (snapped * Math.PI) / 180;
  }

  for (const snap of state.rotationSnapshot) {
    const el = state.elements.find((x) => x.id === snap.id);
    if (!el) continue;
    const newAngleDeg = snap.angle + (delta * 180) / Math.PI;
    sendElementRotate(el.id, newAngleDeg);
  }
}

export function endRotating(forceCancel) {
  state.isRotating = false;
  if (!forceCancel && state.selectedElementIds.length) {
    sendWSMessage({
      type: MESSAGE_TYPES.ELEMENT_ROTATE_END,
      userId: state.localUserId,
      elementIds: state.selectedElementIds,
    });
  }
  // cleanup
  state.rotationSnapshot = [];
  state.rotationCenter = null;
  state.rotationPointerStart = 0;
}

function pointerAngleFromCenter(e, canvas, cx, cy) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const wx = state.camX + sx / state.scale;
  const wy = state.camY + sy / state.scale;

  const dx = wx - cx;
  const dy = wy - cy;
  const pointerAngle = Math.atan2(dy, dx);
  return { pointerAngle };
}

function sendElementRotate(elementId, angleDeg) {
  sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_ROTATE,
    userId: state.localUserId,
    elementId,
    angle: angleDeg,
  });
}

/* ------------------------------------------------------------------
   RESIZING
------------------------------------------------------------------ */
export function hitTestResizeHandles(e, canvas) {
  if (!canTransformSelection()) return null;
  const rawBB = getSelectionBoundingBox();
  if (!rawBB) return null;

  const { minX, minY, maxX, maxY } = rawBB;
  const x = minX;
  const y = minY;
  const w = maxX - minX;
  const h = maxY - minY;

  const dpr = window.devicePixelRatio || 1;

  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left; // screen coords in CSS pixels
  const sy = e.clientY - rect.top;
  const wx = state.camX + sx / state.scale;
  const wy = state.camY + sy / state.scale;

  const cornerRadius = 8 / state.scale;
  const corners = [
    { x: x, y: y, name: "top-left" },
    { x: x + w, y: y, name: "top-right" },
    { x: x, y: y + h, name: "bottom-left" },
    { x: x + w, y: y + h, name: "bottom-right" },
  ];
  for (const c of corners) {
    const dx = wx - c.x;
    const dy = wy - c.y;
    if (dx * dx + dy * dy <= cornerRadius * cornerRadius) {
      return c.name;
    }
  }

  const edgeTol = 6 / state.scale;
  if (wy >= y - edgeTol && wy <= y + edgeTol && wx >= x && wx <= x + w) {
    return "top";
  }
  if (
    wy >= y + h - edgeTol &&
    wy <= y + h + edgeTol &&
    wx >= x &&
    wx <= x + w
  ) {
    return "bottom";
  }
  if (wx >= x - edgeTol && wx <= x + edgeTol && wy >= y && wy <= y + h) {
    return "left";
  }
  if (
    wx >= x + w - edgeTol &&
    wx <= x + w + edgeTol &&
    wy >= y &&
    wy <= y + h
  ) {
    return "right";
  }

  return null;
}

export function startResizing(handleName, e, canvas) {
  state.isResizing = true;
  state.activeHandle = handleName;
  const rawBB = getSelectionBoundingBox();
  if (!rawBB) return;
  const { minX, minY, maxX, maxY } = rawBB;
  const w = maxX - minX;
  const h = maxY - minY;
  state.boundingBoxAtDragStart = { x: minX, y: minY, w, h };
  state.shapesSnapshot = [];

  for (const id of state.selectedElementIds) {
    const el = state.elements.find((x) => x.id === id);
    if (!el) continue;
    const relX = el.x - minX;
    const relY = el.y - minY;
    state.shapesSnapshot.push({
      id: el.id,
      x: el.x,
      y: el.y,
      w: el.w,
      h: el.h,
      relX,
      relY,
    });
  }
}

export function updateResizing(e, canvas) {
  if (!state.isResizing) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const wx = state.camX + sx / state.scale;
  const wy = state.camY + sy / state.scale;

  let bb = { ...state.boundingBoxAtDragStart };

  if (state.activeHandle.includes("left")) {
    const newX = Math.min(bb.x + bb.w - 2, wx);
    const deltaLeft = newX - bb.x;
    bb.x = newX;
    bb.w -= deltaLeft;
  }
  if (state.activeHandle.includes("right")) {
    const newW = Math.max(2, wx - bb.x);
    bb.w = newW;
  }
  if (state.activeHandle.includes("top")) {
    const newY = Math.min(bb.y + bb.h - 2, wy);
    const deltaTop = newY - bb.y;
    bb.y = newY;
    bb.h -= deltaTop;
  }
  if (state.activeHandle.includes("bottom")) {
    bb.h = Math.max(2, wy - bb.y);
  }

  // SHIFT => preserve aspect ratio if corner
  if (
    state.shiftDown &&
    (state.activeHandle === "top-left" ||
      state.activeHandle === "top-right" ||
      state.activeHandle === "bottom-left" ||
      state.activeHandle === "bottom-right")
  ) {
    const originalRatio =
      state.boundingBoxAtDragStart.w / state.boundingBoxAtDragStart.h;
    const newRatio = bb.w / bb.h;
    if (newRatio > originalRatio) {
      const wFactor = bb.w / state.boundingBoxAtDragStart.w;
      bb.h = state.boundingBoxAtDragStart.h * wFactor;
      if (state.activeHandle.includes("top")) {
        bb.y =
          state.boundingBoxAtDragStart.y +
          state.boundingBoxAtDragStart.h -
          bb.h;
      }
      if (state.activeHandle.includes("left")) {
        bb.x =
          state.boundingBoxAtDragStart.x +
          state.boundingBoxAtDragStart.w -
          bb.w;
      }
    } else {
      const hFactor = bb.h / state.boundingBoxAtDragStart.h;
      bb.w = state.boundingBoxAtDragStart.w * hFactor;
      if (state.activeHandle.includes("top")) {
        bb.y =
          state.boundingBoxAtDragStart.y +
          state.boundingBoxAtDragStart.h -
          bb.h;
      }
      if (state.activeHandle.includes("left")) {
        bb.x =
          state.boundingBoxAtDragStart.x +
          state.boundingBoxAtDragStart.w -
          bb.w;
      }
    }
  }

  const scaleX = bb.w / state.boundingBoxAtDragStart.w;
  const scaleY = bb.h / state.boundingBoxAtDragStart.h;

  for (const snap of state.shapesSnapshot) {
    const el = state.elements.find((x) => x.id === snap.id);
    if (!el) continue;
    if (el.lockedBy !== state.localUserId) continue;

    let newX = el.x;
    let newY = el.y;
    let newW = el.w;
    let newH = el.h;

    if (
      state.activeHandle.includes("left") ||
      state.activeHandle.includes("right") ||
      state.activeHandle.includes("top-") ||
      state.activeHandle.includes("bottom-")
    ) {
      newX = bb.x + snap.relX * scaleX;
      newW = snap.w * scaleX;
    }
    if (
      state.activeHandle.includes("top") ||
      state.activeHandle.includes("bottom") ||
      state.activeHandle.includes("left-") ||
      state.activeHandle.includes("right-")
    ) {
      newY = bb.y + snap.relY * scaleY;
      newH = snap.h * scaleY;
    }

    newX = Math.round(newX);
    newY = Math.round(newY);
    newW = Math.max(1, Math.round(newW));
    newH = Math.max(1, Math.round(newH));

    sendResizeElement(el.id, newX, newY, newW, newH);
  }
}

export function endResizing(forceCancel) {
  state.isResizing = false;
  state.activeHandle = null;
  state.shapesSnapshot = [];

  if (!forceCancel && state.selectedElementIds.length) {
    sendElementResizeEnd(state.selectedElementIds);
  }
}

/* ------------------------------------------------------------------
   DRAGGING SELECTED
------------------------------------------------------------------ */

export function doDragSelected(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const wx = state.camX + sx / state.scale;
  const wy = state.camY + sy / state.scale;

  for (const id of state.selectedElementIds) {
    const el = state.elements.find((ele) => ele.id === id);
    if (el?.lockedBy === state.localUserId) {
      const off = state.lockedOffsets[id];
      if (off) {
        const nx = wx - off.dx;
        const ny = wy - off.dy;
        sendMoveElement(id, nx, ny);
      }
    }
  }
}

/* ------------------------------------------------------------------
   MARQUEE
------------------------------------------------------------------ */

function updateMarquee(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  state.marqueeEnd.xCanvas = (e.clientX - rect.left) * window.devicePixelRatio;
  state.marqueeEnd.yCanvas = (e.clientY - rect.top) * window.devicePixelRatio;

  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  state.marqueeEnd.xWorld = state.camX + sx / state.scale;
  state.marqueeEnd.yWorld = state.camY + sy / state.scale;
}

function finalizeMarquee(e, canvas) {
  state.isMarqueeSelecting = false;
  canvas.classList.remove("grabbing");

  const rminX = Math.min(state.marqueeStart.xWorld, state.marqueeEnd.xWorld);
  const rmaxX = Math.max(state.marqueeStart.xWorld, state.marqueeEnd.xWorld);
  const rminY = Math.min(state.marqueeStart.yWorld, state.marqueeEnd.yWorld);
  const rmaxY = Math.max(state.marqueeStart.yWorld, state.marqueeEnd.yWorld);

  const newlySelected = [];
  for (const el of state.elements) {
    if (el.lockedBy && el.lockedBy !== state.localUserId) continue;
    const ex2 = el.x + el.w;
    const ey2 = el.y + el.h;
    if (!boxesOverlap(rminX, rminY, rmaxX, rmaxY, el.x, el.y, ex2, ey2)) {
      continue;
    }
    newlySelected.push(el.id);
  }
  if (!e.shiftKey) {
    deselectAll();
  }
  for (const id of newlySelected) {
    if (!state.selectedElementIds.includes(id)) {
      state.selectedElementIds.push(id);
      sendGrabElement(id);
    }
  }
}

/* ------------------------------------------------------------------
   SHAPE CREATION
------------------------------------------------------------------ */

function startShapeCreation(tool, wx, wy) {
  state.creationState = {
    active: true,
    tool,
    startWX: wx,
    startWY: wy,
    curWX: wx,
    curWY: wy,
  };
}

function updateShapeCreation(e, canvas) {
  if (!state.creationState?.active) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const wx = state.camX + sx / state.scale;
  const wy = state.camY + sy / state.scale;

  state.creationState.curWX = wx;
  state.creationState.curWY = wy;
}

function finalizeShapeCreation() {
  if (!state.creationState) return;
  const { tool, startWX, startWY, curWX, curWY } = state.creationState;
  state.creationState.active = false;

  let x = Math.min(startWX, curWX);
  let y = Math.min(startWY, curWY);
  let w = Math.abs(curWX - startWX);
  let h = Math.abs(curWY - startWY);

  if (state.shiftDown && (tool === "rectangle" || tool === "ellipse")) {
    const side = Math.max(w, h);
    w = side;
    h = side;
  }
  if (tool === "text") {
    // default text height
    h = 30;
  }
  if (w < 2 && h < 2) return;

  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);

  deselectAll();
  sendElementCreate(tool, x, y, w, h);
  revertToSelectTool();
}

/* ------------------------------------------------------------------
   HOVER CURSOR
------------------------------------------------------------------ */

function updateHoverCursor(e, canvas) {
  if (
    !state.isPanning &&
    !state.isResizing &&
    !state.isDragging &&
    !state.isRotating
  ) {
    const tool = getCurrentTool();
    if (tool === "select" && canTransformSelection()) {
      const handle = hitTestResizeHandles(e, canvas);
      if (handle) {
        canvas.style.cursor = getCursorForHandle(handle);
        return;
      }
    }
    canvas.style.cursor = "default";
    canvas.style.cursor = "default";
  }
}

/* ------------------------------------------------------------------
   HELPERS
------------------------------------------------------------------ */

function findTopmostElementAt(wx, wy) {
  for (let i = state.elements.length - 1; i >= 0; i--) {
    const el = state.elements[i];
    if (el.shape === "ellipse") {
      const rx = el.w / 2;
      const ry = el.h / 2;
      const cx = el.x + rx;
      const cy = el.y + ry;
      const dx = wx - cx;
      const dy = wy - cy;
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
        return el;
      }
    } else {
      if (wx >= el.x && wx <= el.x + el.w && wy >= el.y && wy <= el.y + el.h) {
        return el;
      }
    }
  }
  return null;
}
function getCursorForHandle(handle) {
  switch (handle) {
    case "top-left":
    case "bottom-right":
      return "nwse-resize";
    case "top-right":
    case "bottom-left":
      return "nesw-resize";
    case "top":
    case "bottom":
      return "ns-resize";
    case "left":
    case "right":
      return "ew-resize";
    default:
      return "default";
  }
}

export function deselectAll() {
  if (state.selectedElementIds.length) {
    sendDeselectElement(state.selectedElementIds);
    state.selectedElementIds = [];
  }
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
    if (el.lockedBy && el.lockedBy !== state.localUserId) return false;
  }
  return true;
}

/* ------------------------------------------------------------------
   SEND MESSAGES
------------------------------------------------------------------ */

function sendGrabElement(elementId) {
  sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_GRAB,
    userId: state.localUserId,
    elementId,
  });
}

function sendMoveElement(elementId, x, y) {
  sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_MOVE,
    userId: state.localUserId,
    elementId,
    x,
    y,
  });
}

function sendDeselectElement(elementIds) {
  if (!elementIds?.length) return;
  sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_DESELECT,
    userId: state.localUserId,
    elementIds,
  });
  for (const eid of elementIds) {
    delete state.lockedOffsets[eid];
  }
}

function sendElementCreate(shape, x, y, w, h) {
  sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_CREATE,
    userId: state.localUserId,
    shape,
    x,
    y,
    w,
    h,
  });
}

function sendResizeElement(elementId, x, y, w, h) {
  sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_RESIZE,
    userId: state.localUserId,
    elementId,
    x,
    y,
    w,
    h,
  });
}

function sendElementResizeEnd(ids) {
  sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_RESIZE_END,
    userId: state.localUserId,
    elementIds: ids,
  });
}

function revertToSelectTool() {
  const palette = document.getElementById("tools-palette");
  if (!palette) return;
  const buttons = palette.querySelectorAll(".tool-btn");
  buttons.forEach((b) => {
    b.classList.remove("selected");
    if (b.dataset.tool === "select") {
      b.classList.add("selected");
    }
  });
}
