// tests/unit/SessionService.test.js

import { SessionService } from '../../server/services/SessionService.js';

describe('SessionService', () => {
  beforeEach(() => {
    // Clear all sessions between tests
    for (const [code] of Array.from(SessionService['sessionMap'] || [])) {
      SessionService.removeSession(code);
    }
  });

  test('getOrCreateSession creates a new session if none exists', () => {
    const code = 'test-session-123';
    let s = SessionService.getSession(code);
    expect(s).toBeNull();

    const created = SessionService.getOrCreateSession(code);
    expect(created).toBeDefined();
    expect(created.code).toBe(code);

    s = SessionService.getSession(code);
    expect(s).toBe(created);
  });

  test('removeSession deletes the stored session', () => {
    const code = 'test-session-456';
    SessionService.getOrCreateSession(code);
    expect(SessionService.getSession(code)).not.toBeNull();

    SessionService.removeSession(code);
    expect(SessionService.getSession(code)).toBeNull();
  });

  test('joinSession adds a user to a session, sets isAdmin if specified, sets first user as owner', () => {
    const code = 'join-test';
    const session = SessionService.getOrCreateSession(code);
    expect(session.users.size).toBe(0);

    // user_1 => admin
    SessionService.joinSession(session, 'user_1', 'Alice', 'admin', null);
    expect(session.users.size).toBe(1);

    const user1 = session.users.get('user_1');
    expect(user1).toBeDefined();
    expect(user1.name).toBe('Alice');
    expect(user1.isAdmin).toBe(true);
    expect(user1.isOwner).toBe(true); // first user joined => owner
  });

  test('removeUser frees locks and reassigns owner if needed', () => {
    const code = 'owner-test';
    const s = SessionService.getOrCreateSession(code);
    // user_1 => first join => automatically isOwner
    const u1 = SessionService.joinSession(s, 'user_1', 'Owner1', '', null);
    expect(u1.isOwner).toBe(true);

    // user_2 => normal user
    const u2 = SessionService.joinSession(s, 'user_2', 'User2', '', null);
    expect(u2.isOwner).toBe(false);

    // Lock an element
    s.elements.push({ id: 10, x:0, y:0, w:50, h:50, lockedBy: 'user_2' });

    // remove user_2 => should free lock
    SessionService.removeUser(s, 'user_2');
    expect(s.users.size).toBe(1);
    expect(s.elements[s.elements.length - 1].lockedBy).toBe(null);

    // remove user_1 => empty session => no owners
    SessionService.removeUser(s, 'user_1');
    expect(s.users.size).toBe(0);
  });

  test('upgradeUserId merges old user fields, locks, isAdmin/isEditor status, etc.', () => {
    const code = 'upgrade-test';
    const s = SessionService.getOrCreateSession(code);

    // Suppose we have an "anon_999" user who isEditor
    const anon = SessionService.joinSession(s, 'anon_999', 'AnonUser', '', null);
    anon.isEditor = true;

    // Lock an element
    s.elements.push({ id: 20, x:10, y:10, w:30, h:30, lockedBy: 'anon_999' });

    // Now upgrade => newUserId "user_5", newIsAdmin = true
    const upgraded = SessionService.upgradeUserId(
      s,
      'anon_999',
      'user_5',
      'Bob',
      true,
      null
    );
    expect(upgraded).toBeDefined();
    expect(upgraded.userId).toBe('user_5');
    expect(upgraded.name).toBe('Bob');
    expect(upgraded.isAdmin).toBe(true);
    // preserve old isEditor
    expect(upgraded.isEditor).toBe(true);

    // The locked element should now have lockedBy 'user_5'
    const lastEl = s.elements[s.elements.length - 1];
    expect(lastEl.lockedBy).toBe('user_5');
  });

  test('downgradeUserId => user_5 => anon_123 => removes admin/editor/owner', () => {
    const s = SessionService.getOrCreateSession('downgrade-test');
    const u5 = SessionService.joinSession(s, 'user_5', 'Alice', 'admin', null);
    expect(u5.isAdmin).toBe(true);

    // Also mark her editor, or owner
    u5.isEditor = true;
    u5.isOwner = true;

    // push a new element locked by user_5
    s.elements.push({ id: 30, lockedBy: 'user_5' });

    const downgraded = SessionService.downgradeUserId(
      s,
      'user_5',
      'anon_111',
      null
    );
    expect(downgraded.userId).toBe('anon_111');
    expect(downgraded.isAdmin).toBe(false);
    expect(downgraded.isOwner).toBe(false);
    expect(downgraded.isEditor).toBe(false);

    // The locked element should now be locked by 'anon_111'
    const lastEl = s.elements[s.elements.length - 1];
    expect(lastEl.lockedBy).toBe('anon_111');
  });

  test('setEditorRole toggles isEditor for a user', () => {
    const s = SessionService.getOrCreateSession('editor-test');
    const u1 = SessionService.joinSession(s, 'user_10', 'TestUser', '', null);
    expect(u1.isEditor).toBe(false);

    const success = SessionService.setEditorRole(s, 'user_10', true);
    expect(success).toBe(true);

    const check = s.users.get('user_10');
    expect(check.isEditor).toBe(true);

    // Remove editor
    SessionService.setEditorRole(s, 'user_10', false);
    expect(s.users.get('user_10').isEditor).toBe(false);
  });
});
