/**
 * client/js/canvas/canvasTools.js
 *
 * Main logic for shape selection, marquee, shape creation,
 * panning, dragging, resizing, etc.
 *
 * We have removed the old handleGlobalKeyDown function from here
 * so that keyboard handling is consolidated in canvasEvents.js.
 */

import { state } from './canvasState.js';
import { requestRender } from './canvasRender.js';
import { MESSAGE_TYPES } from '../../../shared/wsMessageTypes.js';
import { boxesOverlap } from './canvasUtils.js';

/** 
 * Replace local elements with the array from the server.
 */
export function createOrUpdateElementsFromServer(serverElements) {
  state.elements = serverElements || [];
}

/** 
 * Remove any selection that is locked by others or no longer exists. 
 */
export function removeObsoleteSelections(myUserId) {
  state.selectedElementIds = state.selectedElementIds.filter(id => {
    const el = state.elements.find(e => e.id === id);
    if (!el) return false;
    if (el.lockedBy && el.lockedBy !== myUserId) return false;
    return true;
  });
  for (const k of Object.keys(state.lockedOffsets)) {
    if (!state.selectedElementIds.includes(+k)) {
      delete state.lockedOffsets[k];
    }
  }
}

/**
 * Handle cursor messages from the server => store in remoteCursors.
 */
export function handleCursorData(data, myUserId) {
  if (data.type === MESSAGE_TYPES.CURSOR_UPDATE) {
    if (data.userId !== myUserId) {
      state.remoteCursors.set(data.userId, { x: data.x, y: data.y });
    }
  } else if (data.type === MESSAGE_TYPES.CURSOR_UPDATES) {
    for (const [uId, pos] of Object.entries(data.cursors)) {
      state.remoteCursors.set(uId, pos);
    }
    // remove old cursors not in data
    for (const oldId of state.remoteCursors.keys()) {
      if (!data.cursors[oldId]) {
        state.remoteCursors.delete(oldId);
      }
    }
  }
}

/** Remove stale remote cursors for missing users. */
export function removeStaleRemoteCursors(currentUserIds) {
  for (const [uId] of state.remoteCursors) {
    if (!currentUserIds.includes(uId)) {
      state.remoteCursors.delete(uId);
    }
  }
}

/** Update local user ID (e.g. after login). */
export function setLocalUserId(newId) {
  state.localUserId = newId;
}

/* ------------------------------------------------------------------
   Pointer-based interactions for shape creation & selection
------------------------------------------------------------------ */

/** Called from pointerdown if the user is not clicking a resize handle. */
export function onPointerDownSelectOrCreate(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const wx = state.camX + sx / state.scale;
  const wy = state.camY + sy / state.scale;

  const tool = getCurrentTool();
  if (tool === 'select') {
    // Attempt to select or start marquee
    const clicked = findTopmostElementAt(wx, wy);
    if (clicked) {
      // If shape is locked by someone else, do nothing
      if (clicked.lockedBy && clicked.lockedBy !== state.localUserId) {
        return;
      }
      // SHIFT => toggle selection
      if (e.shiftKey) {
        if (state.selectedElementIds.includes(clicked.id)) {
          sendDeselectElement([clicked.id]);
          state.selectedElementIds = state.selectedElementIds.filter(id => id !== clicked.id);
          delete state.lockedOffsets[clicked.id];
        } else {
          sendGrabElement(clicked.id);
          state.selectedElementIds.push(clicked.id);
        }
        return;
      }
      // else single select
      if (!state.selectedElementIds.includes(clicked.id)) {
        sendDeselectElement(state.selectedElementIds);
        state.selectedElementIds = [];
        sendGrabElement(clicked.id);
        state.selectedElementIds.push(clicked.id);
      }
      // Start dragging if locked by me
      for (const id of state.selectedElementIds) {
        const el = state.elements.find(ele => ele.id === id);
        if (el?.lockedBy === state.localUserId) {
          state.lockedOffsets[id] = {
            dx: wx - el.x,
            dy: wy - el.y
          };
        }
      }
      state.isDragging = true;
      canvas.classList.add('grabbing');
    } else {
      // No shape => start marquee
      state.isMarqueeSelecting = true;
      state.marqueeStart.xCanvas = sx * window.devicePixelRatio;
      state.marqueeStart.yCanvas = sy * window.devicePixelRatio;
      state.marqueeEnd.xCanvas = state.marqueeStart.xCanvas;
      state.marqueeEnd.yCanvas = state.marqueeStart.yCanvas;

      state.marqueeStart.xWorld = wx;
      state.marqueeStart.yWorld = wy;
      state.marqueeEnd.xWorld = wx;
      state.marqueeEnd.yWorld = wy;

      if (!e.shiftKey) {
        deselectAll();
      }
      state.isDragging = false;
      canvas.classList.add('grabbing');
    }
  } else {
    // shape creation (rectangle, ellipse, text, etc.)
    startShapeCreation(tool, wx, wy);
  }
}

