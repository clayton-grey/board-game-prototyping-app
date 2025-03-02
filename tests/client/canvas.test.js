/**
 * @jest-environment jsdom
 */
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';
import {
  initCanvas,
  handleCanvasMessage,
  updateCanvasUserId
} from '../../client/js/canvas.js';

/**
 * Polyfill PointerEvent if not present.
 */
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

/**
 * Helper to dispatch a PointerEvent with sensible defaults:
 */
function dispatchPointerEvent(target, type, opts = {}) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0, // left
    buttons: 1,
    shiftKey: false,
    ...opts
  });
  target.dispatchEvent(event);
}

describe('canvas.js front-end logic with pointer-event polyfill', () => {
  let canvas;
  let mockSendWSMessage;

  beforeAll(() => {
    // Polyfill setPointerCapture / releasePointerCapture for jsdom:
    Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', {
      value: () => {},
      configurable: true
    });

    // Provide a stable bounding rect for test coordinates:
    Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      configurable: true
    });

    // Force devicePixelRatio=1 in test environment
    global.devicePixelRatio = 1;
  });

  beforeEach(() => {
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

    mockSendWSMessage = jest.fn();
    window.__sendWSMessage = mockSendWSMessage;

    initCanvas('testUser');
    mockSendWSMessage.mockClear();
  });

  afterAll(() => {
    delete global.devicePixelRatio;
    delete window.__sendWSMessage;
  });

  test('panning with right mouse button emits no element-based messages', () => {
    dispatchPointerEvent(canvas, 'pointerdown', {
      clientX: 100, 
      clientY: 100,
      button: 2,   // right
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

    // Some CURSOR_UPDATE calls may appear, but we want no ELEMENT_* calls
    const nonCursor = mockSendWSMessage.mock.calls.filter(
      ([msg]) => msg.type !== MESSAGE_TYPES.CURSOR_UPDATE
    );
    expect(nonCursor).toHaveLength(0);
  });

  test('selecting an existing shape triggers ELEMENT_GRAB', () => {
    // Insert a shape that definitely covers (50,50)
    handleCanvasMessage({
      type: MESSAGE_TYPES.ELEMENT_STATE,
      elements: [
        {
          id: 1,
          x: 0,
          y: 0,
          w: 800,
          h: 600,
          lockedBy: null,
          shape: 'rectangle'
        }
      ]
    }, 'testUser');

    // pointerDown -> pointerUp at (50,50) => inside shape => triggers selection
    dispatchPointerEvent(canvas, 'pointerdown', {
      clientX: 50,
      clientY: 50,
      button: 0, 
      buttons: 1
    });
    dispatchPointerEvent(canvas, 'pointerup', {
      clientX: 50,
      clientY: 50,
      button: 0,
      buttons: 0
    });

    // Look for an ELEMENT_GRAB message
    const grabMsg = mockSendWSMessage.mock.calls.find(
      ([m]) => m.type === MESSAGE_TYPES.ELEMENT_GRAB
    );
    expect(grabMsg).toBeTruthy(); // Was it found?
    expect(grabMsg[0]).toMatchObject({
      type: MESSAGE_TYPES.ELEMENT_GRAB,
      elementId: 1,
      userId: 'testUser'
    });
  });

  test('dragging a selected shape calls ELEMENT_MOVE (after shape is locked)', () => {
    // 1) Insert shape #10 covering (0..400, 0..400)
    handleCanvasMessage({
      type: MESSAGE_TYPES.ELEMENT_STATE,
      elements: [
        {
          id: 10,
          x: 0,
          y: 0,
          w: 400,
          h: 400,
          lockedBy: null,
          shape: 'rectangle'
        }
      ]
    }, 'testUser');

    // 2) pointerDown->pointerUp => triggers GRAB
    dispatchPointerEvent(canvas, 'pointerdown', {
      clientX: 60,
      clientY: 60,
      button: 0,
      buttons: 1
    });
    dispatchPointerEvent(canvas, 'pointerup', {
      clientX: 60,
      clientY: 60,
      button: 0,
      buttons: 0
    });

    // Confirm we saw an ELEMENT_GRAB:
    const grabCall = mockSendWSMessage.mock.calls.find(
      ([m]) => m.type === MESSAGE_TYPES.ELEMENT_GRAB
    );
    expect(grabCall).toBeTruthy();

    // 3) Pretend server updated shape #10 => now lockedBy:'testUser'
    handleCanvasMessage({
      type: MESSAGE_TYPES.ELEMENT_STATE,
      elements: [
        {
          id: 10,
          x: 0,
          y: 0,
          w: 400,
          h: 400,
          lockedBy: 'testUser',
          shape: 'rectangle'
        }
      ]
    }, 'testUser');

    // Clear old calls so we only watch for the new drag
    mockSendWSMessage.mockClear();

    // 4) Now drag from (60,60) to (120,80)
    dispatchPointerEvent(canvas, 'pointerdown', {
      clientX: 60,
      clientY: 60,
      button: 0,
      buttons: 1
    });
    dispatchPointerEvent(canvas, 'pointermove', {
      clientX: 120,
      clientY: 80,
      button: 0,
      buttons: 1
    });
    dispatchPointerEvent(canvas, 'pointerup', {
      clientX: 120,
      clientY: 80,
      button: 0,
      buttons: 0
    });

    // Check for ELEMENT_MOVE
    const moveMsg = mockSendWSMessage.mock.calls.find(
      ([m]) => m.type === MESSAGE_TYPES.ELEMENT_MOVE
    );
    expect(moveMsg).toBeTruthy();
    expect(moveMsg[0]).toMatchObject({
      type: MESSAGE_TYPES.ELEMENT_MOVE,
      elementId: 10,
      userId: 'testUser'
    });
  });

  test('creating a new rectangle shape sends ELEMENT_CREATE', () => {
    // Switch to 'rectangle' tool
    const rectBtn = document.querySelector('[data-tool="rectangle"]');
    rectBtn.click();
    mockSendWSMessage.mockClear();

    // pointerDown->pointerMove->pointerUp => shape creation
    dispatchPointerEvent(canvas, 'pointerdown', {
      clientX: 200, 
      clientY: 200,
      button: 0,
      buttons: 1
    });
    dispatchPointerEvent(canvas, 'pointermove', {
      clientX: 250,
      clientY: 240,
      button: 0,
      buttons: 1
    });
    dispatchPointerEvent(canvas, 'pointerup', {
      clientX: 250,
      clientY: 240,
      button: 0,
      buttons: 0
    });

    // We expect ELEMENT_CREATE in mock calls
    const createMsg = mockSendWSMessage.mock.calls.find(
      ([m]) => m.type === MESSAGE_TYPES.ELEMENT_CREATE
    );
    expect(createMsg).toBeTruthy();
    expect(createMsg[0]).toMatchObject({
      type: MESSAGE_TYPES.ELEMENT_CREATE,
      shape: 'rectangle',
      userId: 'testUser'
    });
  });

  test('updating local user ID changes subsequent messages', () => {
    // Provide a shape covering entire canvas so pointerDown is guaranteed inside
    handleCanvasMessage({
      type: MESSAGE_TYPES.ELEMENT_STATE,
      elements: [
        {
          id: 99,
          x: 0,
          y: 0,
          w: 800,
          h: 600,
          lockedBy: null,
          shape: 'rectangle'
        }
      ]
    }, 'testUser');

    updateCanvasUserId('someOtherUser');

    dispatchPointerEvent(canvas, 'pointerdown', {
      clientX: 100, 
      clientY: 100,
      button: 0, 
      buttons: 1
    });
    dispatchPointerEvent(canvas, 'pointerup', {
      clientX: 100,
      clientY: 100,
      button: 0,
      buttons: 0
    });

    // The first non-cursor message should have userId='someOtherUser'
    const realCall = mockSendWSMessage.mock.calls.find(
      ([m]) => m.type !== MESSAGE_TYPES.CURSOR_UPDATE
    );
    expect(realCall).toBeTruthy();
    expect(realCall[0].userId).toBe('someOtherUser');
  });
});
