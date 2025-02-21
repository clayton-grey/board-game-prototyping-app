// ./client/js/canvas.js

import { MESSAGE_TYPES } from '/shared/wsMessageTypes.js';

// Camera & Zoom
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

// Marquee selection
let isMarqueeSelecting = false;
// For the rectangle in actual canvas (pixel) coordinates:
let marqueeStartCanvasX = 0;
let marqueeStartCanvasY = 0;
let marqueeEndCanvasX = 0;
let marqueeEndCanvasY = 0;

// For selecting elements in world coords:
let marqueeStartWorldX = 0;
let marqueeStartWorldY = 0;
let marqueeEndWorldX = 0;
let marqueeEndWorldY = 0;

// Two-step selection & drag
let selectedElementIds = [];
let lockedOffsets = {};
let isDragging = false;

// Elements from server
let elements = [];

// Remote cursors
const userId = generateRandomUserId();
let socket;
const cursors = new Map();
const userColors = new Map();

// Color palette
const colorPalette = [
  '#FF0000', // Red
  '#0000FF', // Blue
  '#FFFF00', // Yellow
  '#FFA500', // Orange
  '#008000', // Green
  '#800080', // Purple
];
let colorIndex = 0;
function getNextColor() {
  const c = colorPalette[colorIndex % colorPalette.length];
  colorIndex++;
  return c;
}

// Quarter-cycling grid constants
const BASE_SPACING = 100;
const SUB_DIVISIONS = 4;

// Canvas & context
let canvas, ctx;
let cssWidth = 0;
let cssHeight = 0;

export function initCanvas() {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d');

  function resize() {
    cssWidth = canvas.clientWidth;
    cssHeight = canvas.clientHeight;

    // For high-DPI: bigger backing store
    canvas.width = cssWidth * window.devicePixelRatio;
    canvas.height = cssHeight * window.devicePixelRatio;

    // So that 1 ctx-unit = 1 CSS pixel
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Mouse events
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseUp);

  // Wheel => zoom
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Zoom UI
  document.getElementById('zoom-in').addEventListener('click', () => {
    zoomAroundPoint(scale + buttonZoomStep, cssWidth / 2, cssHeight / 2);
  });
  document.getElementById('zoom-out').addEventListener('click', () => {
    zoomAroundPoint(scale - buttonZoomStep, cssWidth / 2, cssHeight / 2);
  });
  document.getElementById('frame-all').addEventListener('click', frameAllElements);

  // ESC => clear selection
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      updateSelection([]);
    }
  });

  initWebSocket();
  requestAnimationFrame(render);
}

/* ----------------------------------
   WebSocket & Remote Cursors
-----------------------------------*/
function initWebSocket() {
  socket = new WebSocket('ws://localhost:3000');
  socket.onopen = () => console.log('WebSocket connected');

  socket.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (!data.type) return;

      switch (data.type) {
        case MESSAGE_TYPES.CURSOR_UPDATES:
          updateAllRemoteCursors(data.cursors);
          break;
        case MESSAGE_TYPES.ELEMENT_STATE:
          elements = data.elements;
          // remove from local selection if locked by someone else
          selectedElementIds = selectedElementIds.filter((id) => {
            const el = elements.find(e => e.id === id);
            if (!el) return false;
            return (!el.lockedBy || el.lockedBy === userId);
          });
          // if dragging but lost lock => stop
          if (isDragging) {
            for (const id of selectedElementIds) {
              const el = elements.find(e => e.id === id);
              if (!el || el.lockedBy !== userId) {
                isDragging = false;
                break;
              }
            }
          }
          break;
        default:
          break;
      }
    } catch (err) {
      console.error('WebSocket parse error:', err);
    }
  };

  socket.onclose = () => {
    console.log('WebSocket closed');
    // Clear selection if disconnected
    updateSelection([]);
  };
}

