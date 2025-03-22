/**
 * client/js/canvas/canvasState.js
 */

const state = {
  elements: [],
  currentProjectName: "New Project",

  // Selection
  selectedElementIds: [],

  // Camera
  camX: 0,
  camY: 0,
  scale: 1.0,
  minScale: 0.01,
  maxScale: 16.0,

  // Flags
  isPanning: false,
  isDragging: false,
  isResizing: false,
  isMarqueeSelecting: false,
  shiftDown: false,

  // For ephemeral creation
  creationState: null, // { active, tool, startX, startY, curX, curY }

  // For marquee
  marqueeStart: {
    xCanvas: 0,
    yCanvas: 0,
    xWorld: 0,
    yWorld: 0,
  },
  marqueeEnd: {
    xCanvas: 0,
    yCanvas: 0,
    xWorld: 0,
    yWorld: 0,
  },

  // For dragging offsets (elementId -> { dx, dy })
  lockedOffsets: {},

  // local user ID
  localUserId: null,

  // Resizing
  isResizing: false,
  activeHandle: null, // e.g. 'top-left','bottom-right','left','top', etc.
  boundingBoxAtDragStart: { x: 0, y: 0, w: 0, h: 0 },
  shapesSnapshot: [], // array of { id, x, y, w, h, relX, relY }

  userInfoMap: new Map(), // userId -> { name, color }
  remoteCursors: new Map(), // userId -> { x, y }
};

/** Set or get project name */
function setCurrentProjectName(newName) {
  state.currentProjectName = newName || "New Project";
}
function getCurrentProjectName() {
  return state.currentProjectName;
}

export { state, setCurrentProjectName, getCurrentProjectName };
