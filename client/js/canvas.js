// ./client/js/canvas.js
import { MESSAGE_TYPES } from "/shared/wsMessageTypes.js";

let selectedElementIds = [];
let localUserId = null;

export const userInfoMap = new Map(); // userId -> { color, name }
export const remoteCursors = new Map();

// Camera transform
let camX = 0, camY = 0, scale = 1.0;
const minScale = 0.01, maxScale = 16.0;
const wheelZoomSpeed = 0.0015, buttonZoomStep = 0.25;

// Flags
let isPanning = false;
let isDragging = false;
const lockedOffsets = {};

// Marquee
let isMarqueeSelecting = false;
let marqueeStartCanvasX = 0, marqueeStartCanvasY = 0;
let marqueeEndCanvasX = 0, marqueeEndCanvasY = 0;
let marqueeStartWorldX = 0, marqueeStartWorldY = 0;
let marqueeEndWorldX = 0, marqueeEndWorldY = 0;

// Elements from server
let elements = [];
let currentProjectName = "New Project";

// Tools
let currentTool = "select"; // default
let creationState = null; // { active, tool, startWX, startWY, curWX, curWY }

// We track whether Shift is currently held down
let shiftDown = false;

/** Constants used for text shape. */
const TEXT_DEFAULT_HEIGHT = 30;

/** 1) INIT: pointer events & remove mouseleave. */
export function initCanvas(initialUserId) {
  localUserId = initialUserId;

  const canvas = document.getElementById("gameCanvas");
  const ctx2d = canvas.getContext("2d");

  function resize() {
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    canvas.width = cssWidth * window.devicePixelRatio;
    canvas.height = cssHeight * window.devicePixelRatio;
    ctx2d.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // Use pointer events
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);

  // Mouse wheel => zoom
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // Initialize keyboard listeners to track shiftDown
  setupKeyListeners();

  // Zoom UI
  document.getElementById("zoom-in").addEventListener("click", () => zoomAroundCenter(buttonZoomStep));
  document.getElementById("zoom-out").addEventListener("click", () => zoomAroundCenter(-buttonZoomStep));
  document.getElementById("frame-all").addEventListener("click", frameAllElements);

  // ESC => clear selection or cancel creation
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (creationState && creationState.active) {
        // Cancel shape creation
        creationState.active = false;
      } else {
        deselectAll();
      }
    }
  });

  // Initialize the tools palette event listeners
  initToolsPalette();

  window.addEventListener("keydown", (e) => {
  // Already handling SHIFT, ESC, etc.
  // Let's add handling for Delete
  if (e.key === "Delete" || e.key === "Backspace") {
    // If you want to allow backspace as well, but be mindful not to conflict with text fields
    if (selectedElementIds.length > 0) {
      // Send a new message type
      window.__sendWSMessage({
        type: MESSAGE_TYPES.ELEMENT_DELETE,
        userId: localUserId,
        elementIds: [...selectedElementIds],
      });

      // Optionally clear local selection
      selectedElementIds = [];
    }
  }
});

  requestAnimationFrame(render);
}

/** Track Shift Key up/down globally so ephemeral shape constraints update in real time. */
function setupKeyListeners() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Shift") {
      shiftDown = true;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "Shift") {
      shiftDown = false;
    }
  });
}

/** If the user ID changes (login/out), update. */
export function updateCanvasUserId(newId) {
  localUserId = newId;
}

