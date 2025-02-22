// server/services/SessionService.js
import { WebSocket } from 'ws';

/**
 * In-memory session storage.
 */
const sessionMap = new Map();

/**
 * Each session object:
 * {
 *   code,
 *   projectName,
 *   elements,
 *   linkedProjectId,
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
   * Creates a stable color from the userId, used for ephemeral user color assignment.
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
   * Returns true if userId is in the session and isOwner or isAdmin.
   */
  static canManage(session, userId) {
    const user = session.users.get(userId);
    if (!user) return false;
    return user.isOwner || user.isAdmin;
  }

  /**
   * Sets (or unsets) a user's ephemeral "editor" role within the session.
   */
  static setEditorRole(session, targetUserId, isEditor) {
    const tgtUser = session.users.get(targetUserId);
    if (!tgtUser) return false;

    tgtUser.isEditor = isEditor;

    const dbUid = this.getDbUserId(targetUserId);
    if (dbUid) {
      const ex = session.ephemeralRoles.get(dbUid) || {};
      ex.isEditor = isEditor;
      session.ephemeralRoles.set(dbUid, ex);
    }
    return true;
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

      // If no owners exist yet, assign the first joiner
      const anyOwner = [...session.users.values()].some(u => u.isOwner);
      if (!anyOwner) {
        userObj.isOwner = true;
      }
    } else {
      // If rejoining
      userObj.socket = wsSocket;
      userObj.name = userName || userObj.name;
    }

    // If user role is admin at the app level, reflect that here
    if (userRole === "admin") {
      userObj.isAdmin = true;
    }

    // Re-apply ephemeral editor role if stored
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
   * We purposely do NOT reassign `oldUser.color`, so the user keeps that color.
   */
  static upgradeUserId(session, oldUserId, newUserId, newName, newIsAdmin, wsSocket) {
    const oldUser = session.users.get(oldUserId);
    if (!oldUser) return null;

    // Transfer any locked elements from oldUserId to newUserId
    for (const el of session.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    session.users.delete(oldUserId);

    oldUser.userId = newUserId;
    oldUser.name = newName;
    oldUser.isAdmin = !!newIsAdmin;
    // Notice: oldUser.color is UNCHANGED

    if (wsSocket) {
      oldUser.socket = wsSocket;
    }

    // Re-apply ephemeral editor role if it existed under new DB user ID
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
   * Downgrade from user_### => anon_###. Also keep the existing color.
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

    // Save ephemeral roles for that DB user ID
    const dbUid = this.getDbUserId(oldUserId);
    if (dbUid) {
      const ex = session.ephemeralRoles.get(dbUid) || {};
      ex.isEditor = wasEditor;
      session.ephemeralRoles.set(dbUid, ex);
    }

    session.users.delete(oldUserId);

    oldUser.userId = newUserId;
    oldUser.name = "Anonymous";
    oldUser.isAdmin = false;
    oldUser.isEditor = false;
    oldUser.isOwner = false;
    // oldUser.color is UNCHANGED

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
   * Remove a user from the session. Release locks, reassign owner if needed.
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
   * Kicks a user => forcibly remove them if kicker is admin/owner.
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

    if (tgtUser.isOwner) {
      this.reassignOwnerIfNeeded(session);
    }

    return tgtUser; 
  }

  /**
   * If no owners remain, assign the earliest joined user as the new owner.
   */
  static reassignOwnerIfNeeded(session) {
    const owners = [...session.users.values()].filter(u => u.isOwner);
    if (owners.length > 0) return;

    const arr = [...session.users.values()];
    if (arr.length === 0) {
      // session is empty; do nothing
      return;
    }
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
