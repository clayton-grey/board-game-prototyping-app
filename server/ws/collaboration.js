/**
 * ./server/ws/collaboration.js
 *
 * Key fix for permission restore: in "UPGRADE_USER_ID", we now:
 *  1) Look up ephemeralRoles[dbUid].
 *  2) Re-apply them to oldUser (for example isEditor=true).
 *  3) Then we also store back oldUser.isEditor to ephemeralRoles[dbUid] if needed.
 *
 * Everything else remains the same as your previous file that preserves
 * user order, color, and locks through login/out.
 */

import { WebSocket } from 'ws';
import { MESSAGE_TYPES } from '../../shared/wsMessageTypes.js';

// A Map of sessionCode -> sessionData
// sessionData = {
//   code, projectName, elements, linkedProjectId,
//   users: Map(userId -> userObj),
//   ephemeralRoles: Map(dbUid -> { isEditor?: bool }),
//   nextJoinOrder: number
// }
const sessionMap = new Map();

/** If userId = "user_5", returns 5; else returns null. */
function getDbUserId(userId) {
  if (userId.startsWith("user_")) {
    return parseInt(userId.split("_")[1], 10);
  }
  return null;
}

/** Compute color from userId only once, on initial creation. */
function colorFromUserId(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const r = (hash >> 16) & 0xff;
  const g = (hash >> 8) & 0xff;
  const b = hash & 0xff;
  return `rgb(${r},${g},${b})`;
}

/** Broadcast JSON to all sockets in session. */
function broadcastToSession(session, data) {
  const msg = JSON.stringify(data);
  for (const u of session.users.values()) {
    if (u.socket && u.socket.readyState === WebSocket.OPEN) {
      u.socket.send(msg);
    }
  }
}

function broadcastElementState(session) {
  broadcastToSession(session, {
    type: MESSAGE_TYPES.ELEMENT_STATE,
    elements: session.elements,
    projectName: session.projectName,
  });
}

function broadcastCursors(session) {
  const cursors = {};
  for (const u of session.users.values()) {
    if (u.x !== undefined && u.y !== undefined) {
      cursors[u.userId] = { x: u.x, y: u.y };
    }
  }
  broadcastToSession(session, {
    type: MESSAGE_TYPES.CURSOR_UPDATES,
    cursors,
  });
}

/** Sort users by joinOrder so no reorder on login/out. */
function broadcastUserList(session) {
  const sorted = [...session.users.values()].sort((a, b) => a.joinOrder - b.joinOrder);
  let currentOwnerId = null;
  const userList = sorted.map(u => {
    if (u.isOwner) currentOwnerId = u.userId;
    return {
      userId: u.userId,
      name: u.name,
      color: u.color,
      isOwner: !!u.isOwner,
      isEditor: !!u.isEditor,
      isAdmin: !!u.isAdmin,
    };
  });
  broadcastToSession(session, {
    type: MESSAGE_TYPES.SESSION_USERS,
    users: userList,
    ownerUserId: currentOwnerId,
  });
}

