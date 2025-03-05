/**
 * @jest-environment jsdom
 */
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';
import {
  initCanvas,
  handleCanvasMessage,
  updateCanvasUserId
} from '../../client/js/canvas.js';
import * as wsClient from '../../client/js/wsClient.js';

// 1) Import the shared state from the canvas so we can reset it:
import { state } from '../../client/js/canvas/canvasState.js';

jest.mock('../../client/js/wsClient.js', () => ({
  sendWSMessage: jest.fn()
}));

// Polyfill PointerEvent if not present
if (typeof PointerEvent === 'undefined') {
  class PointerEventFake extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'mouse';
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  global.PointerEvent = PointerEventFake;
}

function dispatchPointerEvent(target, type, opts = {}) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    shiftKey: false,
    ...opts
  });
  target.dispatchEvent(event);
}

describe('canvas.js front-end logic with pointer-event polyfill', () => {
  let canvas;

  beforeAll(() => {
    // Polyfill setPointerCapture / releasePointerCapture
    Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', {
      value: () => {},
      configurable: true
    });

    // Provide stable bounding rect
    Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      configurable: true
    });

    global.devicePixelRatio = 1;
  });

  beforeEach(() => {
    // 2) Reset relevant state fields so leftover data doesn't cause NaN or weird coords
    state.camX = 0;
    state.camY = 0;
    state.scale = 1;
    state.elements = [];
    state.selectedElementIds = [];
    state.isPanning = false;
    state.isDragging = false;
    state.isResizing = false;
    // Clear calls
    wsClient.sendWSMessage.mockClear();

    document.body.innerHTML = `
      <canvas id="gameCanvas" width="800" height="600"></canvas>
      <div id="zoom-controls">
        <button id="zoom-in">+</button>
        <button id="zoom-out">-</button>
        <button id="frame-all">Frame</button>
        <span id="zoom-level">100%</span>
      </div>
      <div id="tools-palette">
        <button data-tool="select" class="tool-btn selected">Select</button>
        <button data-tool="rectangle" class="tool-btn">Rectangle</button>
      </div>
    `;
    canvas = document.getElementById('gameCanvas');
    initCanvas('testUser');
  });

  afterAll(() => {
    delete global.devicePixelRatio;
  });

  test('panning with right mouse button emits no element-based messages', () => {
    dispatchPointerEvent(canvas, 'pointerdown', {
      clientX: 100, 
      clientY: 100,
      button: 2,
      buttons: 2
    });
    dispatchPointerEvent(canvas, 'pointermove', {
      clientX: 120, 
      clientY: 120,
      button: 2,
      buttons: 2
    });
    dispatchPointerEvent(canvas, 'pointerup', {
      clientX: 120, 
      clientY: 120,
      button: 2,
      buttons: 0
    });

    const nonCursor = wsClient.sendWSMessage.mock.calls.filter(
      ([msg]) => ![MESSAGE_TYPES.CURSOR_UPDATE, MESSAGE_TYPES.CURSOR_UPDATES].includes(msg.type)
    );
    expect(nonCursor).toHaveLength(0);
  });

  test('selecting an existing shape triggers ELEMENT_GRAB', () => {
    handleCanvasMessage({
      type: MESSAGE_TYPES.ELEMENT_STATE,
      elements: [
        { id: 1, x: 0, y: 0, w: 400, h: 400, lockedBy: null, shape: 'rectangle' }
      ]
    }, 'testUser');

    dispatchPointerEvent(canvas, 'pointerdown', {
      clientX: 50, clientY: 50, button: 0, buttons: 1
    });
    dispatchPointerEvent(canvas, 'pointerup', {
      clientX: 50, clientY: 50, button: 0, buttons: 0
    });

    const grabMsg = wsClient.sendWSMessage.mock.calls.find(
      ([msg]) => msg.type === MESSAGE_TYPES.ELEMENT_GRAB
    );
    expect(grabMsg).toBeTruthy();
    expect(grabMsg[0]).toMatchObject({
      type: MESSAGE_TYPES.ELEMENT_GRAB,
      elementId: 1,
      userId: 'testUser'
    });
  });

  test('dragging a selected shape calls ELEMENT_MOVE (after shape is locked)', () => {
    // 1) Insert shape #10
    handleCanvasMessage({
      type: MESSAGE_TYPES.ELEMENT_STATE,
      elements: [
        { id: 10, x: 0, y: 0, w: 400, h: 400, lockedBy: null, shape: 'rectangle' }
      ]
    }, 'testUser');

    // pointerDown->pointerUp => triggers GRAB
    dispatchPointerEvent(canvas, 'pointerdown', {
      clientX: 60, clientY: 60, button: 0, buttons: 1
    });
    dispatchPointerEvent(canvas, 'pointerup', {
      clientX: 60, clientY: 60, button: 0, buttons: 0
    });
    const grabCall = wsClient.sendWSMessage.mock.calls.find(
      ([m]) => m.type === MESSAGE_TYPES.ELEMENT_GRAB
    );
    expect(grabCall).toBeTruthy();

    // 2) Fake server => shape locked by testUser
    handleCanvasMessage({
      type: MESSAGE_TYPES.ELEMENT_STATE,
      elements: [
        { id: 10, x: 0, y: 0, w: 400, h: 400, lockedBy: 'testUser', shape: 'rectangle' }
      ]
    }, 'testUser');

    wsClient.sendWSMessage.mockClear();

    // 3) pointerDown again => now we start the actual drag
    dispatchPointerEvent(canvas, 'pointerdown', {
      clientX: 60, clientY: 60, button: 0, buttons: 1
    });
    // pointerMove => from (60,60) to (120,80)
    dispatchPointerEvent(canvas, 'pointermove', {
      clientX: 120, clientY: 80, button: 0, buttons: 1
    });
    // pointerUp => finalize
    dispatchPointerEvent(canvas, 'pointerup', {
      clientX: 120, clientY: 80, button: 0, buttons: 0
    });

    const allCalls = wsClient.sendWSMessage.mock.calls;
    console.log('All calls =>', allCalls);

    // Expect an ELEMENT_MOVE
    const moveMsg = allCalls.find(([m]) => m.type === MESSAGE_TYPES.ELEMENT_MOVE);
    expect(moveMsg).toBeTruthy();
    expect(moveMsg[0]).toMatchObject({
      type: MESSAGE_TYPES.ELEMENT_MOVE,
      elementId: 10,
      userId: 'testUser'
    });
  });

  test('updating local user ID changes subsequent messages', () => {
    handleCanvasMessage({
      type: MESSAGE_TYPES.ELEMENT_STATE,
      elements: [
        { id: 99, x: 0, y: 0, w: 800, h: 600, lockedBy: null, shape: 'rectangle' }
      ]
    }, 'testUser');

    updateCanvasUserId('someOtherUser');
    dispatchPointerEvent(canvas, 'pointerdown', {
      clientX: 100, clientY: 100,
      button: 0, buttons: 1
    });
    dispatchPointerEvent(canvas, 'pointerup', {
      clientX: 100, clientY: 100,
      button: 0, buttons: 0
    });

    const realCall = wsClient.sendWSMessage.mock.calls.find(
      ([m]) => m.type === MESSAGE_TYPES.ELEMENT_GRAB
    );
    expect(realCall).toBeTruthy();
    expect(realCall[0].userId).toBe('someOtherUser');
  });
});