/** Handle server-sent element or cursor updates. */
export function handleCanvasMessage(data, myUserId) {
  switch (data.type) {
    case MESSAGE_TYPES.ELEMENT_STATE: {
      const oldElementIds = elements.map(e => e.id);
      elements = data.elements || [];
      if (data.projectName) {
        currentProjectName = data.projectName;
      }

      // Filter out any selected items that the server locked to someone else
      selectedElementIds = selectedElementIds.filter((id) => {
        const el = elements.find((e) => e.id === id);
        if (!el) return false;
        if (el.lockedBy && el.lockedBy !== myUserId) {
          return false;
        }
        return true;
      });

      // If there's a new element locked to me that wasn't in oldElementIds, auto-select it
      for (const el of elements) {
        if (el.lockedBy === myUserId && !oldElementIds.includes(el.id)) {
          // It's newly created => select it
          selectedElementIds = [el.id];
        }
      }
      break;
    }

    case MESSAGE_TYPES.CURSOR_UPDATE:
      if (data.userId !== myUserId) {
        remoteCursors.set(data.userId, { x: data.x, y: data.y });
      }
      break;

    case MESSAGE_TYPES.CURSOR_UPDATES:
      for (const [uId, pos] of Object.entries(data.cursors)) {
        remoteCursors.set(uId, pos);
      }
      // remove old
      for (const oldId of remoteCursors.keys()) {
        if (!data.cursors[oldId]) {
          remoteCursors.delete(oldId);
        }
      }
      break;
    default:
      break;
  }
}

/** Update local color map if the server changes a user's color. */
export function handleUserColorUpdate(userId, name, color) {
  userInfoMap.set(userId, { color, name });
}

/** If server updates project name, store it. */
export function setProjectNameFromServer(newName) {
  currentProjectName = newName;
}

/** Remove stale cursors for users no longer in session. */
export function removeCursorsForMissingUsers(currentUserIds) {
  for (const [uId] of remoteCursors) {
    if (!currentUserIds.includes(uId)) {
      remoteCursors.delete(uId);
    }
  }
}

/* ------------------------------------------------------------------
   TOOL PALETTE
------------------------------------------------------------------ */
function initToolsPalette() {
  const palette = document.getElementById("tools-palette");
  if (!palette) return;
  const buttons = palette.querySelectorAll(".tool-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      // Remove "selected" from all, then add to this one
      buttons.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");

      currentTool = btn.getAttribute("data-tool") || "select";
    });
  });
}

/* ------------------------------------------------------------------
   POINTER HANDLERS
------------------------------------------------------------------ */
let lastMouseX = 0, lastMouseY = 0;

/** onPointerDown => capture pointer, handle selection or panning. */
function onPointerDown(e) {
  const canvas = e.currentTarget;
  canvas.setPointerCapture(e.pointerId); // keep receiving pointer events

  // Middle or right => panning
  if (e.button === 1 || e.button === 2) {
    isPanning = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    canvas.classList.add("grabbing");
    return;
  }

  // Left button
  if (e.button === 0) {
    if (currentTool === "select") {
      handleSelectPointerDown(e);
    } else {
      startShapeCreation(e, currentTool);
    }
  }
}

function handleSelectPointerDown(e) {
  const canvas = e.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  const wx = camX + screenX / scale;
  const wy = camY + screenY / scale;

  // Find if user clicked an element
  const clicked = findTopmostElementAt(wx, wy);
  if (clicked) {
    // SHIFT => toggle
    if (e.shiftKey) {
      if (selectedElementIds.includes(clicked.id)) {
        // remove it
        sendDeselectElement([clicked.id]);
        selectedElementIds = selectedElementIds.filter(id => id !== clicked.id);
      } else {
        sendGrabElement(clicked.id);
        selectedElementIds.push(clicked.id);
      }
    } else {
      // single select
      if (!selectedElementIds.includes(clicked.id)) {
        sendDeselectElement(selectedElementIds.filter(id => id !== clicked.id));
        selectedElementIds = [];
        sendGrabElement(clicked.id);
        selectedElementIds.push(clicked.id);
      }
    }

    // if the final selection STILL includes the clicked item,
    // we prepare for dragging
    if (selectedElementIds.includes(clicked.id)) {
      for (const id of selectedElementIds) {
        const el = elements.find(ele => ele.id === id);
        if (el?.lockedBy === localUserId) {
          lockedOffsets[id] = {
            dx: wx - el.x,
            dy: wy - el.y,
          };
        }
      }
      isDragging = true;
      canvas.classList.add("grabbing");
    }
  } else {
    // If no item => start a marquee
    isMarqueeSelecting = true;
    marqueeStartCanvasX = screenX * devicePixelRatio;
    marqueeStartCanvasY = screenY * devicePixelRatio;
    marqueeEndCanvasX = marqueeStartCanvasX;
    marqueeEndCanvasY = marqueeStartCanvasY;
    marqueeStartWorldX = wx;
    marqueeStartWorldY = wy;
    marqueeEndWorldX = wx;
    marqueeEndWorldY = wy;

    if (!e.shiftKey) {
      deselectAll();
    }
    isDragging = false;
    canvas.classList.add("grabbing");
  }
}

