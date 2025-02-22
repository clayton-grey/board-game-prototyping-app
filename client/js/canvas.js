/**
 * ./client/js/canvas.js
 *
 * Key change:
 *  - We export an "updateCanvasUserId(newId)" function so that 
 *    after logging in or out, the app can tell the canvas to use the new user ID 
 *    for future element grabbing/moving/releasing. 
 *
 * That fixes "can't deselect" after login.
 */

import { MESSAGE_TYPES } from "/shared/wsMessageTypes.js";

export const userInfoMap = new Map(); // userId -> { color, name }
const remoteCursors = new Map();

let localUserId = null;
let elements = [];
let currentProjectName = "New Project";

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

// Base grid spacing
const BASE_SPACING = 100;

/**
 * Exported so app.js can tell the canvas code 
 * "Hey, we changed from oldUserId => newUserId" after login/out.
 */
export function updateCanvasUserId(newId) {
  localUserId = newId;
}

/**
 * Called once on page load. We store userId in a local var 
 * that we can update later with updateCanvasUserId().
 */
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

/** Handle messages that update elements or cursors. */
export function handleCanvasMessage(data, myUserId) {
  switch (data.type) {
    case MESSAGE_TYPES.ELEMENT_STATE: {
      elements = data.elements || [];
      if (data.projectName) {
        currentProjectName = data.projectName;
      }
      // Keep selection only if still locked by me or unlocked
      selectedElementIds = selectedElementIds.filter((id) => {
        const el = elements.find((e) => e.id === id);
        if (!el) return false;
        return !el.lockedBy || el.lockedBy === myUserId;
      });
      // If we were dragging but lost lock, stop
      for (const id of selectedElementIds) {
        const el = elements.find(e => e.id === id);
        if (!el || el.lockedBy !== myUserId) {
          isDragging = false;
          break;
        }
      }
      break;
    }

    case MESSAGE_TYPES.CURSOR_UPDATES: {
      // Bulk update
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
    }

    case "cursor-update": {
      // single
      if (data.userId !== myUserId) {
        remoteCursors.set(data.userId, { x: data.x, y: data.y });
      }
      break;
    }

    case MESSAGE_TYPES.PROJECT_NAME_CHANGE: {
      currentProjectName = data.newName;
      break;
    }

    default:
      break;
  }
}

/** Called if the server updates a user's color or name. */
export function handleUserColorUpdate(userId, name, color) {
  userInfoMap.set(userId, { color, name });
}

/** Called if we get an updated project name from the server. */
export function setProjectNameFromServer(newName) {
  currentProjectName = newName;
}

/* ------------------------------------------------------------------
   MOUSE EVENTS
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
    marqueeEndCanvasX = marqueeStartCanvasX;
    marqueeEndCanvasY = marqueeStartCanvasY;
    marqueeStartWorldX = wx;
    marqueeStartWorldY = wy;
    marqueeEndWorldX = wx;
    marqueeEndWorldY = wy;

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
          const el = elements.find(ele => ele.id === id);
          if (el && el.lockedBy === localUserId) {
            lockedOffsets[id] = {
              dx: wx - el.x,
              dy: wy - el.y,
            };
          }
        }
        canvas.classList.add("grabbing");
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
        canvas.classList.add("grabbing");
      }
    } else {
      // start marquee
      isMarqueeSelecting = true;
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
      const el = elements.find(ele => ele.id === id);
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

    // evaluate marquee
    const rminX = Math.min(marqueeStartWorldX, marqueeEndWorldX);
    const rmaxX = Math.max(marqueeStartWorldX, marqueeEndWorldX);
    const rminY = Math.min(marqueeStartWorldY, marqueeEndWorldY);
    const rmaxY = Math.max(marqueeStartWorldY, marqueeEndWorldY);

    const newlySelected = [];
    for (const el of elements) {
      if (boxesOverlap(rminX, rminY, rmaxX, rmaxY, el.x, el.y, el.x + el.w, el.y + el.h)) {
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

/** Deselect any removed elements, grab newly selected. */
function updateSelection(newSelectedIds) {
  // Release removed
  const removed = selectedElementIds.filter(id => !newSelectedIds.includes(id));
  removed.forEach(rid => sendReleaseElement(rid));

  // Grab added
  const added = newSelectedIds.filter(id => !selectedElementIds.includes(id));
  added.forEach(aid => sendGrabElement(aid));

  selectedElementIds = newSelectedIds;
  if (isDragging && !selectedElementIds.length) {
    isDragging = false;
  }
}

function boxesOverlap(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  return !(ax2 < bx1 || ax1 > bx2 || ay2 < by1 || ay1 > by2);
}

/** Return the topmost element at (wx, wy). */
function findElementAt(wx, wy) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (wx >= el.x && wx <= el.x + el.w && wy >= el.y && wy <= el.y + el.h) {
      return el;
    }
  }
  return null;
}

/** Send ephemeral messages */
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

function updateZoomUI() {
  const el = document.getElementById("zoom-level");
  if (el) {
    el.textContent = `${Math.round(scale * 100)}%`;
  }
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
      // locked by me => blue
      if (el.lockedBy === localUserId) {
        outlineColor = "blue";
      } else if (el.lockedBy) {
        // locked by someone else => their color
        const info = userInfoMap.get(el.lockedBy);
        outlineColor = info?.color || "#FFA500";
      } else {
        // not locked but selected => blue
        outlineColor = "blue";
      }
    } else if (el.lockedBy) {
      // locked by someone else => color
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

function drawRemoteCursors(ctx) {
  ctx.save();
  for (const [uId, pos] of remoteCursors) {
    if (uId === localUserId) continue; // don't draw my own
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
