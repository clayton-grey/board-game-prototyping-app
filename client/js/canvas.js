// ./client/js/canvas.js
import { MESSAGE_TYPES } from "/shared/wsMessageTypes.js";

// We track selection locally, so we know which items we have locked.
let selectedElementIds = [];
let localUserId = null;

export const userInfoMap = new Map(); // userId -> { color, name }
export const remoteCursors = new Map(); // Exposed so app.js can remove stale cursors

// Canvas transform/camera
let camX = 0, camY = 0, scale = 1.0;
const minScale = 0.01, maxScale = 16.0;
const wheelZoomSpeed = 0.0015, buttonZoomStep = 0.25;

// Panning
let isPanning = false;
let lastMouseX = 0, lastMouseY = 0;

// Dragging
let isDragging = false;
const lockedOffsets = {};

// Marquee
let isMarqueeSelecting = false;
let marqueeStartCanvasX = 0, marqueeStartCanvasY = 0;
let marqueeEndCanvasX = 0, marqueeEndCanvasY = 0;
let marqueeStartWorldX = 0, marqueeStartWorldY = 0;
let marqueeEndWorldX = 0, marqueeEndWorldY = 0;

// Elements come from server's ELEMENT_STATE
let elements = [];
let currentProjectName = "New Project";

/** Called once on page load from app.js */
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

  // Mouse events
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("mouseleave", onMouseUp);

  // Wheel
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // Zoom UI
  document.getElementById("zoom-in").addEventListener("click", () => zoomAroundCenter(buttonZoomStep));
  document.getElementById("zoom-out").addEventListener("click", () => zoomAroundCenter(-buttonZoomStep));
  document.getElementById("frame-all").addEventListener("click", frameAllElements);

  // ESC => clear selection
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      deselectAll();
    }
  });

  requestAnimationFrame(render);
}

/**
 * Export so app.js can handle user re-login or logout.
 */
export function updateCanvasUserId(newId) {
  localUserId = newId;
}

/**
 * Called when the server sends a new element/cursor update.
 */
