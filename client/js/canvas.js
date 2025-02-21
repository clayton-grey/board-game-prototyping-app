// ./client/js/canvas.js

import { MESSAGE_TYPES } from "/shared/wsMessageTypes.js";

// Track user info (color, name) for drawing locked elements and cursors
export const userInfoMap = new Map(); // userId -> { color, name }

// Keep track of all remote cursor positions: userId -> { x, y }
const remoteCursors = new Map();

let localUserId = null;    // We'll store the local user ID
let elements = [];
let currentProjectName = "";

// Camera / Zoom
let camX = 0;
let camY = 0;
let scale = 1.0;
const minScale = 0.01;
const maxScale = 16.0;
const wheelZoomSpeed = 0.0015;
const buttonZoomStep = 0.25;

// Panning
let isPanning = false;
let lastMouseX = 0;
let lastMouseY = 0;

// Selection & dragging
let selectedElementIds = [];
let lockedOffsets = {};
let isDragging = false;

// Marquee selection
let isMarqueeSelecting = false;
let marqueeStartCanvasX = 0;
let marqueeStartCanvasY = 0;
let marqueeEndCanvasX = 0;
let marqueeEndCanvasY = 0;
let marqueeStartWorldX = 0;
let marqueeStartWorldY = 0;
let marqueeEndWorldX = 0;
let marqueeEndWorldY = 0;

// For a modular background grid
const BASE_SPACING = 100;

/**
 * Check if a click at world coordinates (wx, wy) intersects any element.
 */
function findElementAt(wx, wy) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (
      wx >= el.x &&
      wx <= el.x + el.w &&
      wy >= el.y &&
      wy <= el.y + el.h
    ) {
      return el;
    }
  }
  return null;
}

/**
 * Called once on page load, sets up the canvas event listeners.
 * `userId` is used for locking, grabbing, etc.
 */
export function initCanvas(userId) {
  localUserId = userId;

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

  // Wheel zoom
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // Zoom UI
  document.getElementById("zoom-in").addEventListener("click", () => {
    zoomAroundCenter(buttonZoomStep);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    zoomAroundCenter(-buttonZoomStep);
  });
  document.getElementById("frame-all").addEventListener("click", frameAllElements);

  // ESC => clear selection
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      updateSelection([]);
    }
  });

  requestAnimationFrame(render);
}

/**
 * Handler for all “canvas” WebSocket messages from the unified WebSocket.
 * This includes CURSOR_UPDATES, ELEMENT_STATE, etc.
 */
export function handleCanvasMessage(data, myUserId) {
  switch (data.type) {
    case MESSAGE_TYPES.ELEMENT_STATE: {
      elements = data.elements || [];
      if (data.projectName) {
        currentProjectName = data.projectName;
      }
      // Keep selections only if they are still locked by me or unlocked
      selectedElementIds = selectedElementIds.filter((id) => {
        const el = elements.find((e) => e.id === id);
        if (!el) return false;
        return !el.lockedBy || el.lockedBy === myUserId;
      });
      // If we are dragging but lost a lock => stop
      if (isDragging) {
        for (const id of selectedElementIds) {
          const el = elements.find((e) => e.id === id);
          if (!el || el.lockedBy !== myUserId) {
            isDragging = false;
            break;
          }
        }
      }
      break;
    }

    case MESSAGE_TYPES.CURSOR_UPDATES: {
      // Bulk update of all cursors
      for (const [uId, pos] of Object.entries(data.cursors)) {
        remoteCursors.set(uId, pos);
      }
      // remove old ones that no longer exist
      for (const oldId of remoteCursors.keys()) {
        if (!data.cursors[oldId]) {
          remoteCursors.delete(oldId);
        }
      }
      break;
    }

    case "cursor-update": {
      // Single user update (the older approach)
      if (data.userId !== myUserId) {
        remoteCursors.set(data.userId, { x: data.x, y: data.y });
      }
      break;
    }

    case MESSAGE_TYPES.PROJECT_NAME_CHANGE: {
      // If you want to store the name from server
      currentProjectName = data.newName;
      break;
    }

    default:
      // No-op
      break;
  }
}

/**
 * Called if the server updates a user's color or name, so we store it for highlighting.
 */
export function handleUserColorUpdate(userId, name, color) {
  userInfoMap.set(userId, { color, name });
}

/**
 * If we want to store the project name from the server
 */
export function setProjectNameFromServer(newName) {
  currentProjectName = newName;
}