/** pointermove => might be dragging shapes, marquee, or shape creation. */
export function onPointerMoveCommon(e, canvas) {
  // If user is dragging shapes
  if (state.isDragging && (e.buttons & 1)) {
    doDragSelected(e, canvas);
    return;
  }

  // If marquee
  if (state.isMarqueeSelecting && (e.buttons & 1)) {
    updateMarquee(e, canvas);
    return;
  }

  // If shape creation
  if (state.creationState?.active && (e.buttons & 1)) {
    updateShapeCreation(e, canvas);
    return;
  }

  // Otherwise update hover cursor if needed
  updateHoverCursor(e, canvas);
}

/** pointerup => normal end of shape creation or marquee or drag. */
export function onPointerUpCommon(e, canvas) {
  if (state.isDragging && e.button === 0) {
    // end dragging
    state.isDragging = false;
    canvas.classList.remove('grabbing');
    for (const k of Object.keys(state.lockedOffsets)) {
      delete state.lockedOffsets[k];
    }
  }
  // End shape creation
  if (state.creationState?.active && e.button === 0) {
    finalizeShapeCreation();
  }
  // End marquee
  if (state.isMarqueeSelecting && e.button === 0) {
    finalizeMarquee(e, canvas);
  }
}

/** pointercancel/leave => if dragging, stop. */
export function onPointerCancelOrLeaveCommon(e) {
  if (state.isDragging) {
    state.isDragging = false;
    for (const k of Object.keys(state.lockedOffsets)) {
      delete state.lockedOffsets[k];
    }
  }
}

/* ------------------------------------------------------------------
   DRAG SELECTED SHAPES
------------------------------------------------------------------ */
function doDragSelected(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const wx = state.camX + sx / state.scale;
  const wy = state.camY + sy / state.scale;

  for (const id of state.selectedElementIds) {
    const el = state.elements.find(ele => ele.id === id);
    if (el?.lockedBy === state.localUserId) {
      const off = state.lockedOffsets[id];
      if (off) {
        const nx = wx - off.dx;
        const ny = wy - off.dy;
        sendMoveElement(id, nx, ny);
      }
    }
  }
}

/* ------------------------------------------------------------------
   MARQUEE
------------------------------------------------------------------ */
function updateMarquee(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  state.marqueeEnd.xCanvas = (e.clientX - rect.left) * window.devicePixelRatio;
  state.marqueeEnd.yCanvas = (e.clientY - rect.top) * window.devicePixelRatio;

  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  state.marqueeEnd.xWorld = state.camX + sx / state.scale;
  state.marqueeEnd.yWorld = state.camY + sy / state.scale;
}

function finalizeMarquee(e, canvas) {
  state.isMarqueeSelecting = false;
  canvas.classList.remove('grabbing');

  const rminX = Math.min(state.marqueeStart.xWorld, state.marqueeEnd.xWorld);
  const rmaxX = Math.max(state.marqueeStart.xWorld, state.marqueeEnd.xWorld);
  const rminY = Math.min(state.marqueeStart.yWorld, state.marqueeEnd.yWorld);
  const rmaxY = Math.max(state.marqueeStart.yWorld, state.marqueeEnd.yWorld);

  const newlySelected = [];
  for (const el of state.elements) {
    if (el.lockedBy && el.lockedBy !== state.localUserId) continue;
    const ex2 = el.x + el.w;
    const ey2 = el.y + el.h;
    if (!boxesOverlap(rminX, rminY, rmaxX, rmaxY, el.x, el.y, ex2, ey2)) {
      continue;
    }
    newlySelected.push(el.id);
  }

  if (!e.shiftKey) {
    deselectAll();
  }
  for (const id of newlySelected) {
    if (!state.selectedElementIds.includes(id)) {
      state.selectedElementIds.push(id);
      sendGrabElement(id);
    }
  }
}

/* ------------------------------------------------------------------
   SHAPE CREATION (rectangle, ellipse, text, etc.)
------------------------------------------------------------------ */
function startShapeCreation(tool, wx, wy) {
  state.creationState = {
    active: true,
    tool,
    startWX: wx,
    startWY: wy,
    curWX: wx,
    curWY: wy
  };
}

