// tests/unit/Session.test.js
import { Session } from '../../server/services/Session.js';

describe('Session class', () => {
  let session;

  beforeEach(() => {
    session = new Session('test-code');
  });

  test('empty session => first user is owner by default', () => {
    expect(session.users.size).toBe(0); 
    const user = session.addUser('uFirst', 'First');
    expect(user.sessionRole).toBe('owner'); 
    expect(session.users.size).toBe(1);
  });

  test('first user in an empty session becomes owner, even if re-joining an ID that was never fully set', () => {
    // Suppose the session is brand new => size=0, no owners
    expect(session.users.size).toBe(0);

    // We "add" user with ID 'uA'
    const userA = session.addUser('uA', 'UserA');
    // Because the session was empty, userA becomes owner
    expect(userA.sessionRole).toBe('owner');
    expect(session.users.size).toBe(1);

    // Suppose we remove them => no owners left
    session.removeUser('uA');
    expect(session.users.size).toBe(0);

    // Another user joins => should become owner
    const userB = session.addUser('uB', 'UserB');
    expect(userB.sessionRole).toBe('owner');
  });

  test('constructor sets initial fields', () => {
    expect(session.code).toBe('test-code');
    expect(session.projectName).toBe('New Project');
    expect(session.users.size).toBe(0);
    expect(session.elements.length).toBe(2); 
    expect(session.undoStack.length).toBe(0);
    expect(session.redoStack.length).toBe(0);
  });

  test('addUser => first user becomes owner, subsequent do not', () => {
    const user1 = session.addUser('u1', 'Alice');
    expect(user1.sessionRole).toBe('owner');
    const user2 = session.addUser('u2', 'Bob');
    expect(user2.sessionRole).toBe('viewer'); // by default
    expect(session.users.size).toBe(2);
  });

  test('addUser => can set admin if isAdminFlag = true', () => {
    const adminUser = session.addUser('admin_1', 'AdminUser', true);
    expect(adminUser.globalRole).toBe('admin');
  });


  test('addUser => re-joining a user updates socket or name if provided', () => {
    const initial = session.addUser('user1', 'FirstName');
    expect(initial.name).toBe('FirstName');
    expect(session.users.size).toBe(1);

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
    session.addUser('anon_1', 'Anon');
    session.elements.push({ id: 101, lockedBy: 'anon_1' });

    const upgraded = session.upgradeUserId('anon_1', 'real_99', 'RealName', true);
    expect(upgraded.userId).toBe('real_99');
    expect(upgraded.name).toBe('RealName');
    // was newIsAdmin = true => globalRole='admin'
    expect(upgraded.globalRole).toBe('admin');

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
    // Setup
    const user = session.addUser('u111', 'TestUser', true); // => globalRole='admin'
    user.sessionRole = 'owner'; // Mark them as owner

    session.elements.push({ id: 200, lockedBy: 'u111' });

    // Action
    const downgraded = session.downgradeUserId('u111', 'anon_99');

    // Checks:
    // user => 'anon_99', globalRole='user', sessionRole='viewer'
    expect(downgraded.userId).toBe('anon_99');
    expect(downgraded.globalRole).toBe('user');
    expect(downgraded.sessionRole).toBe('viewer'); // The test expects 'viewer', not 'owner'

    // The shape lock merges
    const el = session.elements.find(e => e.id === 200);
    expect(el.lockedBy).toBe('anon_99');
  });

  test('downgradeUserId => handles non-existent oldUserId by creating placeholder, then downgrading it', () => {
    const out = session.downgradeUserId('missing_123', 'anon_77');
    expect(out.userId).toBe('anon_77');
    expect(out.globalRole).toBe('user');
    expect(out.sessionRole).toBe('viewer');
    expect(session.users.has('missing_123')).toBe(false);
    expect(session.users.has('anon_77')).toBe(true);
  });

  test('setEditorRole => toggles user.sessionRole between editor/viewer', () => {
    const user = session.addUser('uX', 'UserX');
    session.setEditorRole('uX', true);
    expect(session.users.get('uX').sessionRole).toBe('editor');
    session.setEditorRole('uX', false);
    expect(session.users.get('uX').sessionRole).toBe('viewer');
  });

  test('clearUndoRedo => empties undoStack and redoStack', () => {
    session.undoStack.push({ action: 'test1' });
    session.redoStack.push({ action: 'test2' });
    session.clearUndoRedo();
    expect(session.undoStack.length).toBe(0);
    expect(session.redoStack.length).toBe(0);
  });
});