function updateAllRemoteCursors(newCursors) {
  for (const [uId, pos] of Object.entries(newCursors)) {
    cursors.set(uId, pos);
    if (!userColors.has(uId)) {
      userColors.set(uId, getNextColor());
    }
  }
  // remove stale
  for (const oldId of cursors.keys()) {
    if (!newCursors[oldId]) {
      cursors.delete(oldId);
      userColors.delete(oldId);
    }
  }
}

/* ----------------------------------
   Selection, Locking, Releasing
-----------------------------------*/
function updateSelection(newSelectedIds) {
  // release removed
  const removed = selectedElementIds.filter(id => !newSelectedIds.includes(id));
  for (const rid of removed) {
    releaseElement(rid);
  }
  // grab added
  const added = newSelectedIds.filter(id => !selectedElementIds.includes(id));
  for (const aid of added) {
    grabElement(aid);
  }
  selectedElementIds = [...newSelectedIds];

  if (isDragging && selectedElementIds.length === 0) {
    isDragging = false;
  }
}

function grabElement(elementId) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    type: MESSAGE_TYPES.ELEMENT_GRAB,
    userId,
    elementId
  }));
}

function releaseElement(elementId) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    type: MESSAGE_TYPES.ELEMENT_RELEASE,
    userId,
    elementId
  }));
}

function moveElement(elementId, x, y) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    type: MESSAGE_TYPES.ELEMENT_MOVE,
    userId,
    elementId,
    x,
    y
  }));
}

/* ----------------------------------
   Mouse & Marquee & Drag
-----------------------------------*/
function onMouseDown(e) {
  // Middle or right => panning
  if (e.button === 1 || e.button === 2) {
    isPanning = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    canvas.classList.add('grabbing');
    return;
  }

  // Left => selection / marquee / drag
  if (e.button === 0) {
    const rect = canvas.getBoundingClientRect();

    // For “canvas px”
    const canvasDownX = (e.clientX - rect.left) * devicePixelRatio;
    const canvasDownY = (e.clientY - rect.top) * devicePixelRatio;

    // For “world coords”
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const wx = camX + screenX / scale;
    const wy = camY + screenY / scale;

    const clicked = findElementAt(wx, wy);
    if (clicked) {
      // If locked by another => skip
      if (clicked.lockedBy && clicked.lockedBy !== userId) {
        return;
      }

      const isAlreadySelected = selectedElementIds.includes(clicked.id);
      if (isAlreadySelected) {
        // second click => drag
        isDragging = true;
        for (const id of selectedElementIds) {
          const el = elements.find(e => e.id === id);
          if (el && el.lockedBy === userId) {
            lockedOffsets[id] = { dx: wx - el.x, dy: wy - el.y };
          }
        }
      } else {
        // new selection or shift-add
        if (!e.shiftKey) {
          updateSelection([]);
        }
        const newSet = [...selectedElementIds];
        if (!newSet.includes(clicked.id)) {
          newSet.push(clicked.id);
        } else if (e.shiftKey) {
          // SHIFT => toggle out
          const idx = newSet.indexOf(clicked.id);
          newSet.splice(idx, 1);
        }
        updateSelection(newSet);
        isDragging = false; 
      }
      canvas.classList.add('grabbing');
    } else {
      // empty => start marquee
      isMarqueeSelecting = true;
      marqueeStartCanvasX = canvasDownX;
      marqueeStartCanvasY = canvasDownY;
      marqueeEndCanvasX = canvasDownX;
      marqueeEndCanvasY = canvasDownY;

      marqueeStartWorldX = wx;
      marqueeStartWorldY = wy;
      marqueeEndWorldX = wx;
      marqueeEndWorldY = wy;

      if (!e.shiftKey) {
        updateSelection([]);
      }
      isDragging = false;
      canvas.classList.add('grabbing');
    }
  }
}