/**
 * startShapeCreation => store creationState so we can drag to size.
 */
function startShapeCreation(e, tool) {
  const canvas = e.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  const wx = camX + screenX / scale;
  const wy = camY + screenY / scale;

  creationState = {
    active: true,
    tool,
    startWX: wx,
    startWY: wy,
    curWX: wx,
    curWY: wy,
  };
}

/** onPointerMove => pan or drag selected items, or size shape. */
function onPointerMove(e) {
  const canvas = e.currentTarget;

  if (isPanning && (e.buttons & (2|4))) {
    // Right or middle button => pan
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    camX -= dx / scale;
    camY -= dy / scale;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }
  else if (isDragging && (e.buttons & 1)) {
    // Move locked items
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wx = camX + sx / scale;
    const wy = camY + sy / scale;

    for (const id of selectedElementIds) {
      const el = elements.find(ele => ele.id === id);
      if (el && el.lockedBy === localUserId) {
        const off = lockedOffsets[id];
        if (off) {
          const nx = wx - off.dx;
          const ny = wy - off.dy;
          sendMoveElement(id, nx, ny);
        }
      }
    }
  }
  else if (creationState && creationState.active && (e.buttons & 1)) {
    // Update ephemeral shape
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wx = camX + sx / scale;
    const wy = camY + sy / scale;
    creationState.curWX = wx;
    creationState.curWY = wy;
  }
  else if (isMarqueeSelecting && (e.buttons & 1)) {
    // If we're marquee-selecting
    const rect = canvas.getBoundingClientRect();
    marqueeEndCanvasX = (e.clientX - rect.left) * devicePixelRatio;
    marqueeEndCanvasY = (e.clientY - rect.top) * devicePixelRatio;

    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    marqueeEndWorldX = camX + sx / scale;
    marqueeEndWorldY = camY + sy / scale;
  }

  // Always send cursor updates
  const rect = canvas.getBoundingClientRect();
  const scrX = e.clientX - rect.left;
  const scrY = e.clientY - rect.top;
  const wx = camX + scrX / scale;
  const wy = camY + scrY / scale;
  sendCursorUpdate(localUserId, wx, wy);
}

/** onPointerUp => end panning, dragging, shape creation, or marquee. */
function onPointerUp(e) {
  const canvas = e.currentTarget;
  
  // End panning
  if (isPanning && (e.button === 1 || e.button === 2)) {
    isPanning = false;
    canvas.classList.remove("grabbing");
    return;
  }

  // End dragging if left
  if (e.button === 0 && isDragging) {
    isDragging = false;
    canvas.classList.remove("grabbing");
  }

  // End shape creation if needed
  if (creationState && creationState.active && e.button === 0) {
    finalizeShapeCreation();
    return;
  }

  // End marquee if left
  if (isMarqueeSelecting && e.button === 0) {
    isMarqueeSelecting = false;
    canvas.classList.remove("grabbing");

    const rminX = Math.min(marqueeStartWorldX, marqueeEndWorldX);
    const rmaxX = Math.max(marqueeStartWorldX, marqueeEndWorldX);
    const rminY = Math.min(marqueeStartWorldY, marqueeEndWorldY);
    const rmaxY = Math.max(marqueeStartWorldY, marqueeEndWorldY);

    const newlySelected = [];
    for (const el of elements) {
      const ex2 = el.x + el.w, ey2 = el.y + el.h;
      if (!el.lockedBy || el.lockedBy === localUserId) {
        if (boxesOverlap(rminX, rminY, rmaxX, rmaxY, el.x, el.y, ex2, ey2)) {
          newlySelected.push(el.id);
        }
      }
    }
    if (!e.shiftKey) {
      deselectAll();
    }
    for (const id of newlySelected) {
      if (!selectedElementIds.includes(id)) {
        selectedElementIds.push(id);
        sendGrabElement(id);
      }
    }
  }
}

