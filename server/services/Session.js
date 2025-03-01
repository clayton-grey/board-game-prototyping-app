// server/services/Session.js

export class Session {
  constructor(code) {
    this.code = code;
    this.projectName = 'New Project';

    // In-memory users mapped by userId
    this.users = new Map();

    // Example default elements
    this.elements = [
      { id: 1, x: 100, y: 100, w: 50, h: 50, lockedBy: null },
      { id: 2, x: 300, y: 200, w: 60, h: 80, lockedBy: null },
    ];

    this.nextJoinOrder = 1;
    this.undoStack = [];
    this.redoStack = [];

    // Temporary structures for multi-move or multi-resize interactions
    this.pendingMoves = new Map();
    this.pendingResizes = new Map();
  }

  /**
   * Return true if the given userId is allowed to "manage" others
   * (i.e., if the user is an owner or an admin).
   */
  canManage(userId) {
    const user = this.users.get(userId);
    if (!user) return false;
    return user.isOwner || user.isAdmin;
  }

  /**
   * Add (or re-join) a user to this session. If isAdmin is true,
   * userObj.isAdmin is set. The first user to join becomes isOwner.
   */
  addUser(userId, userName, isAdmin = false, wsSocket = null) {
    let userObj = this.users.get(userId);

    if (!userObj) {
      userObj = {
        userId,
        name: userName || 'Anonymous',
        color: this._colorFromUserId(userId),
        isOwner: false,
        isEditor: false,
        isAdmin: false,
        socket: wsSocket,
        x: 0,  // ephemeral cursor pos
        y: 0,
        joinOrder: this.nextJoinOrder++,
      };
      this.users.set(userId, userObj);

      // If no owner yet, assign this user as owner
      if (![...this.users.values()].some(u => u.isOwner)) {
        userObj.isOwner = true;
      }
    } else {
      // Re-joining: update socket and name if provided
      userObj.socket = wsSocket;
      if (userName) {
        userObj.name = userName;
      }
    }

    if (isAdmin) {
      userObj.isAdmin = true;
    }

    return userObj;
  }

  /**
   * Removes a user from this session, freeing any locks they held,
   * and possibly reassigning the owner if needed.
   * Returns the removed user object or null if not found.
   */
  removeUser(userId) {
    const user = this.users.get(userId);
    if (!user) return null;

    // Free any locks
    for (const el of this.elements) {
      if (el.lockedBy === userId) {
        el.lockedBy = null;
      }
    }

    const wasOwner = user.isOwner;
    this.users.delete(userId);

    // If the removed user was owner, reassign
    if (wasOwner) {
      this._reassignOwnerIfNeeded();
    }
    return user;
  }

  /**
   * Kicks a target user if kicker is admin/owner, and target is neither admin nor owner.
   * Returns the kicked user object or null if not allowed.
   */
  kickUser(kickerUserId, targetUserId) {
    const kicker = this.users.get(kickerUserId);
    const target = this.users.get(targetUserId);
    if (!kicker || !target) return null;

    // Must be owner or admin to kick
    if (!kicker.isOwner && !kicker.isAdmin) return null;

    // Cannot kick an admin or owner
    if (target.isOwner || target.isAdmin) return null;

    // Free locks
    for (const el of this.elements) {
      if (el.lockedBy === targetUserId) {
        el.lockedBy = null;
      }
    }
    this.users.delete(targetUserId);

    if (target.isOwner) {
      this._reassignOwnerIfNeeded();
    }
    return target;
  }

  /**
   * Upgrades an existing ephemeral user from oldUserId => newUserId,
   * merges locks, admin status, etc. If newIsAdmin is true, the user
   * becomes admin. Returns the updated user object.
   */
  upgradeUserId(oldUserId, newUserId, newName, newIsAdmin, wsSocket) {
    let oldUser = this.users.get(oldUserId);
    if (!oldUser) {
      // create a placeholder
      oldUser = {
        userId: oldUserId,
        name: 'Anonymous',
        color: this._colorFromUserId(oldUserId),
        isOwner: false,
        isEditor: false,
        isAdmin: false,
        socket: null,
        joinOrder: this.nextJoinOrder++,
      };
      this.users.set(oldUserId, oldUser);
    }

    // re-lock elements
    for (const el of this.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    // preserve isOwner/isEditor/isAdmin, but override with newIsAdmin if requested
    const wasOwner = oldUser.isOwner;
    const wasEditor = oldUser.isEditor;
    let finalIsAdmin = oldUser.isAdmin;

    if (newIsAdmin === true || newIsAdmin === 'admin') {
      finalIsAdmin = true;
    }

    // remove old reference
    this.users.delete(oldUserId);

    oldUser.userId = newUserId;
    oldUser.name = newName || oldUser.name;
    oldUser.isOwner = wasOwner;
    oldUser.isEditor = wasEditor;
    oldUser.isAdmin = finalIsAdmin;
    if (wsSocket) {
      oldUser.socket = wsSocket;
    }

    this.users.set(newUserId, oldUser);
    return oldUser;
  }

  /**
   * Downgrades a user => ephemeral "anon" user. Clears admin/owner/editor,
   * merges locks, etc. Returns the new user object.
   */
  downgradeUserId(oldUserId, newUserId, wsSocket) {
    let oldUser = this.users.get(oldUserId);
    if (!oldUser) {
      oldUser = {
        userId: oldUserId,
        name: 'Anonymous',
        color: this._colorFromUserId(oldUserId),
        isOwner: false,
        isEditor: false,
        isAdmin: false,
        socket: null,
        joinOrder: this.nextJoinOrder++,
      };
      this.users.set(oldUserId, oldUser);
    }

    for (const el of this.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    const wasOwner = oldUser.isOwner;
    this.users.delete(oldUserId);

    oldUser.userId = newUserId;
    oldUser.name = 'Anonymous';
    oldUser.isOwner = false;
    oldUser.isAdmin = false;
    oldUser.isEditor = false;
    oldUser.joinOrder = this.nextJoinOrder++;

    if (wsSocket) {
      oldUser.socket = wsSocket;
    }
    this.users.set(newUserId, oldUser);

    if (wasOwner) {
      this._reassignOwnerIfNeeded(newUserId);
    }
    return oldUser;
  }

  /**
   * Set or unset a user’s editor status.
   */
  setEditorRole(targetUserId, isEditor) {
    const user = this.users.get(targetUserId);
    if (!user) return false;
    user.isEditor = !!isEditor;
    return true;
  }

  /**
   * Clear undo/redo stacks for this session.
   */
  clearUndoRedo() {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * (Private) If there are no owners left, pick the earliest joinOrder user
   * and make them owner.
   */
  _reassignOwnerIfNeeded(excludeUserId = null) {
    const owners = [...this.users.values()].filter(u => u.isOwner);
    if (owners.length > 0) return;

    const candidates = excludeUserId
      ? [...this.users.values()].filter(u => u.userId !== excludeUserId)
      : [...this.users.values()];

    if (candidates.length === 0) {
      return; // no one left
    }

    candidates.sort((a, b) => a.joinOrder - b.joinOrder);
    candidates[0].isOwner = true;
  }

  /**
   * Utility: generate a color from userId
   */
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
