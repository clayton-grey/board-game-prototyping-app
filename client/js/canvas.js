// ./client/js/canvas.js

//
// Camera in World Coordinates
//
// camX, camY => the TOP-LEFT corner of the view/camera in world coords
// scale => zoom factor (how many screen pixels per 1 world unit)
//
// So for any object at (worldX, worldY):
//   screenX = (worldX - camX) * scale
//   screenY = (worldY - camY) * scale
//

let canvas, ctx;
let cssWidth = 0;
let cssHeight = 0;

// Our “camera”
let camX = 0; 
let camY = 0;
let scale = 1.0;
const minScale = 0.01;
const maxScale = 16.0;

// For smooth wheel
const wheelZoomSpeed = 0.0015;
const buttonZoomStep = 0.25;

// For panning
let isPanning = false;
let lastMouseX = 0;
let lastMouseY = 0;

// Quarter-cycling grid constants
const BASE_SPACING = 100;
const SUB_DIVISIONS = 4;

// Example objects in world coords
const gameElements = [
  { x: 100, y: 100, w: 50, h: 50 },
  { x: 300, y: 200, w: 60, h: 80 },
];

// WebSocket and cursor data
let socket;
const userId = generateRandomUserId(); 
const cursors = new Map();  // userId => { x, y } in world coords
const userColors = new Map(); // userId => "rgb(...)"

export function initCanvas() {
  canvas = document.getElementById("gameCanvas");
  ctx = canvas.getContext("2d");

  function resize() {
    cssWidth = canvas.clientWidth;
    cssHeight = canvas.clientHeight;
    // For high‐DPI: a bigger buffer
    canvas.width = cssWidth * window.devicePixelRatio;
    canvas.height = cssHeight * window.devicePixelRatio;

    // Scale so that 1 “ctx unit” = 1 CSS pixel
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // Mouse events
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("mouseleave", onMouseUp);

  // Smooth exponential zoom
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // UI buttons
  document.getElementById("zoom-in").addEventListener("click", () => {
    zoomAroundPoint(scale + buttonZoomStep, cssWidth/2, cssHeight/2);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    zoomAroundPoint(scale - buttonZoomStep, cssWidth/2, cssHeight/2);
  });
  document.getElementById("frame-all").addEventListener("click", frameAllElements);

  initWebSocket();
  requestAnimationFrame(render);
}

//-----------------------
// WebSocket
//-----------------------
function initWebSocket() {
  socket = new WebSocket("ws://localhost:3000");

  socket.onopen = () => console.log("WS connected");
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "cursor-updates") {
        for (const [uId, pos] of Object.entries(data.cursors)) {
          cursors.set(uId, pos);
          if (!userColors.has(uId)) {
            userColors.set(uId, getRandomColor());
          }
        }
        // remove stale
        for (const key of cursors.keys()) {
          if (!data.cursors[key]) {
            cursors.delete(key);
            userColors.delete(key);
          }
        }
      }
    } catch (err) {
      console.error("WS parse error:", err);
    }
  };
  socket.onclose = () => console.log("WS closed");
}

/** 
 * Send local cursor in world coords
 */
function sendCursorPosition(wx, wy) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "cursor-update",
      userId,
      x: wx,
      y: wy,
    }));
  }
}

//-----------------------
// Mouse / Panning
//-----------------------
function onMouseDown(e) {
  isPanning = true;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
}
function onMouseMove(e) {
  if (isPanning) {
    // dx,dy in screen px
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;

    // Convert that to “world coords shift”
    // Because 1 screen px = 1/scale world units
    camX -= dx / scale; 
    camY -= dy / scale; 

    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }

  // Convert local pointer => world coords
  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;

  // worldX = camX + (screenX / scale)
  const wx = camX + screenX/scale;
  const wy = camY + screenY/scale;

  sendCursorPosition(wx, wy);
}
function onMouseUp() {
  isPanning = false;
}

//-----------------------
// Wheel => smooth exponential zoom
//-----------------------
function onWheel(e) {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * wheelZoomSpeed);

  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;

  zoomAroundPoint(scale * factor, screenX, screenY);
}

/** 
 * zoomAroundPoint(newScale, anchorX, anchorY)
 * where anchorX, anchorY are in screen px
 */
function zoomAroundPoint(newScale, anchorX, anchorY) {
  const oldScale = scale;
  scale = Math.max(minScale, Math.min(maxScale, newScale));
  if (scale === oldScale) return;

  // The anchor in world coords (before zoom)
  const wx = camX + anchorX/oldScale;
  const wy = camY + anchorY/oldScale;

  // After changing scale, we want (wx, wy) to remain at (anchorX, anchorY).
  // So camX = wx - anchorX/scale
  //    camY = wy - anchorY/scale
  camX = wx - (anchorX / scale);
  camY = wy - (anchorY / scale);

  updateZoomUI();
}

function updateZoomUI() {
  const el = document.getElementById("zoom-level");
  if (el) el.textContent = `${Math.round(scale * 100)}%`;
}

//-----------------------
// Frame all elements
//-----------------------
function frameAllElements() {
  if (!gameElements.length) return;

  // bounding box
  let minX=Infinity, maxX=-Infinity;
  let minY=Infinity, maxY=-Infinity;
  for (const el of gameElements) {
    minX = Math.min(minX, el.x);
    maxX = Math.max(maxX, el.x + el.w);
    minY = Math.min(minY, el.y);
    maxY = Math.max(maxY, el.y + el.h);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w<=0 || h<=0) return;

  const margin = 50;
  const scaleX = (cssWidth - margin*2)/ w;
  const scaleY = (cssHeight - margin*2)/ h;
  const newScale = Math.max(minScale, Math.min(maxScale, Math.min(scaleX, scaleY)));
  scale = newScale;

  // Center in world coords
  const cx = minX + w/2;
  const cy = minY + h/2;

  // We want that center to appear in screen center => anchorX= cssWidth/2, anchorY= cssHeight/2
  // So camX = cx - (anchorX/scale)
  //    camY = cy - (anchorY/scale)
  camX = cx - (cssWidth/2)/ scale;
  camY = cy - (cssHeight/2)/ scale;

  updateZoomUI();
}

