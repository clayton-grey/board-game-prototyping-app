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
    expect(session.users.size).toBe(0);

    const userA = session.addUser('uA', 'UserA');
    expect(userA.sessionRole).toBe('owner');
    expect(session.users.size).toBe(1);

    session.removeUser('uA');
    expect(session.users.size).toBe(0);

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
    expect(user2.sessionRole).toBe('viewer');
    expect(session.users.size).toBe(2);
  });

  test('addUser => can set admin if isAdminFlag = true', () => {
    const adminUser = session.addUser('admin_1', 'AdminUser', true);
    expect(adminUser.globalRole).toBe('admin');
  });

  test('addUser => re-joining a user updates name/socket if provided', () => {
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
    owner.isOwner = true; // for test scenario

    const normal = session.addUser('u2', 'User2');
    const kicked = session.kickUser('owner1', 'u2');
    expect(kicked.userId).toBe('u2');
    expect(session.users.has('u2')).toBe(false);

    const user2Again = session.addUser('u2', 'User2Again', true);
    const failKick = session.kickUser('owner1', 'u2'); // can't kick admin
    expect(failKick).toBeNull();
    expect(session.users.has('u2')).toBe(true);

    const adminKickOwner = session.kickUser('u2', 'owner1');
    expect(adminKickOwner).toBeNull();
  });

  test('upgradeUserId => merges old locks, sets new ID, merges admin if requested', () => {
    session.addUser('anon_1', 'Anon');
    session.elements.push({ id: 101, lockedBy: 'anon_1' });

    const upgraded = session.upgradeUserId('anon_1', 'real_99', 'RealName', true);
    expect(upgraded.userId).toBe('real_99');
    expect(upgraded.name).toBe('RealName');
    expect(upgraded.globalRole).toBe('admin');

    const el = session.elements.find(e => e.id === 101);
    expect(el.lockedBy).toBe('real_99');
  });

  test('upgradeUserId => preserves sessionRole=owner if old user was owner', () => {
    const anonOwner = session.addUser('anon_owner', 'Ephemeral Owner');
    expect(anonOwner.sessionRole).toBe('owner');

    const realUser = session.upgradeUserId('anon_owner', 'user_10', 'RealUser', false);
    expect(realUser.sessionRole).toBe('owner');
  });

  test('upgradeUserId => handles non-existent oldUserId by creating placeholder', () => {
    const out = session.upgradeUserId('fakeId', 'newId', 'NewName', false, null);
    expect(out.userId).toBe('newId');
    expect(out.name).toBe('NewName');
    expect(session.users.has('fakeId')).toBe(false);
    expect(session.users.has('newId')).toBe(true);
  });

  test('downgradeUserId => merges locks, sets new ID as viewer, clears admin/owner/editor', () => {
    const user = session.addUser('u111', 'TestUser', true); // => globalRole='admin'
    user.sessionRole = 'owner';

    session.elements.push({ id: 200, lockedBy: 'u111' });

    const downgraded = session.downgradeUserId('u111', 'anon_99');
    expect(downgraded.userId).toBe('anon_99');
    expect(downgraded.globalRole).toBe('user');
    expect(downgraded.sessionRole).toBe('viewer');

    const el = session.elements.find(e => e.id === 200);
    expect(el.lockedBy).toBe('anon_99');
  });

  test('downgradeUserId => handles non-existent oldUserId by creating placeholder, then downgrading', () => {
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

  // -------------------- NEW TESTS FOR PENDING MOVES/RESIZES --------------------

  test('upgradeUserId => transfers pendingMoves and pendingResizes from old to new userId', () => {
    // Setup a partial move
    session.pendingMoves.set(10, {
      userId: 'anon_123',
      oldX: 50,
      oldY: 60
    });
    // Setup partial resize
    const resizeMap = new Map();
    resizeMap.set(20, { x: 100, y: 200, w: 40, h: 40 });
    session.pendingResizes.set('anon_123', resizeMap);

    // Now upgrade
    session.upgradeUserId('anon_123', 'realUser_1', 'RealName', false, null);

    // The old key "anon_123" in pendingResizes should be gone
    expect(session.pendingResizes.has('anon_123')).toBe(false);

    // The new user has the same sub-map
    expect(session.pendingResizes.has('realUser_1')).toBe(true);
    const newMap = session.pendingResizes.get('realUser_1');
    expect(newMap.get(20)).toEqual({ x: 100, y: 200, w: 40, h: 40 });

    // The pendingMoves entry changed userId
    expect(session.pendingMoves.get(10)).toEqual({
      userId: 'realUser_1',
      oldX: 50,
      oldY: 60
    });
  });

  test('downgradeUserId => merges pendingMoves and pendingResizes similarly', () => {
    // Suppose we have partial moves/resizes under "u222"
    session.pendingMoves.set(7, {
      userId: 'u222',
      oldX: 0,
      oldY: 0
    });
    const rMap = new Map();
    rMap.set(99, { x: 10, y: 20, w: 30, h: 40 });
    session.pendingResizes.set('u222', rMap);

    // Downgrade
    session.downgradeUserId('u222', 'anon_444');

    // old keys removed
    expect(session.pendingMoves.get(7).userId).toBe('anon_444');
    expect(session.pendingResizes.has('u222')).toBe(false);

    // new keys found
    const newMap = session.pendingResizes.get('anon_444');
    expect(newMap.size).toBe(1);
    expect(newMap.get(99)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });
});
