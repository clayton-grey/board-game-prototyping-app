// server/services/SessionService.js
import { WebSocket } from 'ws';

const sessionMap = new Map();

export class SessionService {
  static getSession(code) {
    return sessionMap.get(code) || null;
  }

  static getOrCreateSession(code) {
    let session = sessionMap.get(code);
    if (!session) {
      session = {
        code,
        projectName: 'New Project',
        elements: [
          { id: 1, x: 100, y: 100, w: 50, h: 50, lockedBy: null },
          { id: 2, x: 300, y: 200, w: 60, h: 80, lockedBy: null },
        ],
        linkedProjectId: null,
        users: new Map(),
        nextJoinOrder: 1,  // used for sorting and for reassigning an owner
        undoStack: [],
        redoStack: [],
        pendingMoves: new Map(),
        pendingResizes: new Map(),
      };
      sessionMap.set(code, session);
    }
    return session;
  }

  static removeSession(code) {
    sessionMap.delete(code);
  }

  /**
   * Generates a color from the userId by hashing it.
   */
  static colorFromUserId(userId) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const r = (hash >> 16) & 0xff;
    const g = (hash >> 8) & 0xff;
    const b = hash & 0xff;
    return `rgb(${r},${g},${b})`;
  }

  /**
   * Checks if a user can "manage" roles — must be an owner or an admin.
   */
  static canManage(session, userId) {
    const user = session.users.get(userId);
    if (!user) return false;
    return user.isOwner || user.isAdmin;
  }

  /**
   * Assign or remove `isEditor` from a target user (only modifies the user object).
   */
  static setEditorRole(session, targetUserId, isEditor) {
    const tgtUser = session.users.get(targetUserId);
    if (!tgtUser) return false;
    tgtUser.isEditor = !!isEditor;
    return true;
  }

  /**
   * joinSession:
   *  - If isAdminOrRole === 'admin' or true, sets userObj.isAdmin = true.
   */
  static joinSession(session, userId, userName, isAdminOrRole, wsSocket) {
    let isAdmin = false;
    if (isAdminOrRole === true || isAdminOrRole === 'admin') {
      isAdmin = true;
    }

    let userObj = session.users.get(userId);
    if (!userObj) {
      userObj = {
        userId,
        name: userName || 'Anonymous',
        color: this.colorFromUserId(userId),
        isOwner: false,
        isEditor: false,
        isAdmin: false,
        socket: wsSocket,
        x: 0,
        y: 0,
        joinOrder: session.nextJoinOrder++,
      };
      session.users.set(userId, userObj);

      // If no owner yet, this user becomes owner
      const anyOwner = [...session.users.values()].some(u => u.isOwner);
      if (!anyOwner) {
        userObj.isOwner = true;
      }
    } else {
      // Rejoining: update socket and name if needed
      userObj.socket = wsSocket;
      if (userName) userObj.name = userName;
    }

    // If admin => mark userObj
    if (isAdmin) {
      userObj.isAdmin = true;
    }
    return userObj;
  }

  /**
   * Merge oldUser => newUserId; preserve locks, isAdmin/isEditor, etc.
   */
  static upgradeUserId(session, oldUserId, newUserId, newName, newIsAdmin, wsSocket) {
    let oldUser = session.users.get(oldUserId);
    if (!oldUser) {
      // create a temporary placeholder if it wasn't found
      oldUser = {
        userId: oldUserId,
        name: 'Anonymous',
        color: this.colorFromUserId(oldUserId),
        isOwner: false,
        isEditor: false,
        isAdmin: false,
        socket: null,
        joinOrder: session.nextJoinOrder++,
      };
      session.users.set(oldUserId, oldUser);
    }

    // Re-lock elements
    for (const el of session.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    // pick up old user flags
    const wasOwner = oldUser.isOwner;
    const wasEditor = oldUser.isEditor;
    const wasAdmin = oldUser.isAdmin;

    // Overwrite user object with new userId/Name
    oldUser.userId = newUserId;
    if (newName) oldUser.name = newName;

    let finalIsAdmin = wasAdmin;
    if (newIsAdmin === true || newIsAdmin === 'admin') {
      finalIsAdmin = true;
    }
    oldUser.isAdmin = finalIsAdmin;
    oldUser.isEditor = wasEditor;
    oldUser.isOwner = wasOwner;

    if (wsSocket) {
      oldUser.socket = wsSocket;
    }

    // Remove old from session, add new
    session.users.delete(oldUserId);
    session.users.set(newUserId, oldUser);

    return oldUser;
  }

  static downgradeUserId(session, oldUserId, newUserId, wsSocket) {
    let oldUser = session.users.get(oldUserId);
    if (!oldUser) {
      oldUser = {
        userId: oldUserId,
        name: 'Anonymous',
        color: this.colorFromUserId(oldUserId),
        isOwner: false,
        isEditor: false,
        isAdmin: false,
        socket: null,
        joinOrder: session.nextJoinOrder++,
      };
      session.users.set(oldUserId, oldUser);
    }

    // Re-lock elements
    for (const el of session.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    const wasOwner = oldUser.isOwner;

    session.users.delete(oldUserId);

    // The user becomes an anonymous user with no privileges
    oldUser.userId = newUserId;
    oldUser.name = 'Anonymous';
    oldUser.isAdmin = false;
    oldUser.isEditor = false;
    oldUser.isOwner = false;
    oldUser.joinOrder = session.nextJoinOrder++;

    if (wsSocket) {
      oldUser.socket = wsSocket;
    }

    session.users.set(newUserId, oldUser);

    if (wasOwner) {
      this.reassignOwnerIfNeeded(session, newUserId);
    }
    return oldUser;
  }

  /**
   * Remove a user from the session, freeing locks, possibly reassigning owner.
   */
  static removeUser(session, userId) {
    const user = session.users.get(userId);
    if (!user) return null;

    // free locks
    for (const el of session.elements) {
      if (el.lockedBy === userId) {
        el.lockedBy = null;
      }
    }
    const wasOwner = user.isOwner;
    session.users.delete(userId);

    if (wasOwner) {
      this.reassignOwnerIfNeeded(session);
    }
    return user;
  }

  /**
   * Kick user: only if kicker is admin or owner, and the target is neither admin nor owner.
   */
  static kickUser(session, kickerUserId, targetUserId) {
    const reqUser = session.users.get(kickerUserId);
    const tgtUser = session.users.get(targetUserId);
    if (!reqUser || !tgtUser) return null;

    if (!reqUser.isOwner && !reqUser.isAdmin) return null;
    if (tgtUser.isAdmin || tgtUser.isOwner) return null;

    // free locks
    for (const el of session.elements) {
      if (el.lockedBy === targetUserId) {
        el.lockedBy = null;
      }
    }
    session.users.delete(targetUserId);

    if (tgtUser.isOwner) {
      this.reassignOwnerIfNeeded(session);
    }
    return tgtUser;
  }

  /**
   * If no owners remain, pick the earliest joinOrder user and make them owner.
   */
  static reassignOwnerIfNeeded(session, excludeUserId = null) {
    const owners = [...session.users.values()].filter(u => u.isOwner);
    if (owners.length > 0) return;

    const arr = [...session.users.values()];
    if (arr.length === 0) {
      return;
    }

    const potentialOwners = excludeUserId
      ? arr.filter(u => u.userId !== excludeUserId)
      : arr;

    if (potentialOwners.length === 0) {
      return;
    }

    potentialOwners.sort((a, b) => a.joinOrder - b.joinOrder);
    potentialOwners[0].isOwner = true;
  }

  /**
   * Clears the session's undo/redo stacks.
   */
  static clearUndoRedo(session) {
    session.undoStack = [];
    session.redoStack = [];
  }
}
