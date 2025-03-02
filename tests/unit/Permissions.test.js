// tests/unit/Permissions.test.js

import {
  isAdmin,
  isOwner,
  isEditor,
  isViewer,
  canManageOthers,
  canKickUser,
  canRenameProject,
  canEditProject,
} from '../../server/utils/Permissions.js';

describe('Permissions utility functions', () => {
  const adminUser = {
    userId: 'admin1',
    globalRole: 'admin',
    sessionRole: 'viewer', // even if sessionRole=viewer, globalRole=admin overrides in many checks
  };
  const ownerUser = {
    userId: 'owner1',
    globalRole: 'user',
    sessionRole: 'owner',
  };
  const editorUser = {
    userId: 'editor1',
    globalRole: 'user',
    sessionRole: 'editor',
  };
  const viewerUser = {
    userId: 'viewer1',
    globalRole: 'user',
    sessionRole: 'viewer',
  };

  describe('isAdmin', () => {
    test('admin user => true', () => {
      expect(isAdmin(adminUser)).toBe(true);
    });
    test('non-admin => false', () => {
      expect(isAdmin(ownerUser)).toBe(false);
      expect(isAdmin(editorUser)).toBe(false);
      expect(isAdmin(viewerUser)).toBe(false);
    });
  });

  describe('isOwner', () => {
    test('sessionRole="owner" => true', () => {
      expect(isOwner(ownerUser)).toBe(true);
    });
    test('others => false', () => {
      expect(isOwner(adminUser)).toBe(false);
      expect(isOwner(editorUser)).toBe(false);
      expect(isOwner(viewerUser)).toBe(false);
    });
  });

  describe('isEditor', () => {
    test('sessionRole="editor" => true', () => {
      expect(isEditor(editorUser)).toBe(true);
    });
    test('sessionRole="owner" => true', () => {
      expect(isEditor(ownerUser)).toBe(true);
    });
    test('admin globalRole with viewer session => isEditor= false (strictly speaking, code says only "owner" or "editor")', () => {
      // If you want admins to auto be "editor", you can adjust. Currently, the code is: isEditor = sessionRole==='editor'||'owner'
      // So an admin with sessionRole='viewer' is not recognized as 'editor'. This might be fine or might be a design choice.
      expect(isEditor(adminUser)).toBe(false);
    });
    test('sessionRole="viewer" => false', () => {
      expect(isEditor(viewerUser)).toBe(false);
    });
  });

  describe('isViewer', () => {
    test('sessionRole="viewer" => true', () => {
      expect(isViewer(viewerUser)).toBe(true);
      expect(isViewer(adminUser)).toBe(true); // Because adminUser.sessionRole='viewer'
    });
    test('others => false', () => {
      expect(isViewer(ownerUser)).toBe(false);
      expect(isViewer(editorUser)).toBe(false);
    });
  });

  describe('canManageOthers', () => {
    test('admin => true', () => {
      expect(canManageOthers(adminUser)).toBe(true);
    });
    test('owner => true', () => {
      expect(canManageOthers(ownerUser)).toBe(true);
    });
    test('editor => false', () => {
      expect(canManageOthers(editorUser)).toBe(false);
    });
    test('viewer => false', () => {
      expect(canManageOthers(viewerUser)).toBe(false);
    });
  });

  describe('canKickUser', () => {
    test('admin can kick viewer or editor or user - as long as target is not admin or owner', () => {
      // admin user => canKickUser(adminUser, viewerUser) => true
      expect(canKickUser(adminUser, viewerUser)).toBe(true);
      expect(canKickUser(adminUser, editorUser)).toBe(true);
      // cannot kick another admin
      const admin2 = { ...adminUser, userId: 'admin2' };
      expect(canKickUser(adminUser, admin2)).toBe(false);
      // cannot kick an owner
      expect(canKickUser(adminUser, ownerUser)).toBe(false);
    });
    test('owner can kick viewer, editor, but not admin or other owner', () => {
      // owner => canKickUser(ownerUser, viewerUser)=true
      expect(canKickUser(ownerUser, viewerUser)).toBe(true);
      expect(canKickUser(ownerUser, editorUser)).toBe(true);
      // cannot kick admin
      expect(canKickUser(ownerUser, adminUser)).toBe(false);
      // cannot kick another "owner" if that existed
    });
    test('editor or viewer => false always', () => {
      expect(canKickUser(editorUser, viewerUser)).toBe(false);
      expect(canKickUser(viewerUser, editorUser)).toBe(false);
      expect(canKickUser(editorUser, ownerUser)).toBe(false);
      expect(canKickUser(viewerUser, adminUser)).toBe(false);
    });
  });

  describe('canRenameProject (== canManageOthers)', () => {
    test('admin => true', () => {
      expect(canRenameProject(adminUser)).toBe(true);
    });
    test('owner => true', () => {
      expect(canRenameProject(ownerUser)).toBe(true);
    });
    test('editor => false', () => {
      expect(canRenameProject(editorUser)).toBe(false);
    });
  });

  describe('canEditProject', () => {
    test('admin => true', () => {
      expect(canEditProject(adminUser)).toBe(true);
    });
    test('owner => true', () => {
      expect(canEditProject(ownerUser)).toBe(true);
    });
    test('editor => true', () => {
      expect(canEditProject(editorUser)).toBe(true);
    });
    test('viewer => false', () => {
      expect(canEditProject(viewerUser)).toBe(false);
    });
  });
});