function updateShapeCreation(e, canvas) {
  if (!state.creationState?.active) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const wx = state.camX + sx / state.scale;
  const wy = state.camY + sy / state.scale;

  state.creationState.curWX = wx;
  state.creationState.curWY = wy;
}

function finalizeShapeCreation() {
  if (!state.creationState) return;
  const { tool, startWX, startWY, curWX, curWY } = state.creationState;
  state.creationState.active = false;

  let x = Math.min(startWX, curWX);
  let y = Math.min(startWY, curWY);
  let w = Math.abs(curWX - startWX);
  let h = Math.abs(curWY - startWY);

  // SHIFT => square for rectangle/ellipse
  if (state.shiftDown && (tool === 'rectangle' || tool === 'ellipse')) {
    const side = Math.max(w, h);
    w = side;
    h = side;
  }
  // text => fixed height
  if (tool === 'text') {
    const TEXT_DEFAULT_HEIGHT = 30;
    h = TEXT_DEFAULT_HEIGHT;
  }
  if (w < 2 && h < 2) return;

  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);

  deselectAll();

  sendElementCreate(tool, x, y, w, h);
  revertToSelectTool();
}

/* ------------------------------------------------------------------
   RESIZING LOGIC
------------------------------------------------------------------ */

/**
 * Return the bounding box around the selected elements, or null if none.
 */
