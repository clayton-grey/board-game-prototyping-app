// tests/unit/undoRedoHandlers.test.js
import { handleUndo, handleRedo, pushUndoAction } from '../../server/ws/handlers/undoRedoHandlers.js';
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

describe('undoRedoHandlers - main tests', () => {
  let session;
  let mockSend;

  beforeEach(() => {
    mockSend = jest.fn();
    session = {
      users: new Map([
        ['userA', { userId: 'userA', socket: { send: mockSend, readyState: 1 } }]
      ]),
      elements: [
        { id: 10, x: 0, y: 0, w: 50, h: 50 },
      ],
      undoStack: [],
      redoStack: [],
      pendingMoves: new Map(),
      pendingResizes: new Map(),
    };
  });

  test('pushUndoAction clears redoStack and appends to undoStack', () => {
    session.redoStack = [{ some: 'action' }];
    expect(session.redoStack.length).toBe(1);
    pushUndoAction(session, { type: 'testAction' });
    expect(session.undoStack.length).toBe(1);
    expect(session.undoStack[0]).toMatchObject({ type: 'testAction' });
    expect(session.redoStack.length).toBe(0);
  });

  test('handleUndo does nothing if undoStack is empty', () => {
    handleUndo(session, { userId: 'userA' }, {});
    expect(session.undoStack.length).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('handleUndo reverts the last action if canApplyAction is satisfied', () => {
    // Add an element
    session.elements.push({ id: 11, x: 50, y: 50, w: 20, h: 20, lockedBy: null });
    session.undoStack = [
      {
        type: 'move',
        diffs: [
          {
            elementId: 11,
            from: { x: 50, y: 50 },
            to: { x: 70, y: 70 },
          }
        ],
      }
    ];
    // The element is currently at x=70,y=70 => pretend it's moved
    session.elements[1].x = 70;
    session.elements[1].y = 70;

    handleUndo(session, { userId: 'userA' }, {});

    // We expect that the element is moved back to the 'from' position
    expect(session.elements[1].x).toBe(50);
    expect(session.elements[1].y).toBe(50);

    // Undo stack => now empty
    expect(session.undoStack.length).toBe(0);

    // Redo stack => has the undone action
    expect(session.redoStack.length).toBe(1);

    // We also expect the "ELEMENT_STATE" broadcast
    expect(mockSend).toHaveBeenCalled();
    const lastCall = mockSend.mock.calls[mockSend.mock.calls.length - 1];
    const msgParsed = JSON.parse(lastCall[0]);
    expect(msgParsed.type).toBe(MESSAGE_TYPES.ELEMENT_STATE);
  });

  test('handleUndo sends UNDO_REDO_FAILED if locked by another user', () => {
    // Make the shape locked by someone else
    session.elements[0].lockedBy = 'someone_else';
    session.undoStack = [
      {
        type: 'move',
        diffs: [
          { elementId: 10, from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }
        ]
      }
    ];

    handleUndo(session, { userId: 'userA' }, { send: mockSend });

    // We expect a message to userA with type=UNDO_REDO_FAILED
    expect(mockSend).toHaveBeenCalled();
    const [sentJSON] = mockSend.mock.calls[0];
    const data = JSON.parse(sentJSON);
    expect(data.type).toBe(MESSAGE_TYPES.UNDO_REDO_FAILED);
    expect(data.reason).toMatch(/Element locked by another user/);
  });

  test('handleRedo does nothing if redoStack is empty', () => {
    handleRedo(session, { userId: 'userA' }, {});
    expect(session.redoStack.length).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('handleRedo re-applies the last undone action', () => {
    // Suppose we have an undone move action in the redo stack
    session.redoStack.push({
      type: 'move',
      diffs: [
        {
          elementId: 10,
          from: { x: 0, y: 0 },
          to: { x: 100, y: 100 },
        }
      ],
    });
    // The element is currently at x=0,y=0

    handleRedo(session, { userId: 'userA' }, {});

    // We expect the element is now at x=100,y=100
    expect(session.elements[0].x).toBe(100);
    expect(session.elements[0].y).toBe(100);

    // Undo stack now has the re-applied action
    expect(session.undoStack.length).toBe(1);
    expect(session.redoStack.length).toBe(0);

    // And we broadcast the new element state
    expect(mockSend).toHaveBeenCalled();
    const lastCall = mockSend.mock.calls[mockSend.mock.calls.length - 1];
    const msgParsed = JSON.parse(lastCall[0]);
    expect(msgParsed.type).toBe(MESSAGE_TYPES.ELEMENT_STATE);
  });

  test('handleRedo also fails if an element is locked by another user', () => {
    session.elements[0].lockedBy = 'someone_else';
    session.redoStack.push({
      type: 'move',
      diffs: [
        { elementId: 10, from: { x: 0, y: 0 }, to: { x: 50, y: 60 } }
      ]
    });

    handleRedo(session, { userId: 'userA' }, { send: mockSend });

    expect(mockSend).toHaveBeenCalled();
    const data = JSON.parse(mockSend.mock.calls[0][0]);
    expect(data.type).toBe(MESSAGE_TYPES.UNDO_REDO_FAILED);
  });
});

describe('undoRedoHandlers - Extra Coverage (Merged from undoRedoExtra.test.js)', () => {
  function makeSession(elements = []) {
    return {
      users: new Map(),
      elements,
      undoStack: [],
      redoStack: [],
      pendingMoves: new Map(),
      pendingResizes: new Map(),
    };
  }

  let session;
  let mockWsSend;

  beforeEach(() => {
    mockWsSend = jest.fn();
    session = makeSession();
    session.users.set('testUser', {
      userId: 'testUser',
      socket: { send: mockWsSend, readyState: 1 },
    });
  });

  test('pushUndoAction with no diffs, then handleUndo => no changes, but coverage for default cases', () => {
    const action = { type: 'unknown', diffs: null };
    pushUndoAction(session, action);

    handleUndo(session, { userId: 'testUser' }, { send: mockWsSend });
    // The revert sees unknown type => does nothing, but we do broadcast
    const sentJSON = mockWsSend.mock.calls.map((call) => JSON.parse(call[0]));
    const hasElemState = sentJSON.some((msg) => msg.type === MESSAGE_TYPES.ELEMENT_STATE);
    expect(hasElemState).toBe(true);
  });

  test('handleRedo with unknown action type does nothing but still broadcasts', () => {
    session.redoStack.push({ type: 'some-strange-action', diffs: [] });

    handleRedo(session, { userId: 'testUser' }, { send: mockWsSend });

    const sentJSON = mockWsSend.mock.calls.map((call) => JSON.parse(call[0]));
    const hasElemState = sentJSON.some((msg) => msg.type === MESSAGE_TYPES.ELEMENT_STATE);
    expect(hasElemState).toBe(true);
  });

  test('handleUndo => shape locked by unknown user => returns UNDO_REDO_FAILED', () => {
    session.elements.push({ id: 1, x: 0, y: 0, lockedBy: 'otherUser' });
    session.undoStack.push({
      type: 'move',
      diffs: [
        {
          elementId: 1,
          from: { x: 0, y: 0 },
          to: { x: 50, y: 60 },
        },
      ],
    });

    handleUndo(session, { userId: 'testUser' }, { send: mockWsSend });

    const [sentStr] = mockWsSend.mock.calls[0];
    const msg = JSON.parse(sentStr);
    expect(msg.type).toBe(MESSAGE_TYPES.UNDO_REDO_FAILED);
    expect(msg.reason).toMatch(/Element locked by another user/);
  });
});