export function handleCanvasMessage(data, myUserId) {
  switch (data.type) {
    case MESSAGE_TYPES.ELEMENT_STATE: {
      elements = data.elements || [];
      if (data.projectName) {
        currentProjectName = data.projectName;
      }
      // Keep selection only if still locked by me or unlocked
      // (But typically the server sets lockedBy=someUser.)
      selectedElementIds = selectedElementIds.filter((id) => {
        const el = elements.find((e) => e.id === id);
        if (!el) return false;
        // If locked by another user, we can no longer keep it selected
        if (el.lockedBy && el.lockedBy !== myUserId) {
          return false;
        }
        return true;
      });
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

/**
 * If the server updates a user's color or name, store it for remote cursor color.
 */
export function handleUserColorUpdate(userId, name, color) {
  userInfoMap.set(userId, { color, name });
}

/** If the server updates the project name, store it. */
export function setProjectNameFromServer(newName) {
  currentProjectName = newName;
}

/**
 * Removes any remote cursors for userIds that are no longer in the session.
 */
export function removeCursorsForMissingUsers(currentUserIds) {
  for (const [uId] of remoteCursors) {
    if (!currentUserIds.includes(uId)) {
      remoteCursors.delete(uId);
    }
  }
}

/* ------------------------------------------------------------------
   MOUSE / SELECTION
------------------------------------------------------------------ */
function onMouseDown(e) {
  const canvas = e.currentTarget;
  if (e.button === 1 || e.button === 2) {
    // Right or middle => panning
    isPanning = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    canvas.classList.add("grabbing");
    return;
  }
  if (e.button === 0) {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const wx = camX + screenX / scale;
    const wy = camY + screenY / scale;

    marqueeStartCanvasX = screenX * devicePixelRatio;
    marqueeStartCanvasY = screenY * devicePixelRatio;
    marqueeEndCanvasX = marqueeStartCanvasX;
    marqueeEndCanvasY = marqueeStartCanvasY;
    marqueeStartWorldX = wx;
    marqueeStartWorldY = wy;
    marqueeEndWorldX = wx;
    marqueeEndWorldY = wy;

    // Check if an element was clicked from top to bottom
    const clicked = findTopmostElementAt(wx, wy);
    if (clicked) {
      // If SHIFT => add/remove from selection
      if (e.shiftKey) {
        // If already selected, remove it
        if (selectedElementIds.includes(clicked.id)) {
          sendDeselectElement([clicked.id]);
          selectedElementIds = selectedElementIds.filter(id => id !== clicked.id);
          isDragging = false;
        } else {
          const newSel = [...selectedElementIds, clicked.id];
          updateSelection(newSel);
          isDragging = true;
          for (const id of newSel) {
            const el = elements.find(ele => ele.id === id);
            if (el?.lockedBy === localUserId) {
              lockedOffsets[id] = { dx: wx - el.x, dy: wy - el.y };
            }
          }
        }
      } else {
        // Single select
        sendDeselectElement(selectedElementIds.filter(id => id !== clicked.id));
        selectedElementIds = [];
        updateSelection([clicked.id]);
        isDragging = true;
        const el = elements.find(ele => ele.id === clicked.id);
        if (el && el.lockedBy === localUserId) {
          lockedOffsets[clicked.id] = { dx: wx - el.x, dy: wy - el.y };
        }
      }
      canvas.classList.add("grabbing");
    } else {
      // No item => start marquee
      isMarqueeSelecting = true;
      if (!e.shiftKey) {
        deselectAll();
      }
      isDragging = false;
      canvas.classList.add("grabbing");
    }
  }
}

function onMouseMove(e) {
  const canvas = e.currentTarget;
  if (isPanning) {
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    camX -= dx / scale;
    camY -= dy / scale;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }
  else if (isDragging && selectedElementIds.length > 0) {
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
  else if (isMarqueeSelecting) {
    const rect = canvas.getBoundingClientRect();
    marqueeEndCanvasX = (e.clientX - rect.left) * devicePixelRatio;
    marqueeEndCanvasY = (e.clientY - rect.top) * devicePixelRatio;

    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    marqueeEndWorldX = camX + sx / scale;
    marqueeEndWorldY = camY + sy / scale;
  }

  // Also send cursor updates
  const rect = canvas.getBoundingClientRect();
  const scrX = e.clientX - rect.left;
  const scrY = e.clientY - rect.top;
  const wx = camX + scrX / scale;
  const wy = camY + scrY / scale;
  sendCursorUpdate(localUserId, wx, wy);
}

function onMouseUp(e) {
  const canvas = e.currentTarget;
  if ((e.button === 1 || e.button === 2) && isPanning) {
    isPanning = false;
    canvas.classList.remove("grabbing");
    return;
  }
  if (e.button === 0 && isDragging) {
    isDragging = false;
    canvas.classList.remove("grabbing");
    return;
  }
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
      if (boxesOverlap(rminX, rminY, rmaxX, rmaxY, el.x, el.y, ex2, ey2)) {
        if (!el.lockedBy || el.lockedBy === localUserId) {
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

function boxesOverlap(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  return !(ax2 < bx1 || ax1 > bx2 || ay2 < by1 || ay1 > by2);
}

function findTopmostElementAt(wx, wy) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (wx >= el.x && wx <= el.x + el.w && wy >= el.y && wy <= el.y + el.h) {
      return el;
    }
  }
  return null;
}

/* ------------------------------------------------------------------
   UTILS: Selection, Locking, Sending
------------------------------------------------------------------ */
function updateSelection(newSelectedIds) {
  // For each newly added ID => sendGrabElement
  const added = newSelectedIds.filter(id => !selectedElementIds.includes(id));
  for (const id of added) {
    sendGrabElement(id);
  }
  // For each removed => sendDeselect
  const removed = selectedElementIds.filter(id => !newSelectedIds.includes(id));
  if (removed.length > 0) {
    sendDeselectElement(removed);
  }
  selectedElementIds = newSelectedIds;
}

function deselectAll() {
  if (selectedElementIds.length > 0) {
    sendDeselectElement(selectedElementIds);
    selectedElementIds = [];
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

/**
 * "Release" finalizes the move in the undo stack but does NOT unlock.
 * This is typically triggered when finishing a drag, but continuing selection.
 */
function sendReleaseElement(elementId) {
  window.__sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_RELEASE,
    userId: localUserId,
    elementId,
  });
}

/**
 * "Deselect" => forcibly unlocks these items so others can select them.
 * We'll finalize any pending move and free the lock server-side.
 */
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
    ctx.fillStyle = "#CCC";
    ctx.fillRect(el.x, el.y, el.w, el.h);

    // Outline color if locked or selected
    let outlineColor = null;
    if (selectedElementIds.includes(el.id)) {
      // locked by me => outline = blue
      outlineColor = "blue";
    }
    else if (el.lockedBy) {
      // locked by someone else => their color
      const info = userInfoMap.get(el.lockedBy);
      outlineColor = info?.color || "#FFA500";
    }

    if (outlineColor) {
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(el.x, el.y, el.w, el.h);
    }
  }

  ctx.restore();

  // Marquee
  if (isMarqueeSelecting) {
    drawMarquee(ctx);
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

  // Simple large grid lines
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