/** Create or fetch ephemeral session. */
function getOrCreateSession(code) {
  let s = sessionMap.get(code);
  if (!s) {
    s = {
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
    sessionMap.set(code, s);
  }
  return s;
}

/** If no owners, pick earliest joined user. */
function reassignOwnerIfNeeded(session) {
  const owners = [...session.users.values()].filter(u => u.isOwner);
  if (owners.length > 0) return;
  const arr = [...session.users.values()];
  if (arr.length === 0) {
    sessionMap.delete(session.code);
    return;
  }
  arr.sort((a, b) => a.joinOrder - b.joinOrder);
  arr[0].isOwner = true;
}

/** Kick user => remove locks => remove user => broadcast. */
function kickUser(session, targetUserId) {
  const target = session.users.get(targetUserId);
  if (!target) return false;

  // Release locks
  for (const el of session.elements) {
    if (el.lockedBy === targetUserId) {
      el.lockedBy = null;
    }
  }

  session.users.delete(targetUserId);
  reassignOwnerIfNeeded(session);
  broadcastUserList(session);
  broadcastElementState(session);

  if (target.socket && target.socket.readyState === WebSocket.OPEN) {
    const msg = JSON.stringify({ type: MESSAGE_TYPES.KICKED });
    target.socket.send(msg, () => {
      setTimeout(() => target.socket.close(), 50);
    });
  } else {
    target.socket?.close();
  }
  return true;
}

export function handleWebSocketConnection(ws, wss) {
  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    switch (data.type) {
      // --------------------------------------------------------
      // JOIN_SESSION
      // --------------------------------------------------------
      case MESSAGE_TYPES.JOIN_SESSION: {
        let { userId, name, sessionCode, userRole } = data;
        if (!userId) return;
        if (!sessionCode) sessionCode = "defaultSession";

        const session = getOrCreateSession(sessionCode);
        let user = session.users.get(userId);

        if (!user) {
          // Create new user object
          user = {
            userId,
            name: name || "Anonymous",
            color: colorFromUserId(userId), // only once
            isOwner: false,
            isEditor: false,
            isAdmin: false,
            socket: ws,
            x: 0,
            y: 0,
            joinOrder: session.nextJoinOrder++,
          };
          session.users.set(userId, user);

          // If no one is owner, this user becomes ephemeral owner
          const anyOwner = [...session.users.values()].some(u => u.isOwner);
          if (!anyOwner) {
            user.isOwner = true;
          }
        } else {
          // Already present => update socket, name
          user.socket = ws;
          user.name = name || user.name;
        }

        if (userRole === "admin") {
          user.isAdmin = true;
        }

        // If user_#, restore ephemeral roles if any
        const dbUid = getDbUserId(userId);
        if (dbUid) {
          const stored = session.ephemeralRoles.get(dbUid);
          if (stored) {
            user.isEditor = !!stored.isEditor;
          }
        }

        ws.sessionCode = sessionCode;
        ws.userId = userId;

        broadcastUserList(session);
        broadcastElementState(session);
        break;
      }

      // --------------------------------------------------------
      // CURSOR_UPDATE, ELEMENT_GRAB/MOVE/RELEASE, etc.
      // --------------------------------------------------------
      case MESSAGE_TYPES.CURSOR_UPDATE: {
        const { userId, x, y } = data;
        const code = ws.sessionCode;
        if (!code) return;
        const session = sessionMap.get(code);
        if (!session) return;
        const u = session.users.get(userId);
        if (!u) return;
        u.x = x;
        u.y = y;
        broadcastCursors(session);
        // older single approach
        broadcastToSession(session, {
          type: MESSAGE_TYPES.CURSOR_UPDATE,
          userId,
          x,
          y,
        });
        break;
      }

      case MESSAGE_TYPES.ELEMENT_GRAB: {
        const { userId, elementId } = data;
        const s = sessionMap.get(ws.sessionCode);
        if (!s) return;
        const el = s.elements.find(e => e.id === elementId);
        if (!el) return;
        if (!el.lockedBy || el.lockedBy === userId) {
          el.lockedBy = userId;
          broadcastElementState(s);
        }
        break;
      }

      case MESSAGE_TYPES.ELEMENT_MOVE: {
        const { userId, elementId, x, y } = data;
        const s = sessionMap.get(ws.sessionCode);
        if (!s) return;
        const el = s.elements.find(e => e.id === elementId);
        if (!el) return;
        if (el.lockedBy === userId) {
          el.x = x;
          el.y = y;
          broadcastElementState(s);
        }
        break;
      }

      case MESSAGE_TYPES.ELEMENT_RELEASE: {
        const { userId, elementId } = data;
        const s = sessionMap.get(ws.sessionCode);
        if (!s) return;
        const el = s.elements.find(e => e.id === elementId);
        if (!el) return;
        if (el.lockedBy === userId) {
          el.lockedBy = null;
          broadcastElementState(s);
        }
        break;
      }

      case MESSAGE_TYPES.PROJECT_NAME_CHANGE: {
        const { userId, newName } = data;
        const s = sessionMap.get(ws.sessionCode);
        if (!s) return;
        const requestingUser = s.users.get(userId);
        if (!requestingUser) return;
        if (requestingUser.isOwner || requestingUser.isAdmin) {
          s.projectName = newName;
          broadcastToSession(s, {
            type: MESSAGE_TYPES.PROJECT_NAME_CHANGE,
            newName,
          });
        }
        break;
      }

      // --------------------------------------------------------
      // MAKE_EDITOR, REMOVE_EDITOR, KICK_USER
      // --------------------------------------------------------
      case MESSAGE_TYPES.MAKE_EDITOR: {
        const { userId, targetUserId } = data;
        const s = sessionMap.get(ws.sessionCode);
        if (!s) return;
        const reqUser = s.users.get(userId);
        const tgtUser = s.users.get(targetUserId);
        if (!reqUser || !tgtUser) return;
        if (reqUser.isOwner || reqUser.isAdmin) {
          if (!tgtUser.isAdmin && !tgtUser.isOwner) {
            tgtUser.isEditor = true;
            const dbUid = getDbUserId(targetUserId);
            if (dbUid) {
              const ex = s.ephemeralRoles.get(dbUid) || {};
              ex.isEditor = true;
              s.ephemeralRoles.set(dbUid, ex);
            }
            broadcastUserList(s);
          }
        }
        break;
      }

      case MESSAGE_TYPES.REMOVE_EDITOR: {
        const { userId, targetUserId } = data;
        const s = sessionMap.get(ws.sessionCode);
        if (!s) return;
        const reqUser = s.users.get(userId);
        const tgtUser = s.users.get(targetUserId);
        if (!reqUser || !tgtUser) return;
        if (reqUser.isOwner || reqUser.isAdmin) {
          if (tgtUser.isEditor) {
            tgtUser.isEditor = false;
            const dbUid = getDbUserId(targetUserId);
            if (dbUid) {
              const ex = s.ephemeralRoles.get(dbUid) || {};
              ex.isEditor = false;
              s.ephemeralRoles.set(dbUid, ex);
            }
            broadcastUserList(s);
          }
        }
        break;
      }

      case MESSAGE_TYPES.KICK_USER: {
        const { userId, targetUserId } = data;
        const s = sessionMap.get(ws.sessionCode);
        if (!s) return;
        const reqUser = s.users.get(userId);
        const tgtUser = s.users.get(targetUserId);
        if (!reqUser || !tgtUser) return;
        if (reqUser.isOwner || reqUser.isAdmin) {
          if (!tgtUser.isAdmin && !tgtUser.isOwner) {
            kickUser(s, targetUserId);
          }
        }
        break;
      }

      // --------------------------------------------------------
      // UPGRADE_USER_ID (anon => user_#)
      // --------------------------------------------------------
      case MESSAGE_TYPES.UPGRADE_USER_ID: {
        const { oldUserId, newUserId, newName, newIsAdmin } = data;
        const s = sessionMap.get(ws.sessionCode);
        if (!s) return;

        const oldUser = s.users.get(oldUserId);
        if (!oldUser) return;

        // Reassign locks
        for (const el of s.elements) {
          if (el.lockedBy === oldUserId) {
            el.lockedBy = newUserId;
          }
        }

        // Remove old ID
        s.users.delete(oldUserId);

        // Update the same user object
        oldUser.userId = newUserId;
        oldUser.name = newName;
        oldUser.isAdmin = !!newIsAdmin;
        // keep oldUser.color, isOwner, isEditor, joinOrder

        const dbUid = getDbUserId(newUserId);
        if (dbUid) {
          // 1) Retrieve ephemeral roles from memory
          let stored = s.ephemeralRoles.get(dbUid) || {};

          // 2) Re-apply them to oldUser (in case ephemeral user wasn't editor, 
          //    but stored says they are).
          if (typeof stored.isEditor === 'boolean') {
            oldUser.isEditor = stored.isEditor;
          }

          // 3) Also store back user’s current ephemeral state to ephemeralRoles
          stored.isEditor = oldUser.isEditor;
          s.ephemeralRoles.set(dbUid, stored);
        }

        s.users.set(newUserId, oldUser);
        ws.userId = newUserId;

        broadcastUserList(s);
        broadcastElementState(s);
        break;
      }

      // --------------------------------------------------------
      // DOWNGRADE_USER_ID (user_# => anon)
      // --------------------------------------------------------
      case MESSAGE_TYPES.DOWNGRADE_USER_ID: {
        const { oldUserId, newUserId } = data;
        const s = sessionMap.get(ws.sessionCode);
        if (!s) return;

        const oldUser = s.users.get(oldUserId);
        if (!oldUser) return;

        // Reassign locks
        for (const el of s.elements) {
          if (el.lockedBy === oldUserId) {
            el.lockedBy = newUserId;
          }
        }

        const wasOwner = oldUser.isOwner;
        const wasEditor = oldUser.isEditor;

        // If it was user_#, store ephemeral roles (like isEditor)
        const dbUid = getDbUserId(oldUserId);
        if (dbUid) {
          let ex = s.ephemeralRoles.get(dbUid) || {};
          ex.isEditor = wasEditor; // store before we null it
          s.ephemeralRoles.set(dbUid, ex);
        }

        s.users.delete(oldUserId);

        oldUser.userId = newUserId;
        oldUser.name = "Anonymous";
        oldUser.isAdmin = false;
        oldUser.isEditor = false;
        oldUser.isOwner = false; 
        // keep oldUser.color, oldUser.joinOrder

        s.users.set(newUserId, oldUser);
        ws.userId = newUserId;

        if (wasOwner) {
          reassignOwnerIfNeeded(s);
        }

        broadcastUserList(s);
        broadcastElementState(s);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    const code = ws.sessionCode;
    const userId = ws.userId;
    if (!code || !userId) return;

    const s = sessionMap.get(code);
    if (!s) return;

    const user = s.users.get(userId);
    if (!user) return;

    // Release locks
    for (const el of s.elements) {
      if (el.lockedBy === userId) {
        el.lockedBy = null;
      }
    }

    const wasOwner = user.isOwner;
    s.users.delete(userId);

    if (wasOwner) {
      reassignOwnerIfNeeded(s);
    }

    broadcastUserList(s);
    broadcastElementState(s);

    if (s.users.size === 0) {
      sessionMap.delete(code);
    }
  });
}
