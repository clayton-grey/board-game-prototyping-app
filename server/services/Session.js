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

    // Shared session-wide stacks for undo/redo
    this.undoStack = [];
    this.redoStack = [];

    // If a user starts moving or resizing but hasn't "finalized" it,
    // we store partial changes in these maps:
    //   pendingMoves:   Map<elementId, { userId, oldX, oldY }>
    //   pendingResizes: Map< userId, Map< elementId, { x, y, w, h } > >
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
   * - If brand-new => sessionRole='owner' if no owner exists; else 'viewer'.
   * - If user exists => update name/socket/admin if needed.
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
        sessionRole: 'viewer',
        socket: wsSocket,
        x: 0,
        y: 0,
        joinOrder: this.nextJoinOrder++,
      };
      this.users.set(userId, userObj);
    } else {
      // re-joining => update name, socket, possibly admin
      userObj.socket = wsSocket;
      if (userName) {
        userObj.name = userName;
      }
      if (isAdminFlag) {
        userObj.globalRole = 'admin';
      }
    }

    // If there's truly no owner, make this user the owner
    if (!this._hasOwner()) {
      userObj.sessionRole = 'owner';
    }

    return userObj;
  }

  removeUser(userId) {
    const user = this.users.get(userId);
    if (!user) return null;

    // free any locked elements
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
    if (target.sessionRole === 'owner' || target.globalRole === 'admin') {
      return null;
    }

    // free any locked elements
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
   * Upgrades an ephemeral user ID to a "real" user ID, preserving:
   *   - locked elements,
   *   - session roles (owner/editor/viewer),
   *   - pending moves/resizes,
   *   - and merges admin if requested.
   */
  upgradeUserId(oldUserId, newUserId, newName, newIsAdmin, wsSocket) {
    let oldUser = this.users.get(oldUserId);
    if (!oldUser) {
      // create a placeholder so we can "upgrade" it
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

    // 1) Transfer locked elements
    for (const el of this.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    // 2) Remove oldUser from the map
    const oldSessionRole = oldUser.sessionRole;
    this.users.delete(oldUserId);

    // 3) Also remove any existing user at newUserId (just in case)
    this.users.delete(newUserId);

    // 4) Overwrite fields in oldUser => store as newUserId
    oldUser.userId = newUserId;
    oldUser.name = newName || oldUser.name;
    oldUser.globalRole = newIsAdmin ? 'admin' : 'user';
    oldUser.sessionRole = oldSessionRole;
    if (wsSocket) {
      oldUser.socket = wsSocket;
    }
    this.users.set(newUserId, oldUser);

    // 5) Transfer any pending moves referencing oldUserId
    for (const [elementId, moveData] of this.pendingMoves.entries()) {
      if (moveData.userId === oldUserId) {
        moveData.userId = newUserId;
      }
    }

    // 6) Transfer any pending resizes from oldUserId => newUserId
    const oldMap = this.pendingResizes.get(oldUserId);
    if (oldMap) {
      this.pendingResizes.delete(oldUserId);
      // If there's already a map for newUserId, merge them
      const existingMap = this.pendingResizes.get(newUserId) || new Map();
      // Copy all from oldMap into existingMap
      for (const [elId, originalPos] of oldMap.entries()) {
        existingMap.set(elId, originalPos);
      }
      this.pendingResizes.set(newUserId, existingMap);
    }

    return oldUser;
  }

  /**
   * Downgrades a user => merges locks, sets them to viewer, clears admin,
   * reassigns ownership if needed.
   */
  downgradeUserId(oldUserId, newUserId, wsSocket) {
    let oldUser = this.users.get(oldUserId);
    if (!oldUser) {
      // create a placeholder so we can "downgrade" it
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

    // free or reassign locks
    for (const el of this.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

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

    // Also fix pending moves
    for (const [elementId, moveData] of this.pendingMoves.entries()) {
      if (moveData.userId === oldUserId) {
        moveData.userId = newUserId;
      }
    }

    // Fix pending resizes
    const oldMap = this.pendingResizes.get(oldUserId);
    if (oldMap) {
      this.pendingResizes.delete(oldUserId);
      const existingMap = this.pendingResizes.get(newUserId) || new Map();
      for (const [elId, originalPos] of oldMap.entries()) {
        existingMap.set(elId, originalPos);
      }
      this.pendingResizes.set(newUserId, existingMap);
    }

    if (wasOwner) {
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
