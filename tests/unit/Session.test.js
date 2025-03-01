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

  test('addUser => first user becomes owner, subsequent do not', () => {
    const user1 = session.addUser('u1', 'Alice');
    expect(user1.isOwner).toBe(true);
    const user2 = session.addUser('u2', 'Bob');
    expect(user2.isOwner).toBe(false);
    expect(session.users.size).toBe(2);
  });

  test('addUser => can set isAdmin = true', () => {
    const adminUser = session.addUser('admin_1', 'AdminUser', true);
    expect(adminUser.isAdmin).toBe(true);
  });

  test('addUser => re-joining a user updates socket or name if provided', () => {
    const initial = session.addUser('user1', 'FirstName');
    expect(initial.name).toBe('FirstName');
    expect(session.users.size).toBe(1);

    // Re-join with a new name
    const rejoined = session.addUser('user1', 'NewName');
    expect(rejoined.userId).toBe('user1');
    expect(rejoined.name).toBe('NewName');
    expect(session.users.size).toBe(1);
  });

  test('removeUser => frees locks, reassigns owner if needed', () => {
    const owner = session.addUser('owner1', 'Owner1');
    const user2 = session.addUser('user2', 'Regular');
    // lock something to user2
    session.elements.push({ id: 99, lockedBy: 'user2' });

    session.removeUser('user2');
    const lockedEl = session.elements.find(el => el.id === 99);
    expect(lockedEl.lockedBy).toBe(null);
    expect(session.users.size).toBe(1);

    // remove the owner => now 0 users, no owners
    session.removeUser('owner1');
    expect(session.users.size).toBe(0);
  });

  test('kickUser => must be owner/admin, cannot kick owners/admins, returns kicked user or null', () => {
    const owner = session.addUser('owner1', 'OwnerUser');
    owner.isOwner = true; // first user isOwner

    const normal = session.addUser('u2', 'User2');
    // Attempt to kick user2 with an owner => success
    const kicked = session.kickUser('owner1', 'u2');
    expect(kicked.userId).toBe('u2');
    expect(session.users.has('u2')).toBe(false);

    // re-add user2 as an admin
    const user2Again = session.addUser('u2', 'User2Again', true);

    // Attempt to have owner1 kick admin => fails
    const failKick = session.kickUser('owner1', 'u2');
    expect(failKick).toBeNull();
    expect(session.users.has('u2')).toBe(true);

    // an admin tries to kick the owner => also fails
    const adminKickOwner = session.kickUser('u2', 'owner1');
    expect(adminKickOwner).toBeNull();
  });

  test('upgradeUserId => merges old locks, sets new ID, merges admin if requested', () => {
    session.addUser('anon_1', 'Anon', false);
    // lock an element
    session.elements.push({ id: 101, lockedBy: 'anon_1' });

    const upgraded = session.upgradeUserId('anon_1', 'real_99', 'RealName', true);
    expect(upgraded.userId).toBe('real_99');
    expect(upgraded.name).toBe('RealName');
    expect(upgraded.isAdmin).toBe(true);

    const el = session.elements.find(e => e.id === 101);
    expect(el.lockedBy).toBe('real_99');
  });

  test('upgradeUserId => handles non-existent oldUserId by creating placeholder', () => {
    // we never added 'fakeId' to the session, so it's "non-existent"
    const out = session.upgradeUserId('fakeId', 'newId', 'NewName', false, null);
    expect(out.userId).toBe('newId');
    expect(out.name).toBe('NewName');
    expect(session.users.has('fakeId')).toBe(false);
    expect(session.users.has('newId')).toBe(true);
  });

  test('downgradeUserId => merges locks, sets new ID as anonymous, clears admin/owner/editor', () => {
    const user = session.addUser('u111', 'TestUser', true); // admin
    user.isOwner = true;
    user.isEditor = true;

    session.elements.push({ id: 200, lockedBy: 'u111' });
    const downgraded = session.downgradeUserId('u111', 'anon_99');
    expect(downgraded.userId).toBe('anon_99');
    expect(downgraded.isAdmin).toBe(false);
    expect(downgraded.isOwner).toBe(false);
    expect(downgraded.isEditor).toBe(false);

    const el = session.elements.find(e => e.id === 200);
    expect(el.lockedBy).toBe('anon_99');
  });

  test('downgradeUserId => handles non-existent oldUserId by creating placeholder, then downgrading it', () => {
    const out = session.downgradeUserId('missing_123', 'anon_77');
    expect(out.userId).toBe('anon_77');
    expect(out.isAdmin).toBe(false);
    expect(out.isOwner).toBe(false);
    expect(session.users.has('missing_123')).toBe(false);
    expect(session.users.has('anon_77')).toBe(true);
  });

  test('setEditorRole => toggles user.isEditor', () => {
    const user = session.addUser('uX', 'UserX');
    session.setEditorRole('uX', true);
    expect(session.users.get('uX').isEditor).toBe(true);
    session.setEditorRole('uX', false);
    expect(session.users.get('uX').isEditor).toBe(false);
  });

  test('clearUndoRedo => empties undoStack and redoStack', () => {
    session.undoStack.push({ action: 'test1' });
    session.redoStack.push({ action: 'test2' });
    session.clearUndoRedo();
    expect(session.undoStack.length).toBe(0);
    expect(session.redoStack.length).toBe(0);
  });
});