function onMouseMove(e) {
  // Panning
  if (isPanning) {
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    camX -= dx / scale;
    camY -= dy / scale;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }

  // Drag
  if (isDragging) {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const wx = camX + screenX / scale;
    const wy = camY + screenY / scale;

    for (const id of selectedElementIds) {
      const el = elements.find(e => e.id === id);
      if (el && el.lockedBy === userId) {
        const off = lockedOffsets[id];
        if (off) {
          moveElement(id, wx - off.dx, wy - off.dy);
        }
      }
    }
  }

  // Marquee
  if (isMarqueeSelecting) {
    const rect = canvas.getBoundingClientRect();
    // Canvas px
    marqueeEndCanvasX = (e.clientX - rect.left) * devicePixelRatio;
    marqueeEndCanvasY = (e.clientY - rect.top) * devicePixelRatio;

    // World coords
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    marqueeEndWorldX = camX + screenX / scale;
    marqueeEndWorldY = camY + screenY / scale;
  }

  // Send local cursor
  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;
  const wx = camX + screenX / scale;
  const wy = camY + screenY / scale;
  sendCursorPosition(wx, wy);
}

function onMouseUp(e) {
  // End panning
  if ((e.button === 1 || e.button === 2) && isPanning) {
    isPanning = false;
    canvas.classList.remove('grabbing');
    return;
  }

  // End drag
  if (e.button === 0 && isDragging) {
    isDragging = false;
    canvas.classList.remove('grabbing');
    return;
  }

  // Finish marquee
  if (isMarqueeSelecting && e.button === 0) {
    isMarqueeSelecting = false;

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
        if (!el.lockedBy || el.lockedBy === userId) {
          newlySelected.push(el.id);
        }
      }
    }
    const finalSet = [...selectedElementIds];
    for (const id of newlySelected) {
      if (!finalSet.includes(id)) {
        finalSet.push(id);
      }
    }
    updateSelection(finalSet);

    canvas.classList.remove('grabbing');
  }
}

/* ----------------------------------
   Zoom & Wheel
-----------------------------------*/
function onWheel(e) {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * wheelZoomSpeed);

  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;

  zoomAroundPoint(scale * factor, screenX, screenY);
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
  const el = document.getElementById('zoom-level');
  if (el) {
    el.textContent = `${Math.round(scale * 100)}%`;
  }
}

/* ----------------------------------
   Frame All
-----------------------------------*/
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

  const margin = 50;
  const scaleX = (cssWidth - margin * 2) / w;
  const scaleY = (cssHeight - margin * 2) / h;
  const newScale = Math.max(minScale, Math.min(maxScale, Math.min(scaleX, scaleY)));
  scale = newScale;

  const cx = minX + w / 2;
  const cy = minY + h / 2;
  camX = cx - (cssWidth / 2) / scale;
  camY = cy - (cssHeight / 2) / scale;

  updateZoomUI();
}

/* ----------------------------------
   Main Render Loop
-----------------------------------*/
function render() {
  // Clear entire buffer
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0, canvas.width, canvas.height);
  ctx.restore();

  fillBackground();
  drawModularGrid();

  // draw elements
  ctx.save();
  ctx.translate(-camX * scale, -camY * scale);
  ctx.scale(scale, scale);

  for (const el of elements) {
    ctx.fillStyle = 'red';
    ctx.fillRect(el.x, el.y, el.w, el.h);

    if (el.lockedBy && el.lockedBy !== userId) {
      const lockColor = userColors.get(el.lockedBy) || '#FFA500';
      ctx.strokeStyle = lockColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(el.x, el.y, el.w, el.h);
    }
    if (selectedElementIds.includes(el.id)) {
      ctx.strokeStyle = 'blue';
      ctx.lineWidth = 2;
      ctx.strokeRect(el.x, el.y, el.w, el.h);
    }
  }
  ctx.restore();

  // if marquee => draw in canvas px
  if (isMarqueeSelecting) {
    drawMarquee();
  }

  drawCursors();
  requestAnimationFrame(render);
}