function getSelectionBoundingBox() {
  if (!state.selectedElementIds.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of state.selectedElementIds) {
    const el = state.elements.find(e => e.id === id);
    if (!el) continue;
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  if (minX > maxX || minY > maxY) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Return true if we can transform (resize) all selected shapes,
 * i.e. none are locked by someone else.
 */
function canTransformSelection() {
  if (!state.selectedElementIds.length) return false;
  for (const id of state.selectedElementIds) {
    const el = state.elements.find(e => e.id === id);
    if (!el) continue;
    if (el.lockedBy && el.lockedBy !== state.localUserId) {
      return false;
    }
  }
  return true;
}

/** hitTestResizeHandles(e, canvas) => returns which handle name was clicked. */
export function hitTestResizeHandles(e, canvas) {
  if (!canTransformSelection()) return null;
  const bb = getSelectionBoundingBox();
  if (!bb) return null;

  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  // Convert to world coords
  const wx = state.camX + sx / state.scale;
  const wy = state.camY + sy / state.scale;

  // corner radius
  const cornerRadius = 8 / state.scale;
  // corners
  const corners = [
    { x: bb.x,        y: bb.y,        name: 'top-left' },
    { x: bb.x+bb.w,   y: bb.y,        name: 'top-right' },
    { x: bb.x,        y: bb.y+bb.h,   name: 'bottom-left' },
    { x: bb.x+bb.w,   y: bb.y+bb.h,   name: 'bottom-right' }
  ];
  for (const c of corners) {
    const dx = wx - c.x;
    const dy = wy - c.y;
    if (dx*dx + dy*dy <= cornerRadius*cornerRadius) {
      return c.name;
    }
  }

  // edges => smaller tolerance
  const edgeTol = 6 / state.scale;
  // top
  if (wy >= bb.y - edgeTol && wy <= bb.y + edgeTol && wx >= bb.x && wx <= bb.x+bb.w) {
    return 'top';
  }
  // bottom
  if (wy >= (bb.y+bb.h - edgeTol) && wy <= (bb.y+bb.h + edgeTol) && wx >= bb.x && wx <= bb.x+bb.w) {
    return 'bottom';
  }
  // left
  if (wx >= bb.x - edgeTol && wx <= bb.x + edgeTol && wy >= bb.y && wy <= bb.y+bb.h) {
    return 'left';
  }
  // right
  if (wx >= (bb.x+bb.w - edgeTol) && wx <= (bb.x+bb.w + edgeTol) && wy >= bb.y && wy <= bb.y+bb.h) {
    return 'right';
  }

  return null;
}

/** startResizing => store boundingBoxAtDragStart, shapesSnapshot, etc. */
export function startResizing(handleName, e, canvas) {
  state.isResizing = true;
  state.activeHandle = handleName;

  const bb = getSelectionBoundingBox();
  if (!bb) return; // no selection
  state.boundingBoxAtDragStart = { ...bb };

  state.shapesSnapshot = [];
  for (const id of state.selectedElementIds) {
    const el = state.elements.find(x => x.id === id);
    if (!el) continue;
    // store offset relative to bounding box origin
    const relX = el.x - bb.x;
    const relY = el.y - bb.y;
    state.shapesSnapshot.push({
      id: el.id,
      x: el.x,
      y: el.y,
      w: el.w,
      h: el.h,
      relX,
      relY
    });
  }
}

/** updateResizing => pointermove => adjust bounding box, scale shapes, sendResizeElement. */
export function updateResizing(e, canvas) {
  if (!state.isResizing) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const wx = state.camX + sx / state.scale;
  const wy = state.camY + sy / state.scale;

  let bb = { ...state.boundingBoxAtDragStart };

  if (state.activeHandle.includes('left')) {
    const newX = Math.min(bb.x + bb.w - 2, wx);
    const deltaLeft = newX - bb.x;
    bb.x = newX;
    bb.w -= deltaLeft;
  }
  if (state.activeHandle.includes('right')) {
    const newW = Math.max(2, wx - bb.x);
    bb.w = newW;
  }
  if (state.activeHandle.includes('top')) {
    const newY = Math.min(bb.y + bb.h - 2, wy);
    const deltaTop = newY - bb.y;
    bb.y = newY;
    bb.h -= deltaTop;
  }
  if (state.activeHandle.includes('bottom')) {
    const newH = Math.max(2, wy - bb.y);
    bb.h = newH;
  }

  // SHIFT => preserve aspect ratio if it's a corner
  if (
    state.shiftDown &&
    (state.activeHandle === 'top-left' ||
     state.activeHandle === 'top-right' ||
     state.activeHandle === 'bottom-left' ||
     state.activeHandle === 'bottom-right')
  ) {
    const originalRatio = state.boundingBoxAtDragStart.w / state.boundingBoxAtDragStart.h;
    const newRatio = bb.w / bb.h;
    if (newRatio > originalRatio) {
      // match width’s scale
      const wFactor = bb.w / state.boundingBoxAtDragStart.w;
      bb.h = state.boundingBoxAtDragStart.h * wFactor;
      if (state.activeHandle.includes('top')) {
        bb.y = state.boundingBoxAtDragStart.y + state.boundingBoxAtDragStart.h - bb.h;
      }
      if (state.activeHandle.includes('left')) {
        bb.x = state.boundingBoxAtDragStart.x + state.boundingBoxAtDragStart.w - bb.w;
      }
    } else {
      // match height’s scale
      const hFactor = bb.h / state.boundingBoxAtDragStart.h;
      bb.w = state.boundingBoxAtDragStart.w * hFactor;
      if (state.activeHandle.includes('top')) {
        bb.y = state.boundingBoxAtDragStart.y + state.boundingBoxAtDragStart.h - bb.h;
      }
      if (state.activeHandle.includes('left')) {
        bb.x = state.boundingBoxAtDragStart.x + state.boundingBoxAtDragStart.w - bb.w;
      }
    }
  }

  const scaleX = bb.w / state.boundingBoxAtDragStart.w;
  const scaleY = bb.h / state.boundingBoxAtDragStart.h;

  // For each shape in snapshot, compute new x,y,w,h, call sendResizeElement
  for (const snap of state.shapesSnapshot) {
    const el = state.elements.find(x => x.id === snap.id);
    if (!el) continue;
    if (el.lockedBy !== state.localUserId) continue; // must be locked by me

    let newX = el.x;
    let newY = el.y;
    let newW = el.w;
    let newH = el.h;

    // If horizontally resizing
    if (state.activeHandle.includes('left') || state.activeHandle.includes('right') ||
        state.activeHandle.includes('top-') || state.activeHandle.includes('bottom-')) {
      newX = bb.x + snap.relX * scaleX;
      newW = snap.w * scaleX;
    }
    // If vertically resizing
    if (state.activeHandle.includes('top') || state.activeHandle.includes('bottom') ||
        state.activeHandle.includes('left-') || state.activeHandle.includes('right-')) {
      newY = bb.y + snap.relY * scaleY;
      newH = snap.h * scaleY;
    }

    newX = Math.round(newX);
    newY = Math.round(newY);
    newW = Math.max(1, Math.round(newW));
    newH = Math.max(1, Math.round(newH));

    sendResizeElement(el.id, newX, newY, newW, newH);
  }
}

/** endResizing => stop, optionally push an "ELEMENT_RESIZE_END" if not forced cancel. */
export function endResizing(forceCancel) {
  state.isResizing = false;
  state.activeHandle = null;
  state.shapesSnapshot = [];

  if (!forceCancel && state.selectedElementIds.length) {
    sendElementResizeEnd(state.selectedElementIds);
  }
}

/* ------------------------------------------------------------------
   UTILITY FOR RESIZING & SELECT
------------------------------------------------------------------ */

/**
 * findTopmostElementAt => check (wx, wy) in world coords for top shape.
 */
function findTopmostElementAt(wx, wy) {
  for (let i = state.elements.length - 1; i >= 0; i--) {
    const el = state.elements[i];
    if (el.shape === 'ellipse') {
      const rx = el.w / 2;
      const ry = el.h / 2;
      const cx = el.x + rx;
      const cy = el.y + ry;
      const dx = wx - cx;
      const dy = wy - cy;
      if ((dx*dx)/(rx*rx) + (dy*dy)/(ry*ry) <= 1) {
        return el;
      }
    } else {
      if (wx >= el.x && wx <= el.x + el.w && wy >= el.y && wy <= el.y + el.h) {
        return el;
      }
    }
  }
  return null;
}

/** Possibly show "resize" cursors or normal pointer. */
function updateHoverCursor(e, canvas) {
  // If not resizing or dragging, we see if pointer is over a resize handle
  if (!state.isPanning && !state.isResizing && !state.isDragging) {
    const tool = getCurrentTool();
    if (tool === 'select' && canTransformSelection()) {
      const handle = hitTestResizeHandles(e, canvas);
      if (handle) {
        const cursor = getCursorForHandle(handle);
        canvas.style.cursor = cursor;
        return;
      }
    }
    canvas.style.cursor = 'default';
  }
}

/** Return which tool is selected. */
function getCurrentTool() {
  const palette = document.getElementById('tools-palette');
  if (!palette) return 'select';
  const btn = palette.querySelector('.tool-btn.selected');
  return btn?.dataset?.tool || 'select';
}

/** Return appropriate CSS cursor from handle name. */
function getCursorForHandle(handle) {
  if (handle === 'top-left' || handle === 'bottom-right') return 'nwse-resize';
  if (handle === 'top-right' || handle === 'bottom-left') return 'nesw-resize';
  if (handle === 'top' || handle === 'bottom') return 'ns-resize';
  if (handle === 'left' || handle === 'right') return 'ew-resize';
  return 'default';
}

/* ------------------------------------------------------------------
   SEND MESSAGES
------------------------------------------------------------------ */
function sendGrabElement(elementId) {
  if (window.__sendWSMessage) {
    window.__sendWSMessage({
      type: MESSAGE_TYPES.ELEMENT_GRAB,
      userId: state.localUserId,
      elementId,
    });
  }
}

function sendMoveElement(elementId, x, y) {
  if (window.__sendWSMessage) {
    window.__sendWSMessage({
      type: MESSAGE_TYPES.ELEMENT_MOVE,
      userId: state.localUserId,
      elementId,
      x,
      y,
    });
  }
}

function sendResizeElement(elementId, x, y, w, h) {
  if (window.__sendWSMessage) {
    window.__sendWSMessage({
      type: MESSAGE_TYPES.ELEMENT_RESIZE,
      userId: state.localUserId,
      elementId,
      x,
      y,
      w,
      h,
    });
  }
}

function sendElementResizeEnd(ids) {
  if (window.__sendWSMessage) {
    window.__sendWSMessage({
      type: MESSAGE_TYPES.ELEMENT_RESIZE_END,
      userId: state.localUserId,
      elementIds: ids,
    });
  }
}

function sendDeselectElement(elementIds) {
  if (!elementIds?.length) return;
  if (window.__sendWSMessage) {
    window.__sendWSMessage({
      type: MESSAGE_TYPES.ELEMENT_DESELECT,
      userId: state.localUserId,
      elementIds,
    });
  }
  for (const eid of elementIds) {
    delete state.lockedOffsets[eid];
  }
}

export function sendDeleteElements(elementIds) {
  if (window.__sendWSMessage) {
    window.__sendWSMessage({
      type: MESSAGE_TYPES.ELEMENT_DELETE,
      userId: state.localUserId,
      elementIds: [...elementIds],
    });
  }
}

function sendElementCreate(shape, x, y, w, h) {
  if (window.__sendWSMessage) {
    window.__sendWSMessage({
      type: MESSAGE_TYPES.ELEMENT_CREATE,
      userId: state.localUserId,
      shape,
      x,
      y,
      w,
      h,
    });
  }
}

/** Deselect everything. */
export function deselectAll() {
  if (state.selectedElementIds.length) {
    sendDeselectElement(state.selectedElementIds);
    state.selectedElementIds = [];
  }
}

function revertToSelectTool() {
  const palette = document.getElementById('tools-palette');
  if (!palette) return;
  const buttons = palette.querySelectorAll('.tool-btn');
  buttons.forEach((b) => {
    b.classList.remove('selected');
    if (b.dataset.tool === 'select') {
      b.classList.add('selected');
    }
  });
}
