/**
 * client/js/canvas/canvasCamera.js
 *
 * Controls camera transformations (zoom, pan, 'frame all'), and
 * updates the zoom-level UI whenever scale changes.
 */

import { state } from "./canvasState.js";
import { requestRender } from "./canvasRender.js";

/** Speed constants for wheel & button zoom. Feel free to adjust. */
const WHEEL_ZOOM_SPEED = 0.0015;
const BUTTON_ZOOM_STEP = 0.25;

/** applyZoom => set new scale, update camX/camY so anchor stays pinned, call updateZoomUI. */
function applyZoom(newScale, anchorX, anchorY) {
  const oldScale = state.scale;
  if (newScale === oldScale) return;

  // Convert anchor to world coords at old scale
  const wx = state.camX + anchorX / oldScale;
  const wy = state.camY + anchorY / oldScale;

  state.scale = newScale;
  // Adjust camera so anchor is pinned
  state.camX = wx - anchorX / newScale;
  state.camY = wy - anchorY / newScale;

  updateZoomUI();
  requestRender();
}

/** clampScale => keep scale in [min, max]. */
function clampScale(value) {
  const { minScale, maxScale } = state;
  return Math.max(minScale, Math.min(maxScale, value));
}

/** Called by wheel => zoom, with anchor at pointer. */
export function handleWheelZoom(e, canvas) {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED);
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  const newScale = clampScale(state.scale * factor);
  applyZoom(newScale, sx, sy);
}

/** For the +/- zoom buttons => anchor around center. */
export function zoomAroundCenter(step) {
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const newScale = clampScale(state.scale + step);
  applyZoom(newScale, cw / 2, ch / 2);
}

/**
 * frameAllElements => if the user has selection, frame that;
 * otherwise frame all elements. Then call updateZoomUI.
 */
export function frameAllElements() {
  if (!state.elements.length) return;
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;

  // If there's a selection, frame just that. Else frame everything.
  const targets =
    state.selectedElementIds.length > 0
      ? state.elements.filter((el) => state.selectedElementIds.includes(el.id))
      : state.elements;

  for (const el of targets) {
    minX = Math.min(minX, el.x);
    maxX = Math.max(maxX, el.x + el.w);
    minY = Math.min(minY, el.y);
    maxY = Math.max(maxY, el.y + el.h);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return;

  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const cw = canvas.clientWidth,
    ch = canvas.clientHeight;
  const margin = 50;
  const scaleX = (cw - margin * 2) / w;
  const scaleY = (ch - margin * 2) / h;
  const newScale = clampScale(Math.min(scaleX, scaleY));

  const cx = minX + w / 2;
  const cy = minY + h / 2;

  state.scale = newScale;
  state.camX = cx - cw / (2 * newScale);
  state.camY = cy - ch / (2 * newScale);

  updateZoomUI();
  requestRender();
}

/** updateZoomUI => set #zoom-level text to e.g. "125%" */
function updateZoomUI() {
  const el = document.getElementById("zoom-level");
  if (el) {
    el.textContent = `${Math.round(state.scale * 100)}%`;
  }
}
