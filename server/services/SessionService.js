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
        ephemeralRoles: new Map(),
        nextJoinOrder: 1,
        undoStack: [],
        redoStack: [],
        pendingMoves: new Map(),
      };
      sessionMap.set(code, session);
    }
    return session;
  }

  static removeSession(code) {
    sessionMap.delete(code);
  }

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

  static canManage(session, userId) {
    const user = session.users.get(userId);
    if (!user) return false;
    return user.isOwner || user.isAdmin;
  }

  static setEditorRole(session, targetUserId, isEditor) {
    const ex = session.ephemeralRoles.get(targetUserId) || {};
    ex.isEditor = isEditor;
    session.ephemeralRoles.set(targetUserId, ex);

    const tgtUser = session.users.get(targetUserId);
    if (tgtUser) {
      tgtUser.isEditor = isEditor;
    }
    return true;
  }

  /**
   * joinSession
   *  - The 4th param can be boolean `true` or string `'admin'`
   *    => if so, we mark userObj.isAdmin = true + ephemeralRoles.isAdmin = true
   */
  static joinSession(session, userId, userName, isAdminOrRole, wsSocket) {
    // Decide if user is admin
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
      // Rejoining
      userObj.socket = wsSocket;
      userObj.name = userName || userObj.name;
    }

    // If admin => set userObj.isAdmin & ephemeralRoles
    if (isAdmin) {
      userObj.isAdmin = true;
      const stored = session.ephemeralRoles.get(userId) || {};
      stored.isAdmin = true;
      session.ephemeralRoles.set(userId, stored);
    }

    // Re-apply ephemeral editor role if stored
    const storedRoles = session.ephemeralRoles.get(userId);
    if (storedRoles && typeof storedRoles.isEditor === 'boolean') {
      userObj.isEditor = storedRoles.isEditor;
    }

    return userObj;
  }

  static upgradeUserId(session, oldUserId, newUserId, newName, newIsAdmin, wsSocket) {
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

    for (const el of session.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    const oldEphemeral = session.ephemeralRoles.get(oldUserId) || {};
    const newEphemeral = session.ephemeralRoles.get(newUserId) || {};

    const mergedIsEditor = (oldUser.isEditor || oldEphemeral.isEditor) || newEphemeral.isEditor;

    // Also interpret newIsAdmin as boolean or 'admin'
    let newIsAdminVal = false;
    if (newIsAdmin === true || newIsAdmin === 'admin') {
      newIsAdminVal = true;
    }
    const mergedIsAdmin = newIsAdminVal || oldUser.isAdmin || oldEphemeral.isAdmin;

    oldUser.userId = newUserId;
    oldUser.name = newName;
    oldUser.isAdmin = mergedIsAdmin;
    oldUser.isEditor = mergedIsEditor;

    if (wsSocket) {
      oldUser.socket = wsSocket;
    }

    session.ephemeralRoles.set(newUserId, {
      isEditor: mergedIsEditor,
      isAdmin: mergedIsAdmin,
    });
    session.ephemeralRoles.delete(oldUserId);

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

    for (const el of session.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    const wasOwner = oldUser.isOwner;

    session.users.delete(oldUserId);

    oldUser.userId = newUserId;
    oldUser.name = 'Anonymous';
    oldUser.isAdmin = false;
    oldUser.isEditor = false;
    oldUser.isOwner = false;
    oldUser.joinOrder = session.nextJoinOrder++;

    if (wsSocket) {
      oldUser.socket = wsSocket;
    }

    session.ephemeralRoles.set(newUserId, { isEditor: false, isAdmin: false });
    session.users.set(newUserId, oldUser);

    if (wasOwner) {
      this.reassignOwnerIfNeeded(session, newUserId);
    }
    return oldUser;
  }

  static removeUser(session, userId) {
    const user = session.users.get(userId);
    if (!user) return null;

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

  static kickUser(session, kickerUserId, targetUserId) {
    const reqUser = session.users.get(kickerUserId);
    const tgtUser = session.users.get(targetUserId);
    if (!reqUser || !tgtUser) return null;

    if (!reqUser.isOwner && !reqUser.isAdmin) return null;
    if (tgtUser.isAdmin || tgtUser.isOwner) return null;

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

  static clearUndoRedo(session) {
    session.undoStack = [];
    session.redoStack = [];
  }
}
