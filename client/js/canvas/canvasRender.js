// =========================
// FILE: client/js/canvas/canvasRender.js
// =========================

import { state } from "./canvasState.js";
import { getCanvas2DContext, getEffectiveMajorSpacing } from "./canvasUtils.js";
import {
  drawRotationHandleScreenSpace,
  getSelectionBoundingBox,
} from "./canvasTools.js";

let animId = null;

/**
 * requestRender => queue up a requestAnimationFrame if not already queued
 */
export function requestRender() {
  if (!animId) {
    animId = requestAnimationFrame(render);
  }
}

/**
 * Main render function
 */
function render() {
  animId = null;
  const ctx = getCanvas2DContext();
  if (!ctx) return;

  // Clear entire canvas
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();

  fillBackground(ctx);
  drawGrid(ctx);

  // 1) Setup camera for world-space
  ctx.save();
  ctx.translate(-state.camX * state.scale, -state.camY * state.scale);
  ctx.scale(state.scale, state.scale);

  // 2) Draw shapes
  drawAllElements(ctx);

  // 3) Draw bounding box (in world coords) if needed
  let selectionBox = null;
  if (state.selectedElementIds.length && !state.creationState?.active) {
    selectionBox = drawSelectionBoundingBox(ctx);
  }

  // 4) Ephemeral shape creation
  drawEphemeralCreation(ctx);

  // done with world transform
  ctx.restore();

  // 5) Draw rotation handle in screen coords if there's a bounding box
  if (selectionBox) {
    drawRotationHandleScreenSpace(ctx, selectionBox);
  }

  // 6) Marquee in screen coords
  if (state.isMarqueeSelecting) {
    drawMarquee(ctx);
  }

  // 7) Remote cursors in screen coords
  drawRemoteCursors(ctx);
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
  ctx.translate(-state.camX * state.scale, -state.camY * state.scale);
  ctx.scale(state.scale, state.scale);

  const cw = ctx.canvas.clientWidth / state.scale;
  const ch = ctx.canvas.clientHeight / state.scale;
  const { majorSpacing, fraction } = getEffectiveMajorSpacing(state.scale);

  const startX = Math.floor(state.camX / majorSpacing) * majorSpacing;
  const endX = Math.ceil((state.camX + cw) / majorSpacing) * majorSpacing;
  const startY = Math.floor(state.camY / majorSpacing) * majorSpacing;
  const endY = Math.ceil((state.camY + ch) / majorSpacing) * majorSpacing;

  ctx.strokeStyle = "rgb(220,220,220)";
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

/**
 * Draw all shapes, applying rotation if el.angle is defined.
 */
function drawAllElements(ctx) {
  for (const el of state.elements) {
    ctx.save();

    // If 'angle' is in degrees, convert to radians
    const angleDeg = el.angle || 0;
    const angleRad = (angleDeg * Math.PI) / 180;

    // Move origin to shape center => rotate => then draw
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(angleRad);
    ctx.translate(-el.w / 2, -el.h / 2);

    // Fill shape
    if (el.shape === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(0, 0, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#CCC";
      ctx.fill();
    } else if (el.shape === "text") {
      ctx.fillStyle = "#FFE";
      ctx.fillRect(0, 0, el.w, el.h);
      ctx.fillStyle = "#333";
      ctx.font = "14px sans-serif";
      ctx.fillText("Text", 5, el.h / 2 + 5);
    } else {
      // rectangle
      ctx.fillStyle = "#CCC";
      ctx.fillRect(0, 0, el.w, el.h);
    }

    // Outline if locked by someone else
    if (el.lockedBy && el.lockedBy !== state.localUserId) {
      const info = state.userInfoMap.get(el.lockedBy);
      const outlineColor = info?.color || "#FFA500";
      ctx.lineWidth = 2;
      ctx.strokeStyle = outlineColor;
      if (el.shape === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(0, 0, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(0, 0, el.w, el.h);
      }
    }
    ctx.restore();
  }
}

function drawSelectionBoundingBox(ctx) {
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
  if (minX > maxX || minY > maxY) {
    return null;
  }

  ctx.save();
  ctx.strokeStyle = "rgba(0,0,255,0.8)";
  ctx.lineWidth = 2 / state.scale;
  ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

  // Draw corner handles
  const radius = 6 / state.scale;
  const cornerStroke = 4 / state.scale;
  const corners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
  ];
  ctx.fillStyle = "#FFF";
  ctx.strokeStyle = "#A0A0A0";
  ctx.lineWidth = cornerStroke;
  for (const c of corners) {
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, radius, radius, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  return { minX, minY, maxX, maxY };
}

function drawEphemeralCreation(ctx) {
  if (!state.creationState?.active) return;
  const { tool, startWX, startWY, curWX, curWY } = state.creationState;

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
    h = 30;
  }
  if (w < 1 && h < 1) return;

  ctx.save();
  ctx.beginPath();
  if (tool === "ellipse") {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.fillStyle = "rgba(255,0,0,0.2)";
  ctx.fill();
  ctx.lineWidth = 2 / state.scale;
  ctx.strokeStyle = "red";
  ctx.stroke();
  ctx.restore();
}

/** Draw marquee in screen coords */
function drawMarquee(ctx) {
  const rx = Math.min(state.marqueeStart.xCanvas, state.marqueeEnd.xCanvas);
  const ry = Math.min(state.marqueeStart.yCanvas, state.marqueeEnd.yCanvas);
  const rw = Math.abs(state.marqueeEnd.xCanvas - state.marqueeStart.xCanvas);
  const rh = Math.abs(state.marqueeEnd.yCanvas - state.marqueeStart.yCanvas);

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

/** Draw remote cursors in screen coords */
function drawRemoteCursors(ctx) {
  ctx.save();
  for (const [uId, pos] of state.remoteCursors.entries()) {
    if (uId === state.localUserId) continue;
    const info = state.userInfoMap.get(uId);
    const outlineColor = info?.color || "#FFA500";

    // Convert world coords -> screen coords
    const sx = (pos.x - state.camX) * state.scale;
    const sy = (pos.y - state.camY) * state.scale;

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
    const label = info?.name || uId;
    ctx.fillText(label, 10, 6);

    ctx.restore();
  }
  ctx.restore();
}