/* ------------------------------------------------------------------
   CREATION LOGIC
------------------------------------------------------------------ */

/**
 * finalizeShapeCreation => once user releases mouse
 * we compute final x,y,w,h for the shape and create it on the server.
 */
function finalizeShapeCreation() {
  if (!creationState) return;
  const { tool, startWX, startWY, curWX, curWY } = creationState;
  creationState.active = false;

  let x = Math.min(startWX, curWX);
  let y = Math.min(startWY, curWY);
  let w = Math.abs(curWX - startWX);
  let h = Math.abs(curWY - startWY);

  // SHIFT => keep aspect ratio (for rect/ellipse)
  if (shiftDown && (tool === "rectangle" || tool === "ellipse")) {
    const side = Math.max(w, h);
    w = side;
    h = side;
  }

  if (tool === "text") {
    // For text, we fix the height, only vary width
    h = TEXT_DEFAULT_HEIGHT;
  }

  // If w or h is super small, skip creation
  if (w < 2 && h < 2) {
    // do nothing
    return;
  }

  // Deselect anything else
  if (selectedElementIds.length > 0) {
    deselectAll();
  }

  // Round coords to integer
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);

  // Send create message
  window.__sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_CREATE,
    userId: localUserId,
    shape: tool,
    x,
    y,
    w,
    h
  });

  // revert to select tool
  revertToSelectTool();
}

function revertToSelectTool() {
  currentTool = "select";
  const palette = document.getElementById("tools-palette");
  if (!palette) return;
  const buttons = palette.querySelectorAll(".tool-btn");
  buttons.forEach((b) => {
    const t = b.getAttribute("data-tool");
    if (t === "select") {
      b.classList.add("selected");
    } else {
      b.classList.remove("selected");
    }
  });
}

/* ------------------------------------------------------------------
   SELECTION / LOCKING
------------------------------------------------------------------ */
function deselectAll() {
  if (selectedElementIds.length > 0) {
    sendDeselectElement(selectedElementIds);
    selectedElementIds = [];
  }
}

/* ------------------------------------------------------------------
   SEND MESSAGES
------------------------------------------------------------------ */
function sendGrabElement(elementId) {
  window.__sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_GRAB,
    userId: localUserId,
    elementId,
  });
}
function sendMoveElement(elementId, x, y) {
  window.__sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_MOVE,
    userId: localUserId,
    elementId,
    x,
    y,
  });
}
function sendDeselectElement(elementIds) {
  window.__sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_DESELECT,
    userId: localUserId,
    elementIds,
  });
}
function sendCursorUpdate(uId, wx, wy) {
  window.__sendWSMessage({
    type: MESSAGE_TYPES.CURSOR_UPDATE,
    userId: uId,
    x: wx,
    y: wy,
  });
}

/* ------------------------------------------------------------------
   ZOOM & FRAME
------------------------------------------------------------------ */
function onWheel(e) {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * wheelZoomSpeed);
  const canvas = e.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  zoomAroundPoint(scale * factor, sx, sy);
}

