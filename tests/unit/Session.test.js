// tests/unit/Session.test.js
import { Session } from '../../server/services/Session.js';

describe('Session class', () => {
  let session;

  beforeEach(() => {
    session = new Session('test-code');
  });

  test('constructor sets initial fields', () => {
    expect(session.code).toBe('test-code');
    expect(session.projectName).toBe('New Project');
    expect(session.users.size).toBe(0);
    expect(session.elements.length).toBe(2); // the default elements
    expect(session.undoStack.length).toBe(0);
    expect(session.redoStack.length).toBe(0);
  });

  test('addUser => first user becomes owner', () => {
    const userObj = session.addUser('u1', 'Alice', false);
    expect(session.users.size).toBe(1);
    expect(userObj.userId).toBe('u1');
    expect(userObj.isOwner).toBe(true);
  });

  test('addUser => second user is normal by default', () => {
    session.addUser('u1', 'Owner');
    const user2 = session.addUser('u2', 'Bob');
    expect(user2.isOwner).toBe(false);
    expect(user2.isAdmin).toBe(false);
  });

  test('addUser => can set isAdmin', () => {
    const user3 = session.addUser('admin_1', 'AdminUser', true);
    expect(user3.isAdmin).toBe(true);
  });

  test('removeUser => frees locks, reassigns owner if needed', () => {
    const owner = session.addUser('owner1', 'Owner1');
    const user2 = session.addUser('user2', 'Regular');
    // lock something to user2
    session.elements.push({ id: 99, lockedBy: 'user2' });

    // remove user2 => free lock
    session.removeUser('user2');
    const lockedEl = session.elements.find(el => el.id === 99);
    expect(lockedEl.lockedBy).toBe(null);
    expect(session.users.size).toBe(1);

    // remove owner => no owners => 0 users
    session.removeUser('owner1');
    expect(session.users.size).toBe(0);
  });

  test('kickUser => must be owner/admin, cannot kick owners/admins', () => {
    const uOwner = session.addUser('owner1', 'Owner', false);
    uOwner.isOwner = true;
    const normal = session.addUser('u2', 'User2', false);

    // Attempt to kick user2
    const kicked = session.kickUser('owner1', 'u2');
    expect(kicked.userId).toBe('u2');
    expect(session.users.has('u2')).toBe(false);

    // user2 is gone now
    // re-add user2 as an admin
    const user2Admin = session.addUser('u2', 'User2 again', true);

    // Attempt to have owner1 kick admin => fails
    const failKick = session.kickUser('owner1', 'u2');
    expect(failKick).toBeNull();
    expect(session.users.has('u2')).toBe(true);
  });

  test('upgradeUserId => merges old locks, preserves or sets new admin', () => {
    const anon = session.addUser('anon_1', 'Anon', false);
    anon.isEditor = true;

    session.elements.push({ id: 101, lockedBy: 'anon_1' });

    // upgrade => user_99
    const upgraded = session.upgradeUserId('anon_1', 'user_99', 'RealName', true);
    expect(upgraded.userId).toBe('user_99');
    expect(upgraded.isAdmin).toBe(true);
    expect(upgraded.isEditor).toBe(true);

    const lockedEl = session.elements.find(el => el.id === 101);
    expect(lockedEl.lockedBy).toBe('user_99');
  });

  test('downgradeUserId => user => anon, remove isOwner/isAdmin/isEditor', () => {
    const user = session.addUser('u111', 'TestUser', true); // admin
    user.isOwner = true;
    user.isEditor = true;

    session.elements.push({ id: 200, lockedBy: 'u111' });

    const downgraded = session.downgradeUserId('u111', 'anon_99');
    expect(downgraded.userId).toBe('anon_99');
    expect(downgraded.isAdmin).toBe(false);
    expect(downgraded.isOwner).toBe(false);
    expect(downgraded.isEditor).toBe(false);

    const lockedEl = session.elements.find(el => el.id === 200);
    expect(lockedEl.lockedBy).toBe('anon_99');
  });

  test('setEditorRole => toggles isEditor on a user', () => {
    const user = session.addUser('uX', 'UserX');
    session.setEditorRole('uX', true);
    expect(session.users.get('uX').isEditor).toBe(true);
    session.setEditorRole('uX', false);
    expect(session.users.get('uX').isEditor).toBe(false);
  });
});
