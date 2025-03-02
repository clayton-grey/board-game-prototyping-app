// tests/unit/undoRedoExtra.test.js
import { handleUndo, handleRedo, pushUndoAction } from '../../server/ws/handlers/undoRedoHandlers.js';
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

function makeSession(elements = []) {
  return {
    users: new Map(),
    elements: elements,
    undoStack: [],
    redoStack: [],
    pendingMoves: new Map(),
    pendingResizes: new Map(),
  };
}

describe('undoRedoHandlers - extra coverage', () => {
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
    // This might represent a weird user action that didn't store diffs properly
    const action = { type: 'unknown', diffs: null };
    pushUndoAction(session, action);

    handleUndo(session, { userId: 'testUser' }, { send: mockWsSend });
    // We expect no broadcast or changes, but let's check we get an ELEMENT_STATE broadcast or not:
    // Actually, handleUndo won't apply if diffs are not an array => canApplyAction returns true,
    // then revertAction sees unknown type => does nothing, but we do broadcast.
    const sentJSON = mockWsSend.mock.calls.map((call) => JSON.parse(call[0]));
    const hasElemState = sentJSON.some((msg) => msg.type === MESSAGE_TYPES.ELEMENT_STATE);
    expect(hasElemState).toBe(true); // Because we do broadcast after revert
  });

  test('handleRedo with unknown action type does nothing but still broadcasts', () => {
    session.redoStack.push({ type: 'some-strange-action', diffs: [] });

    handleRedo(session, { userId: 'testUser' }, { send: mockWsSend });

    const sentJSON = mockWsSend.mock.calls.map((call) => JSON.parse(call[0]));
    const hasElemState = sentJSON.some((msg) => msg.type === MESSAGE_TYPES.ELEMENT_STATE);
    expect(hasElemState).toBe(true);
  });

  test('handleUndo => shape locked by unknown user => returns UNDO_REDO_FAILED', () => {
    // If the shape is locked by someone else => concurrency
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

    // We expect an UNDO_REDO_FAILED message to be sent
    const [sentStr] = mockWsSend.mock.calls[0];
    const msg = JSON.parse(sentStr);
    expect(msg.type).toBe(MESSAGE_TYPES.UNDO_REDO_FAILED);
    expect(msg.reason).toMatch(/Element locked by another user/);
  });
});
