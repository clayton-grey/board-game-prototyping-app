// =========================
// FILE: server/services/Session.js
// =========================

import { isAdmin } from '../utils/Permissions.js';

export class Session {
  constructor(code) {
    this.code = code;
    this.projectName = 'New Project';

    this.users = new Map();
    this.elements = [
      { id: 1, x: 100, y: 100, w: 50, h: 50, lockedBy: null },
      { id: 2, x: 300, y: 200, w: 60, h: 80, lockedBy: null },
    ];

    this.nextJoinOrder = 1;
    this.undoStack = [];
    this.redoStack = [];

    this.pendingMoves = new Map();
    this.pendingResizes = new Map();
  }

  canManage(userId) {
    const user = this.users.get(userId);
    if (!user) return false;
    return isAdmin(user) || (user.sessionRole === 'owner');
  }

  /**
   * Add or re-join a user to this session:
   * - If it's a brand-new user => sessionRole='owner' if there's no owner, else 'viewer'.
   * - If user exists => update name/socket/admin if needed.
   * - Then we check if the session has an owner; if not, we assign *this* user as owner.
   */
  addUser(userId, userName, isAdminFlag = false, wsSocket = null) {
    let userObj = this.users.get(userId);

    if (!userObj) {
      // brand new
      userObj = {
        userId,
        name: userName || 'Anonymous',
        color: this._colorFromUserId(userId),
        globalRole: isAdminFlag ? 'admin' : 'user',
        // "viewer" by default; we fix it to "owner" if needed below
        sessionRole: 'viewer',
        socket: wsSocket,
        x: 0,
        y: 0,
        joinOrder: this.nextJoinOrder++,
      };
      this.users.set(userId, userObj);
    } else {
      // re-joining => update name, socket, admin
      userObj.socket = wsSocket;
      if (userName) {
        userObj.name = userName;
      }
      if (isAdminFlag) {
        userObj.globalRole = 'admin';
      }
    }

    // If there's truly no owner in the session, make *this user* the owner
    if (!this._hasOwner()) {
      userObj.sessionRole = 'owner';
    }

    return userObj;
  }

  removeUser(userId) {
    const user = this.users.get(userId);
    if (!user) return null;

    for (const el of this.elements) {
      if (el.lockedBy === userId) {
        el.lockedBy = null;
      }
    }

    const wasOwner = (user.sessionRole === 'owner');
    this.users.delete(userId);

    if (wasOwner) {
      this._reassignOwnerIfNeeded();
    }
    return user;
  }

  kickUser(kickerUserId, targetUserId) {
    const kicker = this.users.get(kickerUserId);
    const target = this.users.get(targetUserId);
    if (!kicker || !target) return null;

    if (!this.canManage(kickerUserId)) return null;
    if (target.sessionRole === 'owner' || target.globalRole === 'admin') return null;

    for (const el of this.elements) {
      if (el.lockedBy === targetUserId) {
        el.lockedBy = null;
      }
    }
    this.users.delete(targetUserId);

    if (target.sessionRole === 'owner') {
      this._reassignOwnerIfNeeded();
    }
    return target;
  }

  /**
   * Upgrades an ephemeral user to a "real" user by removing oldUserId
   * and replacing it with newUserId, preserving sessionRole (including 'owner').
   */
  upgradeUserId(oldUserId, newUserId, newName, newIsAdmin, wsSocket) {
    let oldUser = this.users.get(oldUserId);
    if (!oldUser) {
      // If somehow oldUserId wasn't in the map, create a placeholder so we can "upgrade" it
      oldUser = {
        userId: oldUserId,
        name: 'Anonymous',
        color: this._colorFromUserId(oldUserId),
        globalRole: 'user',
        sessionRole: 'viewer',
        socket: null,
        joinOrder: this.nextJoinOrder++,
      };
      this.users.set(oldUserId, oldUser);
    }

    // Transfer any locked elements from old ID to new ID
    for (const el of this.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    // Remember their old ephemeral role (e.g., 'owner', 'editor', 'viewer')
    const oldSessionRole = oldUser.sessionRole;

    // Remove the old user key from the map
    this.users.delete(oldUserId);

    // Also remove any existing user at newUserId (just in case)
    this.users.delete(newUserId);

    // Update fields in the same user object
    oldUser.userId = newUserId;
    oldUser.name = newName || oldUser.name;
    oldUser.globalRole = newIsAdmin ? 'admin' : 'user';
    // Preserve ephemeral role (including 'owner' if it was)
    oldUser.sessionRole = oldSessionRole;

    if (wsSocket) {
      oldUser.socket = wsSocket;
    }

    // Finally store them under newUserId
    this.users.set(newUserId, oldUser);

    return oldUser;
  }

  /**
   * Downgrade ephemeral user => merges locks, sets them to viewer, always user,
   * reassigning owner if needed so we don't end up with no owners.
   */
  downgradeUserId(oldUserId, newUserId, wsSocket) {
    let oldUser = this.users.get(oldUserId);
    if (!oldUser) {
      oldUser = {
        userId: oldUserId,
        name: 'Anonymous',
        color: this._colorFromUserId(oldUserId),
        globalRole: 'user',
        sessionRole: 'viewer',
        socket: null,
        joinOrder: this.nextJoinOrder++,
      };
      this.users.set(oldUserId, oldUser);
    }

    const wasOwner = (oldUser.sessionRole === 'owner');

    // Merge locks ...
    for (const el of this.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    // Remove old, build new
    this.users.delete(oldUserId);

    oldUser.userId = newUserId;
    oldUser.name = 'Anonymous';
    oldUser.globalRole = 'user';
    oldUser.sessionRole = 'viewer';
    oldUser.joinOrder = this.nextJoinOrder++;

    if (wsSocket) {
      oldUser.socket = wsSocket;
    }
    this.users.set(newUserId, oldUser);

    if (wasOwner) {
      // Do not reassign the newly downgraded user as owner
      this._reassignOwnerIfNeeded(newUserId);
    }

    return oldUser;
  }

  setEditorRole(targetUserId, isEditor) {
    const user = this.users.get(targetUserId);
    if (!user) return false;
    user.sessionRole = isEditor ? 'editor' : 'viewer';
    return true;
  }

  clearUndoRedo() {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * If there's no owner left, pick the earliest joiner to be the new owner.
   */
  _reassignOwnerIfNeeded(excludeUserId = null) {
    if (this._hasOwner()) return;

    let candidates = [...this.users.values()];
    if (excludeUserId) {
      candidates = candidates.filter(u => u.userId !== excludeUserId);
    }
    if (candidates.length === 0) return;

    candidates.sort((a, b) => a.joinOrder - b.joinOrder);
    candidates[0].sessionRole = 'owner';
  }

  _hasOwner() {
    return [...this.users.values()].some(u => u.sessionRole === 'owner');
  }

  _colorFromUserId(userId) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const r = (hash >> 16) & 0xff;
    const g = (hash >> 8) & 0xff;
    const b = hash & 0xff;
    return `rgb(${r},${g},${b})`;
  }
}
