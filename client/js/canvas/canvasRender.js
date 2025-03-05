/**
 * client/js/canvas/canvasRender.js
 *
 * Renders the canvas each frame: draws background, grid,
 * shapes, cursors, ephemeral creation, etc.
 */

import { state } from './canvasState.js';
import {
  getCanvas2DContext,
  getEffectiveMajorSpacing,
  boxesOverlap
} from './canvasUtils.js';

// Track whether we’ve already scheduled a render
let animId = null;

/** requestRender() => schedule a new render pass (once) */
export function requestRender() {
  if (!animId) {
    animId = requestAnimationFrame(render);
  }
}

/** The main rendering loop. */
function render() {
  animId = null; // reset so we can schedule again
  const ctx = getCanvas2DContext();
  if (!ctx) return;

  // Clear the entire canvas
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();

  // Fill background, draw grid
  fillBackground(ctx);
  drawGrid(ctx);

  // Setup camera
  ctx.save();
  ctx.translate(-state.camX * state.scale, -state.camY * state.scale);
  ctx.scale(state.scale, state.scale);

  // Draw the actual shapes
  drawAllElements(ctx);

  // Draw bounding box if selection
  if (state.selectedElementIds.length && !state.creationState?.active) {
    drawSelectionBoundingBox(ctx);
  }

  // Ephemeral shape creation
  drawEphemeralCreation(ctx);

  ctx.restore();

  // Marquee
  if (state.isMarqueeSelecting) {
    drawMarquee(ctx);
  }

  // Remote cursors
  drawRemoteCursors(ctx);
}

/** Fill the screen with a neutral background. */
function fillBackground(ctx) {
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle = '#F0F0F0';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/** Draw a grid that scales with zoom. */
function drawGrid(ctx) {
  ctx.save();
  ctx.translate(-state.camX * state.scale, -state.camY * state.scale);
  ctx.scale(state.scale, state.scale);

  const cw = ctx.canvas.clientWidth / state.scale;
  const ch = ctx.canvas.clientHeight / state.scale;
  const { majorSpacing, fraction } = getEffectiveMajorSpacing(state.scale);

  const startX = Math.floor(state.camX / majorSpacing) * majorSpacing;
  const endX = Math.ceil((state.camX + cw) / majorSpacing) * majorSpacing;
  const startY = Math.floor(state.camY / majorSpacing) * majorSpacing;
  const endY = Math.ceil((state.camY + ch) / majorSpacing) * majorSpacing;

  ctx.strokeStyle = 'rgb(220,220,220)';
  ctx.lineWidth = 1 / state.scale;
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

  // Sub-lines if fraction > 0
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

/** Draw all elements (rect, ellipse, text, etc.). */
function drawAllElements(ctx) {
  for (const el of state.elements) {
    ctx.save();
    ctx.fillStyle = '#CCC';

    if (el.shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(el.x + el.w/2, el.y + el.h/2, el.w/2, el.h/2, 0, 0, Math.PI*2);
      ctx.fill();
    } else if (el.shape === 'text') {
      // placeholder text box
      ctx.fillStyle = '#FFE';
      ctx.fillRect(el.x, el.y, el.w, el.h);
      ctx.fillStyle = '#333';
      ctx.font = '14px sans-serif';
      ctx.fillText('Text', el.x + 5, el.y + (el.h/2) + 5);
    } else {
      // rectangle
      ctx.fillRect(el.x, el.y, el.w, el.h);
    }

    // Outline if locked by someone else
    if (el.lockedBy && el.lockedBy !== state.localUserId) {
      const info = state.userInfoMap.get(el.lockedBy);
      const outlineColor = info?.color || '#FFA500';
      ctx.lineWidth = 2 / state.scale;
      ctx.strokeStyle = outlineColor;
      if (el.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(el.x + el.w/2, el.y + el.h/2, el.w/2, el.h/2, 0, 0, Math.PI*2);
        ctx.stroke();
      } else {
        ctx.strokeRect(el.x, el.y, el.w, el.h);
      }
    }
    ctx.restore();
  }
}

/** Draw bounding box + corner handles for selected shapes. */
function drawSelectionBoundingBox(ctx) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of state.selectedElementIds) {
    const el = state.elements.find(e => e.id === id);
    if (!el) continue;
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  if (minX > maxX || minY > maxY) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,255,0.8)';
  ctx.lineWidth = 2 / state.scale;
  ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

  // corner handles
  const radius = 6 / state.scale;
  const cornerStroke = 4 / state.scale;
  const corners = [
    { x: minX,      y: minY },
    { x: maxX,      y: minY },
    { x: minX,      y: maxY },
    { x: maxX,      y: maxY },
  ];
  ctx.fillStyle = '#FFF';
  ctx.strokeStyle = '#A0A0A0';
  ctx.lineWidth = cornerStroke;
  for (const c of corners) {
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, radius, radius, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Ephemeral shape creation => uses creationState {startWX, startWY, curWX, curWY}. */
function drawEphemeralCreation(ctx) {
  if (!state.creationState?.active) return;
  const { tool, startWX, startWY, curWX, curWY } = state.creationState;

  let x = Math.min(startWX, curWX);
  let y = Math.min(startWY, curWY);
  let w = Math.abs(curWX - startWX);
  let h = Math.abs(curWY - startWY);

  if (state.shiftDown && (tool === 'rectangle' || tool === 'ellipse')) {
    const side = Math.max(w, h);
    w = side;
    h = side;
  }
  if (tool === 'text') {
    // default text height
    const TEXT_DEFAULT_HEIGHT = 30;
    h = TEXT_DEFAULT_HEIGHT;
  }

  // If shape is too small, don't bother showing anything
  if (w < 1 && h < 1) return;

  ctx.save();
  // We’re already in camera space, so these coords match up exactly
  ctx.beginPath();
  if (tool === 'ellipse') {
    ctx.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI*2);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.fillStyle = 'rgba(255,0,0,0.2)';
  ctx.fill();
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 2 / state.scale;
  ctx.stroke();
  ctx.restore();
}

/** Draw a marquee in screen coordinates for selection. */
function drawMarquee(ctx) {
  const rx = Math.min(state.marqueeStart.xCanvas, state.marqueeEnd.xCanvas);
  const ry = Math.min(state.marqueeStart.yCanvas, state.marqueeEnd.yCanvas);
  const rw = Math.abs(state.marqueeEnd.xCanvas - state.marqueeStart.xCanvas);
  const rh = Math.abs(state.marqueeEnd.yCanvas - state.marqueeStart.yCanvas);

  ctx.save();
  ctx.setTransform(1,0,0,1,0,0); // screen coords
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.fillStyle = 'rgba(0,0,255,0.2)';
  ctx.fill();
  ctx.strokeStyle = 'blue';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Draw remote user cursors. */
function drawRemoteCursors(ctx) {
  ctx.save();
  for (const [uId, pos] of state.remoteCursors.entries()) {
    if (uId === state.localUserId) continue;
    const info = state.userInfoMap.get(uId);
    const outlineColor = info?.color || '#FFA500';

    const sx = (pos.x - state.camX) * state.scale;
    const sy = (pos.y - state.camY) * state.scale;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(0,14);
    ctx.lineTo(4,10);
    ctx.lineTo(6,14);
    ctx.lineTo(8,12);
    ctx.lineTo(5,7);
    ctx.lineTo(9,3);
    ctx.lineTo(0,0);
    ctx.closePath();

    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '6px sans-serif';
    ctx.fillStyle = '#000';
    let label = info?.name || uId;
    ctx.fillText(label, 10, 6);

    ctx.restore();
  }
  ctx.restore();
}
