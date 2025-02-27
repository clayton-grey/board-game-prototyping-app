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

// SHIFT key
let shiftDown = false;

/* ------------------------------------------------------------------
   RESIZING STATE
------------------------------------------------------------------ */
let isResizing = false;
let activeHandle = null; // 'left','right','top','bottom','top-left','top-right','bottom-left','bottom-right'
let boundingBoxAtDragStart = { x: 0, y: 0, w: 0, h: 0 };
let shapesSnapshot = [];

/**
 * Helper to clamp the scale to [minScale, maxScale].
 */
function clampScale(value) {
  return Math.max(minScale, Math.min(value, maxScale));
}

/** 1) INIT: pointer events, etc. */
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

  // pointer events
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);

  // wheel => zoom
  canvas.addEventListener("wheel", onWheel, { passive: false });

  setupKeyListeners();

  // Zoom UI
  document.getElementById("zoom-in").addEventListener("click", () => zoomAroundCenter(+buttonZoomStep));
  document.getElementById("zoom-out").addEventListener("click", () => zoomAroundCenter(-buttonZoomStep));
  document.getElementById("frame-all").addEventListener("click", frameAllElements);

  // ESC => cancel creation or resizing or deselect
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (creationState && creationState.active) {
        creationState.active = false;
      } else if (isResizing) {
        endResizing();
      } else {
        deselectAll();
      }
    }
  });

  initToolsPalette();

  // Delete key => remove selected shapes
  window.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      // Skip if a text field is focused
      if (
        document.activeElement &&
        document.activeElement.tagName.toLowerCase() !== "canvas"
      ) {
        return;
      }
      if (selectedElementIds.length > 0) {
        window.__sendWSMessage({
          type: MESSAGE_TYPES.ELEMENT_DELETE,
          userId: localUserId,
          elementIds: [...selectedElementIds],
        });
        selectedElementIds = [];
      }
    }
  });

  requestAnimationFrame(render);
}

/** SHIFT key tracking */
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

/** If the user ID changes (login/out), update local. */
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
      // Filter out selected items locked by someone else
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
      buttons.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      currentTool = btn.getAttribute("data-tool") || "select";
    });
  });
}

/* ------------------------------------------------------------------
   POINTER EVENTS
------------------------------------------------------------------ */
let lastMouseX = 0, lastMouseY = 0;

function onPointerDown(e) {
  const canvas = e.currentTarget;
  canvas.setPointerCapture(e.pointerId);

  if (e.button === 1 || e.button === 2) {
    // Right or middle => panning
    isPanning = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    canvas.classList.add("grabbing");
    return;
  }

  if (e.button === 0) {
    // Check if user clicked a resize handle first
    if (currentTool === "select" && selectedElementIds.length > 0) {
      const handle = hitTestResizeHandles(e);
      if (handle) {
        startResizing(handle, e);
        return;
      }
    }

    // Otherwise standard select or shape creation
    if (currentTool === "select") {
      handleSelectPointerDown(e);
    } else {
      startShapeCreation(e, currentTool);
    }
  }
}

function onPointerMove(e) {
  const canvas = e.currentTarget;

  // Panning
  if (isPanning && (e.buttons & (2|4))) {
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    camX -= dx / scale;
    camY -= dy / scale;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }
  // Resizing
  else if (isResizing && (e.buttons & 1)) {
    updateResizing(e);
  }
  // Drag selected shapes
  else if (isDragging && (e.buttons & 1)) {
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
  // Shape creation
  else if (creationState && creationState.active && (e.buttons & 1)) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wx = camX + sx / scale;
    const wy = camY + sy / scale;
    creationState.curWX = wx;
    creationState.curWY = wy;
  }
  // Marquee
  else if (isMarqueeSelecting && (e.buttons & 1)) {
    const rect = canvas.getBoundingClientRect();
    marqueeEndCanvasX = (e.clientX - rect.left) * devicePixelRatio;
    marqueeEndCanvasY = (e.clientY - rect.top) * devicePixelRatio;

    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    marqueeEndWorldX = camX + sx / scale;
    marqueeEndWorldY = camY + sy / scale;
  }

  // Cursor updates
  const rect = canvas.getBoundingClientRect();
  const scrX = e.clientX - rect.left;
  const scrY = e.clientY - rect.top;
  const wx = camX + scrX / scale;
  const wy = camY + scrY / scale;
  sendCursorUpdate(localUserId, wx, wy);

  // Hover cursors for handles
  if (!isResizing && currentTool === "select" && selectedElementIds.length > 0) {
    if (canTransformSelection()) {
      const hoverHandle = hitTestResizeHandles(e);
      if (hoverHandle) {
        // Show cursor for that handle
        e.currentTarget.style.cursor = getCursorForHandle(hoverHandle);
      } else {
        e.currentTarget.style.cursor = isDragging ? "grabbing" : "default";
      }
    } else {
      e.currentTarget.style.cursor = isDragging ? "grabbing" : "default";
    }
  } else if (!isPanning && !isResizing && !isDragging) {
    e.currentTarget.style.cursor = "default";
  }
}