/* ------------------------------------------------------------------
   MOUSE + MARQUEE + DRAG
------------------------------------------------------------------ */
function onMouseDown(e) {
  const canvas = e.currentTarget;
  if (e.button === 1 || e.button === 2) {
    // Middle or right => panning
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

    // check if an element was clicked
    const clicked = findElementAt(wx, wy);
    if (clicked) {
      // if locked by someone else => skip
      if (clicked.lockedBy && clicked.lockedBy !== localUserId) {
        return;
      }
      const alreadySelected = selectedElementIds.includes(clicked.id);
      if (alreadySelected) {
        // Start dragging
        isDragging = true;
        for (const id of selectedElementIds) {
          const el = elements.find((ele) => ele.id === id);
          if (el && el.lockedBy === localUserId) {
            lockedOffsets[id] = {
              dx: wx - el.x,
              dy: wy - el.y,
            };
          }
        }
      } else {
        // shift or single select
        if (!e.shiftKey) {
          updateSelection([]);
        }
        const newSet = [...selectedElementIds];
        if (!newSet.includes(clicked.id)) {
          newSet.push(clicked.id);
        } else if (e.shiftKey) {
          const idx = newSet.indexOf(clicked.id);
          newSet.splice(idx, 1);
        }
        updateSelection(newSet);
        isDragging = false;
      }
      canvas.classList.add("grabbing");
    } else {
      // start marquee
      isMarqueeSelecting = true;
      marqueeEndCanvasX = marqueeStartCanvasX;
      marqueeEndCanvasY = marqueeStartCanvasY;

      marqueeStartWorldX = wx;
      marqueeStartWorldY = wy;
      marqueeEndWorldX = wx;
      marqueeEndWorldY = wy;

      if (!e.shiftKey) {
        updateSelection([]);
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

  if (isDragging) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wx = camX + sx / scale;
    const wy = camY + sy / scale;

    for (const id of selectedElementIds) {
      const el = elements.find((ele) => ele.id === id);
      if (el && el.lockedBy === localUserId) {
        const off = lockedOffsets[id];
        if (off) {
          sendMoveElement(id, wx - off.dx, wy - off.dy);
        }
      }
    }
  }

  if (isMarqueeSelecting) {
    const rect = canvas.getBoundingClientRect();
    marqueeEndCanvasX = (e.clientX - rect.left) * devicePixelRatio;
    marqueeEndCanvasY = (e.clientY - rect.top) * devicePixelRatio;

    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    marqueeEndWorldX = camX + sx / scale;
    marqueeEndWorldY = camY + sy / scale;
  }

  // Actually send the cursor's *world* position so other clients see it
  const rect = canvas.getBoundingClientRect();
  const scrX = e.clientX - rect.left;
  const scrY = e.clientY - rect.top;
  const wx = camX + scrX / scale;
  const wy = camY + scrY / scale;

  // The function below is what sends the "cursor-update" message:
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

    // evaluate marquee
    const rminX = Math.min(marqueeStartWorldX, marqueeEndWorldX);
    const rmaxX = Math.max(marqueeStartWorldX, marqueeEndWorldX);
    const rminY = Math.min(marqueeStartWorldY, marqueeEndWorldY);
    const rmaxY = Math.max(marqueeStartWorldY, marqueeEndWorldY);

    const newlySelected = [];
    for (const el of elements) {
      const elMinX = el.x;
      const elMaxX = el.x + el.w;
      const elMinY = el.y;
      const elMaxY = el.y + el.h;
      const noOverlap =
        elMaxX < rminX ||
        elMinX > rmaxX ||
        elMaxY < rminY ||
        elMinY > rmaxY;
      if (!noOverlap) {
        if (!el.lockedBy || el.lockedBy === localUserId) {
          newlySelected.push(el.id);
        }
      }
    }
    const finalSel = [...selectedElementIds];
    for (const id of newlySelected) {
      if (!finalSel.includes(id)) {
        finalSel.push(id);
      }
    }
    updateSelection(finalSel);
  }
}

/* ------------------------------------------------------------------
   SELECTION & LOCKS
------------------------------------------------------------------ */
function updateSelection(newSelectedIds) {
  // release removed
  const removed = selectedElementIds.filter((id) => !newSelectedIds.includes(id));
  removed.forEach((rid) => sendReleaseElement(rid));

  // grab added
  const added = newSelectedIds.filter((id) => !selectedElementIds.includes(id));
  added.forEach((aid) => sendGrabElement(aid));

  selectedElementIds = newSelectedIds;
  if (isDragging && !selectedElementIds.length) {
    isDragging = false;
  }
}

function sendGrabElement(elementId) {
  window.__sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_GRAB,
    userId: localUserId,
    elementId,
  });
}