//-----------------------
// Render loop
//-----------------------
function render() {
  // Clear entire buffer
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0, canvas.width, canvas.height);
  ctx.restore();

  fillBackground();
  drawModularGrid();

  // Draw example objects
  ctx.save();
  // We do a single transform for the camera => screen
  // screenX = (worldX - camX)*scale, screenY = (worldY - camY)*scale
  ctx.translate(-camX*scale, -camY*scale);
  ctx.scale(scale, scale);
  drawElements();
  ctx.restore();

  // Now draw remote cursors
  drawCursors();

  requestAnimationFrame(render);
}

function fillBackground() {
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle = "#F0F0F0";
  ctx.fillRect(0,0, canvas.width, canvas.height);
  ctx.restore();
}

/** 
 * Quarter-cycling grid => 
 * We'll do the same camera transform as for objects,
 * plus a little logic to figure out how big to draw lines.
 */
function drawModularGrid() {
  ctx.save();
  // camera transform => (-(camX)*scale, -(camY)*scale), then scale
  ctx.translate(-camX*scale, -camY*scale);
  ctx.scale(scale, scale);

  // We want lines every 'majorSpacing' in world coords
  // majorSpacing depends on scale => log base 4
  const { majorSpacing, fraction } = getEffectiveMajorSpacing(scale);
  const subAlpha = fraction;

  // figure out visible region in world coords
  const leftWorld = camX;
  const topWorld = camY;
  const rightWorld = camX + cssWidth/scale;
  const bottomWorld = camY + cssHeight/scale;

  const startX = Math.floor(leftWorld / majorSpacing) * majorSpacing;
  const endX = Math.ceil(rightWorld / majorSpacing) * majorSpacing;
  const startY = Math.floor(topWorld / majorSpacing) * majorSpacing;
  const endY = Math.ceil(bottomWorld / majorSpacing) * majorSpacing;

  // major lines
  ctx.strokeStyle = "rgb(220,220,220)";
  // 1 px in screen => lineWidth= 1/scale in world
  ctx.lineWidth = 1/scale;
  ctx.beginPath();
  for (let x = startX; x<= endX; x+= majorSpacing) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y<= endY; y+= majorSpacing) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }
  ctx.stroke();

  // sub lines if subAlpha>0
  if (subAlpha>0) {
    ctx.strokeStyle = `rgba(230,230,230,${subAlpha})`;
    const subSpacing = majorSpacing / SUB_DIVISIONS;
    ctx.beginPath();
    for (let x=startX; x<=endX; x+= majorSpacing) {
      for (let i=1; i<SUB_DIVISIONS; i++){
        const subX = x + i*subSpacing;
        ctx.moveTo(subX, startY);
        ctx.lineTo(subX, endY);
      }
    }
    for (let y=startY; y<=endY; y+= majorSpacing) {
      for (let i=1; i<SUB_DIVISIONS; i++){
        const subY = y + i*subSpacing;
        ctx.moveTo(startX, subY);
        ctx.lineTo(endX, subY);
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}

function getEffectiveMajorSpacing(s) {
  // log base 4 => L4= log2(s)/2
  const L4 = Math.log2(s)/2;
  const iPart = Math.floor(L4);
  let frac = L4 - iPart;
  if (frac<0) frac += 1;

  const majorSpacing = BASE_SPACING / Math.pow(4, iPart);
  return { majorSpacing, fraction: frac };
}

// Example objects
function drawElements() {
  ctx.fillStyle = "red";
  for (const el of gameElements) {
    ctx.fillRect(el.x, el.y, el.w, el.h);
  }
}

/**
 * Draw remote cursors
 */
function drawCursors() {
  // no bounding skip => can see them even if “off screen”
  ctx.save();
  // We'll do no camera transform here; we manually do it for each
  for (const [uId, pos] of cursors.entries()) {
    if (uId === userId) continue;

    // world => screen
    const sx = (pos.x - camX)*scale;
    const sy = (pos.y - camY)*scale;

    const color = userColors.get(uId) || "rgb(0,0,255)";
    drawArrowCursor(sx, sy, color, uId);
  }
  ctx.restore();
}

/** 
 * Draw a 4x arrow with tip at (sx,sy)
 */
function drawArrowCursor(sx, sy, color, label) {
  const ARROW_SCALE = 4;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(ARROW_SCALE, ARROW_SCALE);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16);
  ctx.lineTo(4, 12);
  ctx.lineTo(6, 16);
  ctx.lineTo(8, 14);
  ctx.lineTo(5, 9);
  ctx.lineTo(9, 5);
  ctx.lineTo(0, 0);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.font = "3px sans-serif"; 
  ctx.fillStyle = "#000";
  ctx.fillText(label, 10, 5);

  ctx.restore();
}

/**
 * ID & color
 */
function generateRandomUserId() {
  return "user_" + Math.floor(Math.random()*100000);
}
function getRandomColor() {
  const r= 150 + Math.floor(Math.random()*106);
  const g= 150 + Math.floor(Math.random()*106);
  const b= 150 + Math.floor(Math.random()*106);
  return `rgb(${r},${g},${b})`;
}
