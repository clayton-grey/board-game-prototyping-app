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
 *   ephemeralRoles: Map(userId -> { isEditor?: bool}),
 *   nextJoinOrder: number,
 *
 *   // Undo/Redo
 *   undoStack: [],  // each action is {type, diffs: [...]}
 *   redoStack: [],
 *
 *   // Keep track of original positions when user grabs an element
 *   pendingMoves: Map(elementId -> { userId, oldX, oldY })
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

        // Store ephemeral roles keyed by ANY userId (anon_### or user_###)
        ephemeralRoles: new Map(),
        nextJoinOrder: 1,

        // Undo/Redo
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
   * We no longer require that user to exist in `session.users`.
   */
  static setEditorRole(session, targetUserId, isEditor) {
    // Always store ephemeral roles for that userId
    const ex = session.ephemeralRoles.get(targetUserId) || {};
    ex.isEditor = isEditor;
    session.ephemeralRoles.set(targetUserId, ex);

    // If user is in the session, also update userObj.isEditor
    const tgtUser = session.users.get(targetUserId);
    if (tgtUser) {
      tgtUser.isEditor = isEditor;
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
      // Rejoining
      userObj.socket = wsSocket;
      userObj.name = userName || userObj.name;
    }

    // If user role is admin at the app level, reflect that here
    if (userRole === "admin") {
      userObj.isAdmin = true;
    }

    // Re-apply ephemeral editor role if stored
    const stored = session.ephemeralRoles.get(userId);
    if (stored) {
      userObj.isEditor = !!stored.isEditor;
    }

    return userObj;
  }

  /**
   * Upgrade from oldUserId => newUserId, carrying ephemeral roles and locks.
   * If `oldUser` doesn't exist in the session, create a minimal placeholder so we can still transfer locks.
   */
  static upgradeUserId(session, oldUserId, newUserId, newName, newIsAdmin, wsSocket) {
    let oldUser = session.users.get(oldUserId);

    // If oldUser isn't actually in session, create a placeholder
    // so we can properly move locks/roles.
    if (!oldUser) {
      oldUser = {
        userId: oldUserId,
        name: "Anonymous",
        color: this.colorFromUserId(oldUserId),
        isOwner: false,
        isEditor: false,
        isAdmin: false,
        socket: null,
        joinOrder: session.nextJoinOrder++,
      };
      session.users.set(oldUserId, oldUser);
    }

    // Transfer any locked elements
    for (const el of session.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    // Merge ephemeral roles from both old & new
    const oldEphemeral = session.ephemeralRoles.get(oldUserId) || {};
    const newEphemeral = session.ephemeralRoles.get(newUserId) || {};

    // Merge isEditor with an OR condition
    const mergedIsEditor =
      (oldUser.isEditor || oldEphemeral.isEditor) || newEphemeral.isEditor;

    // Now rename the oldUser object to the new identity
    oldUser.userId = newUserId;
    oldUser.name = newName;
    oldUser.isAdmin = !!newIsAdmin;
    oldUser.isEditor = !!mergedIsEditor;

    if (wsSocket) {
      oldUser.socket = wsSocket;
    }

    // Store final ephemeral under newUserId
    session.ephemeralRoles.set(newUserId, { isEditor: oldUser.isEditor });
    // Remove old ephemeral record
    session.ephemeralRoles.delete(oldUserId);

    // Remove the old mapping from session.users
    session.users.delete(oldUserId);
    // Reinsert oldUser under the newUserId
    session.users.set(newUserId, oldUser);

    return oldUser;
  }

  /**
   * Downgrade from user_### => anon_###.
   * Transfer locks, remove isAdmin/isOwner, rename them to "Anonymous".
   */
  static downgradeUserId(session, oldUserId, newUserId, wsSocket) {
    let oldUser = session.users.get(oldUserId);

    // If oldUser isn't in session, create a minimal placeholder
    if (!oldUser) {
      oldUser = {
        userId: oldUserId,
        name: "Anonymous",
        color: this.colorFromUserId(oldUserId),
        isOwner: false,
        isEditor: false,
        isAdmin: false,
        socket: null,
        joinOrder: session.nextJoinOrder++,
      };
      session.users.set(oldUserId, oldUser);
    }

    // Transfer locked elements from oldUserId => newUserId
    for (const el of session.elements) {
      if (el.lockedBy === oldUserId) {
        el.lockedBy = newUserId;
      }
    }

    const wasOwner = oldUser.isOwner;
    const wasEditor = oldUser.isEditor;

    // Save ephemeral roles for oldUserId (just in case)
    const oldEphemeral = session.ephemeralRoles.get(oldUserId) || {};
    oldEphemeral.isEditor = wasEditor; 
    session.ephemeralRoles.set(oldUserId, oldEphemeral);

    // Remove from session.users
    session.users.delete(oldUserId);

    // Convert user to new anonymous ID
    oldUser.userId = newUserId;
    oldUser.name = "Anonymous";
    oldUser.isAdmin = false;
    oldUser.isEditor = false; 
    oldUser.isOwner = false; 
    oldUser.joinOrder = session.nextJoinOrder++;

    if (wsSocket) {
      oldUser.socket = wsSocket;
    }

    // Add ephemeral record for newUserId (default isEditor = false)
    session.ephemeralRoles.set(newUserId, { isEditor: false });

    // Put them back under newUserId
    session.users.set(newUserId, oldUser);

    // If the old user was owner, we try to reassign ownership,
    // but pass an excludeUserId so we do *not* reassign it right back.
    if (wasOwner) {
      this.reassignOwnerIfNeeded(session, newUserId);
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
   * Excludes a given userId if provided.
   */
  static reassignOwnerIfNeeded(session, excludeUserId = null) {
    const owners = [...session.users.values()].filter(u => u.isOwner);
    if (owners.length > 0) return;

    const arr = [...session.users.values()];
    if (arr.length === 0) {
      // session is empty; do nothing
      return;
    }

    // Filter out the excluded user (e.g. newly downgraded user)
    const potentialOwners = excludeUserId
      ? arr.filter(u => u.userId !== excludeUserId)
      : arr;

    if (potentialOwners.length === 0) {
      // If no one is left after excluding, session has no owner
      return;
    }

    // Assign earliest-joined user
    potentialOwners.sort((a, b) => a.joinOrder - b.joinOrder);
    potentialOwners[0].isOwner = true;
  }

  /**
   * For legacy references. Not strictly needed if ephemeral roles are for all user IDs.
   */
  static getDbUserId(userId) {
    if (userId.startsWith("user_")) {
      return parseInt(userId.split("_")[1], 10);
    }
    return null;
  }

  /**
   * Clears the undo/redo stacks (e.g. after a new project version save).
   */
  static clearUndoRedo(session) {
    session.undoStack = [];
    session.redoStack = [];
  }
}