function zoomAroundCenter(step) {
  const canvas = document.getElementById("gameCanvas");
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  zoomAroundPoint(scale + step, cw / 2, ch / 2);
}

function zoomAroundPoint(newScale, anchorX, anchorY) {
  const oldScale = scale;
  scale = Math.max(minScale, Math.min(maxScale, newScale));
  if (scale === oldScale) return;

  const wx = camX + anchorX / oldScale;
  const wy = camY + anchorY / oldScale;
  camX = wx - anchorX / scale;
  camY = wy - anchorY / scale;
  updateZoomUI();
}

function frameAllElements() {
  if (!elements.length) return;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    maxX = Math.max(maxX, el.x + el.w);
    minY = Math.min(minY, el.y);
    maxY = Math.max(maxY, el.y + el.h);
  }
  const w = maxX - minX, h = maxY - minY;
  if (w <= 0 || h <= 0) return;

  const canvas = document.getElementById("gameCanvas");
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const margin = 50;
  const scaleX = (cw - margin * 2) / w;
  const scaleY = (ch - margin * 2) / h;
  const newScale = Math.max(minScale, Math.min(maxScale, Math.min(scaleX, scaleY)));
  scale = newScale;

  const cx = minX + w / 2, cy = minY + h / 2;
  camX = cx - cw / (2 * scale);
  camY = cy - ch / (2 * scale);

  updateZoomUI();
}

function updateZoomUI() {
  const el = document.getElementById("zoom-level");
  if (el) {
    el.textContent = `${Math.round(scale * 100)}%`;
  }
}

/* ------------------------------------------------------------------
   RENDER
------------------------------------------------------------------ */
function render() {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  // Clear
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  fillBackground(ctx);
  drawGrid(ctx);

  // Draw elements
  ctx.save();
  ctx.translate(-camX * scale, -camY * scale);
  ctx.scale(scale, scale);

  for (const el of elements) {
    ctx.save();
    ctx.fillStyle = "#CCC";

    if (el.shape === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(el.x + el.w/2, el.y + el.h/2, el.w/2, el.h/2, 0, 0, Math.PI*2);
      ctx.fill();
    } else {
      // rectangle or text
      ctx.fillRect(el.x, el.y, el.w, el.h);
    }

    // If it's text, draw a placeholder label
    if (el.shape === "text") {
      ctx.fillStyle = "#333";
      ctx.font = "14px sans-serif";
      ctx.fillText("Text", el.x + 5, el.y + el.h/2 + 5);
    }

    // Outline color if locked or selected
    let outlineColor = null;
    if (selectedElementIds.includes(el.id)) {
      outlineColor = "blue";
    } else if (el.lockedBy) {
      const info = userInfoMap.get(el.lockedBy);
      outlineColor = info?.color || "#FFA500";
    }
    if (outlineColor) {
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = 2;
      if (el.shape === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(el.x + el.w/2, el.y + el.h/2, el.w/2, el.h/2, 0, 0, Math.PI*2);
        ctx.stroke();
      } else {
        ctx.strokeRect(el.x, el.y, el.w, el.h);
      }
    }
    ctx.restore();
  }

  ctx.restore();

  // Draw marquee if active
  if (isMarqueeSelecting) {
    drawMarquee(ctx);
  }

  // Draw ephemeral shape if creationState.active
  if (creationState && creationState.active) {
    drawEphemeralShape(ctx);
  }

  // Draw remote cursors
  drawRemoteCursors(ctx);

  requestAnimationFrame(render);
}

function fillBackground(ctx) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#F0F0F0";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

