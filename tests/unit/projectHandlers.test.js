// tests/unit/projectHandlers.test.js

import { handleProjectNameChange } from '../../server/ws/handlers/projectHandlers.js';
import { broadcastToSession, broadcastElementState } from '../../server/ws/collabUtils.js';
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

jest.mock('../../server/ws/collabUtils.js', () => ({
  broadcastToSession: jest.fn(),
  broadcastElementState: jest.fn()
}));

describe('projectHandlers', () => {
  let mockSession, mockWs;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWs = { send: jest.fn() };
    mockSession = {
      code: 'proj-test',
      projectName: 'Old Name',
      users: new Map([
        ['owner1', { userId: 'owner1', isOwner: true, isAdmin: false }],
        ['admin1', { userId: 'admin1', isOwner: false, isAdmin: true }],
        ['user2', { userId: 'user2', isOwner: false, isAdmin: false }],
      ]),
      elements: []
    };
  });

  test('handleProjectNameChange => sets session.projectName, broadcasts if user isOwner', () => {
    const data = { userId: 'owner1', newName: 'NewProjectName' };
    handleProjectNameChange(mockSession, data, mockWs);

    expect(mockSession.projectName).toBe('NewProjectName');
    expect(broadcastToSession).toHaveBeenCalledWith(mockSession, {
      type: MESSAGE_TYPES.PROJECT_NAME_CHANGE,
      newName: 'NewProjectName'
    });
    expect(broadcastElementState).toHaveBeenCalledWith(mockSession);
  });

  test('handleProjectNameChange => sets session.projectName, broadcasts if user isAdmin', () => {
    const data = { userId: 'admin1', newName: 'AdminRenamedIt' };
    handleProjectNameChange(mockSession, data, mockWs);

    expect(mockSession.projectName).toBe('AdminRenamedIt');
    expect(broadcastToSession).toHaveBeenCalled();
    expect(broadcastElementState).toHaveBeenCalled();
  });

  test('handleProjectNameChange => does nothing if user is normal user', () => {
    const data = { userId: 'user2', newName: 'Nope' };
    handleProjectNameChange(mockSession, data, mockWs);
    expect(mockSession.projectName).toBe('Old Name');
    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(broadcastElementState).not.toHaveBeenCalled();
  });

  test('handleProjectNameChange => does nothing if no newName or userId', () => {
    handleProjectNameChange(mockSession, {}, mockWs);
    expect(mockSession.projectName).toBe('Old Name');
    expect(broadcastToSession).not.toHaveBeenCalled();
  });

  test('handleProjectNameChange => does nothing if session is null', () => {
    handleProjectNameChange(null, { userId: 'owner1', newName: 'X' }, mockWs);
    expect(broadcastToSession).not.toHaveBeenCalled();
  });
});