function fillBackground() {
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle = '#F0F0F0';
  ctx.fillRect(0,0, canvas.width, canvas.height);
  ctx.restore();
}

/* ----------------------------------
   Quarter-Cycling Grid
-----------------------------------*/
function drawModularGrid() {
  ctx.save();
  ctx.translate(-camX * scale, -camY * scale);
  ctx.scale(scale, scale);

  const { majorSpacing, fraction } = getEffectiveMajorSpacing(scale);

  const leftWorld = camX;
  const topWorld = camY;
  const rightWorld = camX + cssWidth / scale;
  const bottomWorld = camY + cssHeight / scale;

  const startX = Math.floor(leftWorld / majorSpacing) * majorSpacing;
  const endX = Math.ceil(rightWorld / majorSpacing) * majorSpacing;
  const startY = Math.floor(topWorld / majorSpacing) * majorSpacing;
  const endY = Math.ceil(bottomWorld / majorSpacing) * majorSpacing;

  ctx.strokeStyle = 'rgb(220,220,220)';
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
    const subSpacing = majorSpacing / SUB_DIVISIONS;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += majorSpacing) {
      for (let i = 1; i < SUB_DIVISIONS; i++) {
        const subX = x + i * subSpacing;
        ctx.moveTo(subX, startY);
        ctx.lineTo(subX, endY);
      }
    }
    for (let y = startY; y <= endY; y += majorSpacing) {
      for (let i = 1; i < SUB_DIVISIONS; i++) {
        const subY = y + i * subSpacing;
        ctx.moveTo(startX, subY);
        ctx.lineTo(endX, subY);
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}

function getEffectiveMajorSpacing(s) {
  // log base 4 => L4 = log2(s)/2
  const L4 = Math.log2(s) / 2;
  const iPart = Math.floor(L4);
  let frac = L4 - iPart;
  if (frac < 0) frac += 1;
  const majorSpacing = BASE_SPACING / Math.pow(4, iPart);
  return { majorSpacing, fraction: frac };
}

/* ----------------------------------
   Marquee in Canvas Coordinates
-----------------------------------*/
function drawMarquee() {
  const rx = Math.min(marqueeStartCanvasX, marqueeEndCanvasX);
  const ry = Math.min(marqueeStartCanvasY, marqueeEndCanvasY);
  const rw = Math.abs(marqueeEndCanvasX - marqueeStartCanvasX);
  const rh = Math.abs(marqueeEndCanvasY - marqueeStartCanvasY);

  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.fillStyle = 'rgba(0,0,255,0.2)';
  ctx.fill();
  ctx.strokeStyle = 'blue';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/* ----------------------------------
   Draw remote cursors
-----------------------------------*/
function drawCursors() {
  ctx.save();
  for (const [uId, pos] of cursors.entries()) {
    if (uId === userId) continue;
    const sx = (pos.x - camX) * scale;
    const sy = (pos.y - camY) * scale;
    const color = userColors.get(uId) || '#FFA500';
    drawArrowCursor(sx, sy, color, uId);
  }
  ctx.restore();
}

/* a smaller arrow => white fill, color outline */
function drawArrowCursor(sx, sy, outlineColor, label) {
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

  ctx.fillStyle = 'white';
  ctx.fill();

  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = '6px sans-serif';
  ctx.fillStyle = '#000';
  ctx.fillText(label, 10, 5);

  ctx.restore();
}

/* ----------------------------------
   Utilities
-----------------------------------*/
function generateRandomUserId() {
  return 'user_' + Math.floor(Math.random() * 100000);
}

function sendCursorPosition(wx, wy) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    type: MESSAGE_TYPES.CURSOR_UPDATE,
    userId,
    x: wx,
    y: wy,
  }));
}

function findElementAt(wx, wy) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (wx >= el.x && wx <= el.x + el.w &&
        wy >= el.y && wy <= el.y + el.h) {
      return el;
    }
  }
  return null;
}
