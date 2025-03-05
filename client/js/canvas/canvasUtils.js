/**
 * client/js/canvas/canvasUtils.js
 *
 * Utility functions needed by other modules.
 */

import { state } from './canvasState.js';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';

/** 
 * Return the 2D rendering context if it exists. 
 */
export function getCanvas2DContext() {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return null;
  return canvas.getContext('2d');
}

/**
 * Utility to clamp a number between min and max.
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Return true if the two boxes [ax1..ax2, ay1..ay2] and [bx1..bx2, by1..by2] overlap.
 */
export function boxesOverlap(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  return !(ax2 < bx1 || ax1 > bx2 || ay2 < by1 || ay1 > by2);
}

/**
 * Compute major grid spacing that looks nice at the given scale,
 * plus a fraction for sub-lines.  (Identical logic to original.)
 */
export function getEffectiveMajorSpacing(scale) {
  const BASE_SPACING = 100; // same as original
  const L4 = Math.log2(scale) / 2;
  let iPart = Math.floor(L4);
  let frac = L4 - iPart;
  if (frac < 0) {
    frac += 1;
    iPart -= 1;
  }
  const majorSpacing = BASE_SPACING / Math.pow(4, iPart);
  const fraction = frac; // 0..1
  return { majorSpacing, fraction };
}

/**
 * For completeness, reintroduce the same “sendCursorUpdate” that uses MESSAGE_TYPES,
 * but you may also do it inside your canvasTools. We'll keep it here if needed.
 */
export function sendCursorUpdate(uId, wx, wy) {
  if (!uId) return;
  if (window.__sendWSMessage) {
    window.__sendWSMessage({
      type: MESSAGE_TYPES.CURSOR_UPDATE,
      userId: uId,
      x: wx,
      y: wy,
    });
  }
}
