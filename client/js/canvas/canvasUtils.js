// =========================
// FILE: client/js/canvas/canvasUtils.js
// =========================

import { state } from './canvasState.js';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { sendWSMessage } from '../../js/wsClient.js'; // New import

export function getCanvas2DContext() {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return null;
  return canvas.getContext('2d');
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function boxesOverlap(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  return !(ax2 < bx1 || ax1 > bx2 || ay2 < by1 || ay1 > by2);
}

export function getEffectiveMajorSpacing(scale) {
  const BASE_SPACING = 100;
  const L4 = Math.log2(scale) / 2;
  let iPart = Math.floor(L4);
  let frac = L4 - iPart;
  if (frac < 0) {
    frac += 1;
    iPart -= 1;
  }
  const majorSpacing = BASE_SPACING / Math.pow(4, iPart);
  const fraction = frac;
  return { majorSpacing, fraction };
}

/**
 * Replaces the old window.__sendWSMessage usage.
 */
export function sendCursorUpdate(uId, wx, wy) {
  if (!uId) return;
  sendWSMessage({
    type: MESSAGE_TYPES.CURSOR_UPDATE,
    userId: uId,
    x: wx,
    y: wy,
  });
}
