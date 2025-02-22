// server/services/SessionService.js
import { WebSocket } from 'ws';
import { colorFromUserId } from '../ws/collabUtils.js';

/**
 * In-memory session storage.
 */
const sessionMap = new Map();

/**
 * Each session object:
 * {
 *   code, projectName, elements, linkedProjectId,
 *   users: Map(userId -> userObj),
 *   ephemeralRoles: Map(dbUid -> { isEditor?: bool}),
 *   nextJoinOrder: number
 * }
 */

export class SessionService {

  static getSession(code) {
    return sessionMap.get(code) || null;
  }

  static getOrCreateSession(code) {
    let session = sessionMap.get(code);
    if (!session) {
      session = {
        code,
        projectName: "New Project",
        elements: [
          { id: 1, x: 100, y: 100, w: 50, h: 50, lockedBy: null },
          { id: 2, x: 300, y: 200, w: 60, h: 80, lockedBy: null },
        ],
        linkedProjectId: null,
        users: new Map(),
        ephemeralRoles: new Map(),
        nextJoinOrder: 1,
      };
      sessionMap.set(code, session);
    }
    return session;
  }

  static removeSession(code) {
    sessionMap.delete(code);
  }

  /**
   * Add or update a user in the session.
   */
  static joinSession(session, userId, userName, userRole, wsSocket) {
    let userObj = session.users.get(userId);
    if (!userObj) {
      userObj = {
        userId,
        name: userName || "Anonymous",
        color: colorFromUserId(userId),
        isOwner: false,
        isEditor: false,
        isAdmin: false,
        socket: wsSocket,
        x: 0,
        y: 0,
        joinOrder: session.nextJoinOrder++,
      };
      session.users.set(userId, userObj);

      // If no owners
      const anyOwner = [...session.users.values()].some(u => u.isOwner);
      if (!anyOwner) {
        userObj.isOwner = true;
      }
    } else {
      userObj.socket = wsSocket;
      userObj.name = userName || userObj.name;
    }

    if (userRole === "admin") {
      userObj.isAdmin = true;
    }

    const dbUid = this.getDbUserId(userId);
    if (dbUid) {
      const stored = session.ephemeralRoles.get(dbUid);
      if (stored) {
        userObj.isEditor = !!stored.isEditor;
      }
    }
    return userObj;
  }

  /**
   * Upgrade from oldUserId => newUserId, carrying ephemeral roles and locks.
   */
  static upgradeUserId(session, oldUserId, newUserId, newName, newIsAdmin, wsSocket) {
    const oldUser = session.users.get(oldUserId);
    if (!oldUser) return null;

    for (const el of session.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    session.users.delete(oldUserId);

    oldUser.userId = newUserId;
    oldUser.name = newName;
    oldUser.isAdmin = !!newIsAdmin;
    if (wsSocket) {
      oldUser.socket = wsSocket;
    }

    const dbUid = this.getDbUserId(newUserId);
    if (dbUid) {
      let stored = session.ephemeralRoles.get(dbUid) || {};
      if (typeof stored.isEditor === 'boolean') {
        oldUser.isEditor = stored.isEditor;
      }
      stored.isEditor = oldUser.isEditor;
      session.ephemeralRoles.set(dbUid, stored);
    }

    session.users.set(newUserId, oldUser);
    return oldUser;
  }

  /**
   * Downgrade from user_### => anon_###.
   */
  static downgradeUserId(session, oldUserId, newUserId, wsSocket) {
    const oldUser = session.users.get(oldUserId);
    if (!oldUser) return null;

    for (const el of session.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    const wasOwner = oldUser.isOwner;
    const wasEditor = oldUser.isEditor;

    const dbUid = this.getDbUserId(oldUserId);
    if (dbUid) {
      let ex = session.ephemeralRoles.get(dbUid) || {};
      ex.isEditor = wasEditor;
      session.ephemeralRoles.set(dbUid, ex);
    }

    session.users.delete(oldUserId);

    oldUser.userId = newUserId;
    oldUser.name = "Anonymous";
    oldUser.isAdmin = false;
    oldUser.isEditor = false;
    oldUser.isOwner = false;
    if (wsSocket) {
      oldUser.socket = wsSocket;
    }

    session.users.set(newUserId, oldUser);
    if (wasOwner) {
      this.reassignOwnerIfNeeded(session);
    }
    return oldUser;
  }

  /**
   * Remove a user from the session. Release locks and reassign owner if needed.
   */
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

  /**
   * Kick a user => forcibly remove them from the session, if
   * the kicker is either owner or admin, and target is not owner/admin.
   */
  static kickUser(session, kickerUserId, targetUserId) {
    const reqUser = session.users.get(kickerUserId);
    const tgtUser = session.users.get(targetUserId);
    if (!reqUser || !tgtUser) return null;

    // Only owner or admin can kick
    if (!reqUser.isOwner && !reqUser.isAdmin) return null;

    // Can't kick an owner or admin
    if (tgtUser.isAdmin || tgtUser.isOwner) return null;

    // Release locks
    for (const el of session.elements) {
      if (el.lockedBy === targetUserId) {
        el.lockedBy = null;
      }
    }
    session.users.delete(targetUserId);

    // If they were owner, reassign
    if (tgtUser.isOwner) {
      this.reassignOwnerIfNeeded(session);
    }

    return tgtUser; 
  }

  static reassignOwnerIfNeeded(session) {
    const owners = [...session.users.values()].filter(u => u.isOwner);
    if (owners.length > 0) return;

    const arr = [...session.users.values()];
    if (arr.length === 0) return;

    arr.sort((a, b) => a.joinOrder - b.joinOrder);
    arr[0].isOwner = true;
  }

  /**
   * If userId = "user_5", returns 5; else null.
   */
  static getDbUserId(userId) {
    if (userId.startsWith("user_")) {
      return parseInt(userId.split("_")[1], 10);
    }
    return null;
  }
}