function sendReleaseElement(elementId) {
  window.__sendWSMessage({
    type: MESSAGE_TYPES.ELEMENT_RELEASE,
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

function sendCursorUpdate(userId, wx, wy) {
  window.__sendWSMessage({
    type: MESSAGE_TYPES.CURSOR_UPDATE,
    userId,
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
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
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

function updateZoomUI() {
  const el = document.getElementById("zoom-level");
  if (el) {
    el.textContent = `${Math.round(scale * 100)}%`;
  }
}

function frameAllElements() {
  if (!elements.length) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    maxX = Math.max(maxX, el.x + el.w);
    minY = Math.min(minY, el.y);
    maxY = Math.max(maxY, el.y + el.h);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return;

  const canvas = document.getElementById("gameCanvas");
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const margin = 50;
  const scaleX = (cw - margin * 2) / w;
  const scaleY = (ch - margin * 2) / h;
  const newScale = Math.max(minScale, Math.min(maxScale, Math.min(scaleX, scaleY)));
  scale = newScale;

  const cx = minX + w / 2;
  const cy = minY + h / 2;
  camX = cx - cw / (2 * scale);
  camY = cy - ch / (2 * scale);

  updateZoomUI();
}

/* ------------------------------------------------------------------
   RENDER LOOP
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
  drawModularGrid(ctx);

  // Draw elements
  ctx.save();
  ctx.translate(-camX * scale, -camY * scale);
  ctx.scale(scale, scale);

  for (const el of elements) {
    ctx.fillStyle = "#CCC";
    ctx.fillRect(el.x, el.y, el.w, el.h);

    let outlineColor = null;
    if (selectedElementIds.includes(el.id)) {
      // If locked by me => BLUE
      if (el.lockedBy === localUserId) {
        outlineColor = "blue";
      }
      // else if locked by someone else => use their color
      else if (el.lockedBy) {
        outlineColor = userInfoMap.get(el.lockedBy)?.color || "#FFA500";
      } else {
        // not locked but selected (rare)
        outlineColor = "blue";
      }
    } else if (el.lockedBy) {
      // not selected but locked by someone else => show color
      outlineColor = userInfoMap.get(el.lockedBy)?.color || "#FFA500";
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

function drawModularGrid(ctx) {
  ctx.save();
  ctx.translate(-camX * scale, -camY * scale);
  ctx.scale(scale, scale);

  const { majorSpacing, fraction } = getEffectiveMajorSpacing(scale);

  const cw = ctx.canvas.clientWidth / scale;
  const ch = ctx.canvas.clientHeight / scale;
  const startX = Math.floor(camX / majorSpacing) * majorSpacing;
  const endX = Math.ceil((camX + cw) / majorSpacing) * majorSpacing;
  const startY = Math.floor(camY / majorSpacing) * majorSpacing;
  const endY = Math.ceil((camY + ch) / majorSpacing) * majorSpacing;

  ctx.strokeStyle = "rgb(220,220,220)";
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();

  for (let x = startX; x <= endX; x += majorSpacing) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y <= endY; y += majorSpacing) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }
  ctx.stroke();

  // sub-grid if fraction > 0
  if (fraction > 0) {
    ctx.strokeStyle = `rgba(230,230,230,${fraction})`;
    const subSpacing = majorSpacing / 4;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += majorSpacing) {
      for (let i = 1; i < 4; i++) {
        const xx = x + i * subSpacing;
        ctx.moveTo(xx, startY);
        ctx.lineTo(xx, endY);
      }
    }
    for (let y = startY; y <= endY; y += majorSpacing) {
      for (let i = 1; i < 4; i++) {
        const yy = y + i * subSpacing;
        ctx.moveTo(startX, yy);
        ctx.lineTo(endX, yy);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

function getEffectiveMajorSpacing(s) {
  const L4 = Math.log2(s) / 2;
  const iPart = Math.floor(L4);
  let frac = L4 - iPart;
  if (frac < 0) frac += 1;
  const majorSpacing = BASE_SPACING / Math.pow(4, iPart);
  return { majorSpacing, fraction: frac };
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

/* ------------------------------------------------------------------
   DRAW REMOTE CURSORS
------------------------------------------------------------------ */
function drawRemoteCursors(ctx) {
  // We'll draw cursors for all users except our own
  ctx.save();
  for (const [uId, pos] of remoteCursors) {
    if (uId === localUserId) continue;
    const sx = (pos.x - camX) * scale;
    const sy = (pos.y - camY) * scale;
    const info = userInfoMap.get(uId);
    const color = info?.color || "#FFA500";
    drawArrowCursor(ctx, sx, sy, color, uId);
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