function onPointerUp(e) {
  const canvas = e.currentTarget;

  // End panning
  if (isPanning && (e.button === 1 || e.button === 2)) {
    isPanning = false;
    canvas.classList.remove("grabbing");
    return;
  }

  // End resizing
  if (isResizing && e.button === 0) {
    endResizing();
    return;
  }

  // End dragging
  if (isDragging && e.button === 0) {
    isDragging = false;
    canvas.classList.remove("grabbing");
  }

  // End shape creation
  if (creationState && creationState.active && e.button === 0) {
    finalizeShapeCreation();
    return;
  }

  // End marquee
  if (isMarqueeSelecting && e.button === 0) {
    isMarqueeSelecting = false;
    canvas.classList.remove("grabbing");

    const rminX = Math.min(marqueeStartWorldX, marqueeEndWorldX);
    const rmaxX = Math.max(marqueeStartWorldX, marqueeEndWorldX);
    const rminY = Math.min(marqueeStartWorldY, marqueeEndWorldY);
    const rmaxY = Math.max(marqueeStartWorldY, marqueeEndWorldY);

    const newlySelected = [];
    for (const el of elements) {
      // Skip if locked by another user
      if (el.lockedBy && el.lockedBy !== localUserId) {
        continue;
      }
      const ex2 = el.x + el.w, ey2 = el.y + el.h;
      if (boxesOverlap(rminX, rminY, rmaxX, rmaxY, el.x, el.y, ex2, ey2)) {
        newlySelected.push(el.id);
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
   SELECT / MOVE
------------------------------------------------------------------ */
function handleSelectPointerDown(e) {
  const canvas = e.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  const wx = camX + screenX / scale;
  const wy = camY + screenY / scale;

  const clicked = findTopmostElementAt(wx, wy);
  if (clicked) {
    // If locked by another user, skip selection
    if (clicked.lockedBy && clicked.lockedBy !== localUserId) {
      return;
    }

    // SHIFT => toggle
    if (e.shiftKey) {
      if (selectedElementIds.includes(clicked.id)) {
        sendDeselectElement([clicked.id]);
        selectedElementIds = selectedElementIds.filter(id => id !== clicked.id);
      } else {
        sendGrabElement(clicked.id);
        selectedElementIds.push(clicked.id);
      }
    } else {
      // single select
      if (!selectedElementIds.includes(clicked.id)) {
        sendDeselectElement(selectedElementIds);
        selectedElementIds = [];
        sendGrabElement(clicked.id);
        selectedElementIds.push(clicked.id);
      }
    }

    // If selected, prepare dragging
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
    // no item => marquee
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
  if (!elementIds || elementIds.length === 0) return;
  window.__sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_DESELECT,
    userId: localUserId,
    elementIds,
  });
}

/* ------------------------------------------------------------------
   SHAPE CREATION
------------------------------------------------------------------ */
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

function finalizeShapeCreation() {
  if (!creationState) return;
  const { tool, startWX, startWY, curWX, curWY } = creationState;
  creationState.active = false;

  let x = Math.min(startWX, curWX);
  let y = Math.min(startWY, curWY);
  let w = Math.abs(curWX - startWX);
  let h = Math.abs(curWY - startWY);

  if (shiftDown && (tool === "rectangle" || tool === "ellipse")) {
    const side = Math.max(w, h);
    w = side;
    h = side;
  }
  if (tool === "text") {
    const TEXT_DEFAULT_HEIGHT = 30;
    h = TEXT_DEFAULT_HEIGHT;
  }
  if (w < 2 && h < 2) {
    return;
  }
  // Deselect existing
  if (selectedElementIds.length > 0) {
    deselectAll();
  }

  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);

  window.__sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_CREATE,
    userId: localUserId,
    shape: tool,
    x,
    y,
    w,
    h,
  });
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
   DESELECTION
------------------------------------------------------------------ */
function deselectAll() {
  if (selectedElementIds.length > 0) {
    sendDeselectElement(selectedElementIds);
    selectedElementIds = [];
  }
}

/* ------------------------------------------------------------------
   HELPER: "Can the local user transform the current selection?"
------------------------------------------------------------------ */
function canTransformSelection() {
  for (const id of selectedElementIds) {
    const el = elements.find(e => e.id === id);
    if (!el) continue;
    if (el.lockedBy && el.lockedBy !== localUserId) {
      return false;
    }
  }
  return selectedElementIds.length > 0;
}

/* ------------------------------------------------------------------
   RESIZING LOGIC
------------------------------------------------------------------ */
function getSelectionBoundingBox() {
  if (!selectedElementIds.length) return null;
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const id of selectedElementIds) {
    const el = elements.find(e => e.id === id);
    if (!el) continue;
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  if (minX > maxX || minY > maxY) {
    return null;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function drawSelectionBoundingBox(ctx) {
  if (!canTransformSelection()) {
    return;
  }

  const bb = getSelectionBoundingBox();
  if (!bb) return;

  ctx.save();
  ctx.strokeStyle = "rgba(0,0,255,0.8)";
  ctx.lineWidth = 2 / scale;
  ctx.strokeRect(bb.x, bb.y, bb.w, bb.h);

  // corner circles
  const radius = 6 / scale;
  const cornerStroke = 4 / scale;
  const corners = [
    { cx: bb.x, cy: bb.y, name: "top-left" },
    { cx: bb.x + bb.w, cy: bb.y, name: "top-right" },
    { cx: bb.x, cy: bb.y + bb.h, name: "bottom-left" },
    { cx: bb.x + bb.w, cy: bb.y + bb.h, name: "bottom-right" },
  ];
  ctx.fillStyle = "white";
  ctx.strokeStyle = "rgb(160,160,160)";
  ctx.lineWidth = cornerStroke;
  for (const c of corners) {
    ctx.beginPath();
    ctx.ellipse(c.cx, c.cy, radius, radius, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function hitTestResizeHandles(e) {
  if (!canTransformSelection()) return null;

  const rect = e.currentTarget.getBoundingClientRect();
  const sx = (e.clientX - rect.left) / (1 / devicePixelRatio);
  const sy = (e.clientY - rect.top) / (1 / devicePixelRatio);

  const wx = camX + (sx / devicePixelRatio) / scale;
  const wy = camY + (sy / devicePixelRatio) / scale;

  const bb = getSelectionBoundingBox();
  if (!bb) return null;

  // corners
  const cornerRadius = 8 / scale;
  const corners = [
    { x: bb.x, y: bb.y, name: "top-left" },
    { x: bb.x + bb.w, y: bb.y, name: "top-right" },
    { x: bb.x, y: bb.y + bb.h, name: "bottom-left" },
    { x: bb.x + bb.w, y: bb.y + bb.h, name: "bottom-right" },
  ];
  for (const c of corners) {
    const dx = wx - c.x;
    const dy = wy - c.y;
    if (dx * dx + dy * dy <= cornerRadius * cornerRadius) {
      return c.name;
    }
  }

  // edges => small tolerance
  const edgeTol = 6 / scale;
  // top
  if (
    wy >= bb.y - edgeTol &&
    wy <= bb.y + edgeTol &&
    wx >= bb.x &&
    wx <= bb.x + bb.w
  ) {
    return "top";
  }
  // bottom
  if (
    wy >= bb.y + bb.h - edgeTol &&
    wy <= bb.y + bb.h + edgeTol &&
    wx >= bb.x &&
    wx <= bb.x + bb.w
  ) {
    return "bottom";
  }
  // left
  if (
    wx >= bb.x - edgeTol &&
    wx <= bb.x + edgeTol &&
    wy >= bb.y &&
    wy <= bb.y + bb.h
  ) {
    return "left";
  }
  // right
  if (
    wx >= bb.x + bb.w - edgeTol &&
    wx <= bb.x + bb.w + edgeTol &&
    wy >= bb.y &&
    wy <= bb.y + bb.h
  ) {
    return "right";
  }

  return null;
}

function startResizing(handleName, e) {
  isResizing = true;
  activeHandle = handleName;

  const bb = getSelectionBoundingBox();
  boundingBoxAtDragStart = { ...bb };

  shapesSnapshot = [];
  for (const id of selectedElementIds) {
    const el = elements.find(x => x.id === id);
    if (!el) continue;
    const relX = el.x - bb.x;
    const relY = el.y - bb.y;
    shapesSnapshot.push({
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

function updateResizing(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const wx = camX + sx / scale;
  const wy = camY + sy / scale;

  let bb = { ...boundingBoxAtDragStart };

  if (activeHandle.includes("left")) {
    const newX = Math.min(bb.x + bb.w - 2, wx);
    const deltaLeft = newX - bb.x;
    bb.x = newX;
    bb.w -= deltaLeft;
  }
  if (activeHandle.includes("right")) {
    const newW = Math.max(2, wx - bb.x);
    bb.w = newW;
  }
  if (activeHandle.includes("top")) {
    const newY = Math.min(bb.y + bb.h - 2, wy);
    const deltaTop = newY - bb.y;
    bb.y = newY;
    bb.h -= deltaTop;
  }
  if (activeHandle.includes("bottom")) {
    const newH = Math.max(2, wy - bb.y);
    bb.h = newH;
  }

  // SHIFT => preserve aspect ratio if corner
  if (
    shiftDown &&
    (activeHandle === "top-left" ||
      activeHandle === "top-right" ||
      activeHandle === "bottom-left" ||
      activeHandle === "bottom-right")
  ) {
    const originalRatio = boundingBoxAtDragStart.w / boundingBoxAtDragStart.h;
    const newRatio = bb.w / bb.h;
    if (newRatio > originalRatio) {
      const wFactor = bb.w / boundingBoxAtDragStart.w;
      bb.h = boundingBoxAtDragStart.h * wFactor;

      if (activeHandle.includes("top")) {
        bb.y = boundingBoxAtDragStart.y + boundingBoxAtDragStart.h - bb.h;
      }
      if (activeHandle.includes("left")) {
        bb.x = boundingBoxAtDragStart.x + boundingBoxAtDragStart.w - bb.w;
      }
    } else {
      const hFactor = bb.h / boundingBoxAtDragStart.h;
      bb.w = boundingBoxAtDragStart.w * hFactor;

      if (activeHandle.includes("top")) {
        bb.y = boundingBoxAtDragStart.y + boundingBoxAtDragStart.h - bb.h;
      }
      if (activeHandle.includes("left")) {
        bb.x = boundingBoxAtDragStart.x + boundingBoxAtDragStart.w - bb.w;
      }
    }
  }

  const scaleX = bb.w / boundingBoxAtDragStart.w;
  const scaleY = bb.h / boundingBoxAtDragStart.h;

  for (const snap of shapesSnapshot) {
    const el = elements.find((x) => x.id === snap.id);
    if (!el) continue;

    let newX = el.x,
      newY = el.y,
      newW = el.w,
      newH = el.h;

    // horizontal
    if (
      activeHandle.includes("left") ||
      activeHandle.includes("right") ||
      activeHandle.includes("top-") ||
      activeHandle.includes("bottom-")
    ) {
      newX = bb.x + snap.relX * scaleX;
      newW = snap.w * scaleX;
    }
    // vertical
    if (
      activeHandle.includes("top") ||
      activeHandle.includes("bottom") ||
      activeHandle.includes("left-") ||
      activeHandle.includes("right-")
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

function endResizing() {
  isResizing = false;
  activeHandle = null;
  shapesSnapshot = [];
}

function sendResizeElement(elementId, x, y, w, h) {
  window.__sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_RESIZE,
    userId: localUserId,
    elementId,
    x,
    y,
    w,
    h,
  });
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
      ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(el.x, el.y, el.w, el.h);
    }

    if (el.shape === "text") {
      ctx.fillStyle = "#333";
      ctx.font = "14px sans-serif";
      ctx.fillText("Text", el.x + 5, el.y + el.h / 2 + 5);
    }

    // If locked by someone else, outline
    if (el.lockedBy && el.lockedBy !== localUserId) {
      const info = userInfoMap.get(el.lockedBy);
      const outlineColor = info?.color || "#FFA500";
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = outlineColor;

      if (el.shape === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(el.x, el.y, el.w, el.h);
      }
    }
    ctx.restore();
  }

  // bounding box for selection
  if (selectedElementIds.length > 0 && currentTool === "select") {
    drawSelectionBoundingBox(ctx);
  }

  ctx.restore();

  // Marquee
  if (isMarqueeSelecting) {
    drawMarquee(ctx);
  }

  // Ephemeral shape
  if (creationState && creationState.active) {
    drawEphemeralShape(ctx);
  }

  // Remote cursors
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

function drawEphemeralShape(ctx) {
  const { tool, startWX, startWY, curWX, curWY } = creationState;
  let x = Math.min(startWX, curWX);
  let y = Math.min(startWY, curWY);
  let w = Math.abs(curWX - startWX);
  let h = Math.abs(curWY - startWY);

  if (shiftDown && (tool === "rectangle" || tool === "ellipse")) {
    const side = Math.max(w, h);
    w = side;
    h = side;
  }
  if (tool === "text") {
    const TEXT_DEFAULT_HEIGHT = 30;
    h = TEXT_DEFAULT_HEIGHT;
  }

  ctx.save();
  ctx.translate(-camX * scale, -camY * scale);
  ctx.scale(scale, scale);

  ctx.beginPath();
  if (tool === "ellipse") {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.rect(x, y, w, h);
  }
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

/** Return topmost element under (wx, wy). */
function findTopmostElementAt(wx, wy) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
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
      if (
        wx >= el.x &&
        wx <= el.x + el.w &&
        wy >= el.y &&
        wy <= el.y + el.h
      ) {
        return el;
      }
    }
  }
  return null;
}

function boxesOverlap(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  return !(ax2 < bx1 || ax1 > bx2 || ay2 < by1 || ay1 > by2);
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
  const cw = canvas.clientWidth,
    ch = canvas.clientHeight;
  zoomAroundPoint(scale + step, cw / 2, ch / 2);
}

function zoomAroundPoint(newScale, anchorX, anchorY) {
  const oldScale = scale;
  scale = clampScale(newScale);
  if (scale === oldScale) return;

  const wx = camX + anchorX / oldScale;
  const wy = camY + anchorY / oldScale;
  camX = wx - anchorX / scale;
  camY = wy - anchorY / scale;
  updateZoomUI();
}

function frameAllElements() {
  if (!elements.length) return;
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    maxX = Math.max(maxX, el.x + el.w);
    minY = Math.min(minY, el.y);
    maxY = Math.max(maxY, el.y + el.h);
  }
  const w = maxX - minX,
    h = maxY - minY;
  if (w <= 0 || h <= 0) return;

  const canvas = document.getElementById("gameCanvas");
  const cw = canvas.clientWidth,
    ch = canvas.clientHeight;
  const margin = 50;
  const scaleX = (cw - margin * 2) / w;
  const scaleY = (ch - margin * 2) / h;
  const newScale = clampScale(Math.min(scaleX, scaleY));
  scale = newScale;

  const cx = minX + w / 2;
  const cy = minY + h / 2;
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

function sendCursorUpdate(uId, wx, wy) {
  window.__sendWSMessage({
    type: MESSAGE_TYPES.CURSOR_UPDATE,
    userId: uId,
    x: wx,
    y: wy,
  });
}