function drawGrid(ctx) {
  ctx.save();
  ctx.translate(-camX * scale, -camY * scale);
  ctx.scale(scale, scale);

  const cw = ctx.canvas.clientWidth / scale;
  const ch = ctx.canvas.clientHeight / scale;
  const step = 100;
  const startX = Math.floor(camX / step) * step;
  const endX = Math.ceil((camX + cw) / step) * step;
  const startY = Math.floor(camY / step) * step;
  const endY = Math.ceil((camY + ch) / step) * step;

  ctx.strokeStyle = "rgb(220,220,220)";
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += step) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y <= endY; y += step) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawMarquee(ctx) {
  const rx = Math.min(marqueeStartCanvasX, marqueeEndCanvasX);
  const ry = Math.min(marqueeStartCanvasY, marqueeEndCanvasY);
  const rw = Math.abs(marqueeEndCanvasX - marqueeStartCanvasX);
  const rh = Math.abs(marqueeEndCanvasY - marqueeStartCanvasY);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.fillStyle = "rgba(0,0,255,0.2)";
  ctx.fill();
  ctx.strokeStyle = "blue";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Draw the ephemeral shape while user is dragging to size. */
function drawEphemeralShape(ctx) {
  const { tool, startWX, startWY, curWX, curWY } = creationState;
  let x = Math.min(startWX, curWX);
  let y = Math.min(startWY, curWY);
  let w = Math.abs(curWX - startWX);
  let h = Math.abs(curWY - startWY);

  // SHIFT => keep ratio for rectangle/ellipse
  if (shiftDown && (tool === "rectangle" || tool === "ellipse")) {
    const side = Math.max(w, h);
    w = side;
    h = side;
  }

  if (tool === "text") {
    // fixed height, only vary width
    h = TEXT_DEFAULT_HEIGHT;
  }

  ctx.save();
  ctx.translate(-camX * scale, -camY * scale);
  ctx.scale(scale, scale);

  ctx.beginPath();
  if (tool === "ellipse") {
    ctx.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI*2);
  } else {
    // rect or text
    ctx.rect(x, y, w, h);
  }

  // fill with semi-transparent color
  ctx.fillStyle = "rgba(255,0,0,0.2)";
  ctx.fill();

  ctx.strokeStyle = "red";
  ctx.lineWidth = 2 / scale;
  ctx.stroke();

  ctx.restore();
}

function drawRemoteCursors(ctx) {
  ctx.save();
  for (const [uId, pos] of remoteCursors) {
    if (uId === localUserId) continue;
    const sx = (pos.x - camX) * scale;
    const sy = (pos.y - camY) * scale;
    const info = userInfoMap.get(uId);
    const outlineColor = info?.color || "#FFA500";
    drawArrowCursor(ctx, sx, sy, outlineColor, uId);
  }
  ctx.restore();
}

function drawArrowCursor(ctx, sx, sy, outlineColor, label) {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 14);
  ctx.lineTo(4, 10);
  ctx.lineTo(6, 14);
  ctx.lineTo(8, 12);
  ctx.lineTo(5, 7);
  ctx.lineTo(9, 3);
  ctx.lineTo(0, 0);
  ctx.closePath();

  ctx.fillStyle = "white";
  ctx.fill();
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = "6px sans-serif";
  ctx.fillStyle = "#000";
  ctx.fillText(label, 10, 5);

  ctx.restore();
}

/** Return the topmost element under world coords (wx, wy) or null. */
function findTopmostElementAt(wx, wy) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.shape === "ellipse") {
      // ellipse hit test
      const rx = el.w / 2, ry = el.h / 2;
      const cx = el.x + rx, cy = el.y + ry;
      const dx = wx - cx, dy = wy - cy;
      const inside = (dx*dx)/(rx*rx) + (dy*dy)/(ry*ry) <= 1;
      if (inside) return el;
    } else {
      // rectangle or text
      if (wx >= el.x && wx <= el.x + el.w && wy >= el.y && wy <= el.y + el.h) {
        return el;
      }
    }
  }
  return null;
}

/** Simple overlap check for marquee. */
function boxesOverlap(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  return !(ax2 < bx1 || ax1 > bx2 || ay2 < by1 || ay1 > by2);
}
