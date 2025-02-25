// ./client/js/app.js

import { MESSAGE_TYPES } from "../../shared/wsMessageTypes.js";
import {
  initCanvas,
  handleCanvasMessage,
  handleUserColorUpdate,
  setProjectNameFromServer,
  updateCanvasUserId,
  removeCursorsForMissingUsers,
} from "./canvas.js";

// Read saved login/session from localStorage
let token = localStorage.getItem("token") || "";
let currentUser = localStorage.getItem("user")
  ? JSON.parse(localStorage.getItem("user"))
  : null;

let activeUserId = localStorage.getItem("activeUserId");
if (!activeUserId) {
  activeUserId = "anon_" + Math.floor(Math.random() * 999999);
  localStorage.setItem("activeUserId", activeUserId);
}

const isLoggedIn = () => !!token && !!currentUser;
const isCurrentUserAdmin = () => currentUser && currentUser.role === "admin";

let ephemeralSessionCode = localStorage.getItem("sessionCode") || "defaultSession";
let ephemeralOwnerId = null;
let sessionUsers = [];

// DOM references
const projectNameEl = document.getElementById("project-name");
const openPMBtn = document.getElementById("open-project-manager");
const pmModal = document.getElementById("project-manager-modal");
const closePMBtn = document.getElementById("close-project-manager");
const loadVersionsBtn = document.getElementById("loadVersionsBtn");
const saveNewVersionBtn = document.getElementById("saveNewVersionBtn");
const deleteProjectBtn = document.getElementById("deleteProjectBtn");
const messageContainer = document.getElementById("messageContainer");

const userInfoPanel = document.getElementById("user-info");
const userNameSpan = document.getElementById("user-name");
const userCircle = document.getElementById("user-circle");
const userCircleText = document.getElementById("user-circle-text");
const loginDropdown = document.getElementById("login-dropdown");
const loginForm = document.getElementById("loginForm");
const registerLink = document.getElementById("registerLink");
const sessionUsersList = document.getElementById("session-users-list");
const registerModal = document.getElementById("register-modal");
const registerForm = document.getElementById("registerForm");
const registerMessage = document.getElementById("register-message");
const registerCancelBtn = document.getElementById("registerCancelBtn");

const userActionPopover = document.getElementById("user-action-popover");

// Undo/REDO
const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");

let ws = null;

function showMessage(msg, isError = false) {
  messageContainer.textContent = msg;
  messageContainer.style.color = isError ? "red" : "green";
  setTimeout(() => {
    if (messageContainer.textContent === msg) {
      messageContainer.textContent = "";
    }
  }, 3000);
}

function sendWSMessage(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}
window.__sendWSMessage = sendWSMessage;

function connectWebSocket() {
  ws = new WebSocket("ws://localhost:3000");
  ws.onopen = () => {
    console.log("WebSocket connected.");
    doJoinSession();
  };
  ws.onmessage = (evt) => {
    let data;
    try {
      data = JSON.parse(evt.data);
    } catch (err) {
      console.error("WS parse error:", err);
      return;
    }
    handleServerMessage(data);
  };
  ws.onclose = () => {
    console.log("WebSocket closed.");
  };
}

function handleServerMessage(data) {
  switch (data.type) {
    case MESSAGE_TYPES.SESSION_USERS: {
      sessionUsers = data.users || [];
      ephemeralOwnerId = data.ownerUserId || null;
      renderSessionUsers();

      // Update cursor user info
      sessionUsers.forEach(u => {
        handleUserColorUpdate(u.userId, u.name, u.color);
      });

      // Now remove any stale cursors for users who disappeared
      const userIds = sessionUsers.map(u => u.userId);
      removeCursorsForMissingUsers(userIds);

      // Update local user circle if found
      const me = sessionUsers.find(u => u.userId === activeUserId);
      if (me) {
        userCircle.style.background = me.color;
        userCircleText.textContent = getInitial(me.name);
      }
      break;
    }

    case MESSAGE_TYPES.PROJECT_NAME_CHANGE: {
      const { newName } = data;
      setProjectNameFromServer(newName);
      restoreNameSpan();
      showMessage(`Renamed to: ${newName}`);
      break;
    }

    case MESSAGE_TYPES.CHAT_MESSAGE: {
      // The server broadcasts a new chat message
      appendChatMessage(data.message.userId, data.message.text);
      break;
    }

    case MESSAGE_TYPES.ELEMENT_STATE:
    case MESSAGE_TYPES.CURSOR_UPDATES:
    case MESSAGE_TYPES.CURSOR_UPDATE:
      handleCanvasMessage(data, activeUserId);
      break;

    case MESSAGE_TYPES.KICKED:
      alert("You have been kicked from the session.");
      ws.close();
      break;

    case MESSAGE_TYPES.UNDO_REDO_FAILED:
      showMessage(data.reason || "Undo/Redo failed", true);
      break;

    default:
      console.log("Unknown message:", data.type, data);
  }
}

function doJoinSession() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const userName = currentUser ? currentUser.name : "Anonymous";
  let userRole = "";
  if (isCurrentUserAdmin()) {
    userRole = "admin";
  }

  sendWSMessage({
    type: MESSAGE_TYPES.JOIN_SESSION,
    userId: activeUserId,
    name: userName,
    sessionCode: ephemeralSessionCode,
    userRole,
  });
}

function getInitial(str) {
  if (!str) return "?";
  return str.trim().charAt(0).toUpperCase();
}

function updateLocalUserUI() {
  let displayName = "Anonymous";
  if (currentUser?.name) {
    displayName = currentUser.name;
  }
  userNameSpan.textContent = displayName;

  let finalColor = "#888";
  const me = sessionUsers.find(u => u.userId === activeUserId);
  if (me && me.color) {
    finalColor = me.color;
  }
  userCircle.style.background = finalColor;
  userCircleText.textContent = getInitial(displayName);
}

function renderSessionUsers() {
  sessionUsersList.innerHTML = "";
  sessionUsers.forEach(u => {
    const li = document.createElement("li");

    const circle = document.createElement("div");
    circle.classList.add("session-user-circle");
    circle.style.background = u.color;
    li.appendChild(circle);

    const labelSpan = document.createElement("span");
    labelSpan.textContent = u.name + " " + getRoleEmoji(u);

    if (canManageUser(u)) {
      labelSpan.classList.add("user-name-clickable");
      labelSpan.style.cursor = "pointer";
      labelSpan.addEventListener("click", (evt) => {
        evt.stopPropagation();
        onUserNameClicked(u, labelSpan);
      });
    }
    li.appendChild(labelSpan);

    sessionUsersList.appendChild(li);
  });
}

function getRoleEmoji(u) {
  if (u.isAdmin) return "🪄";
  if (u.isOwner) return "🔑";
  if (u.isEditor) return "✏️";
  return "";
}

function canManageUser(u) {
  const iAmOwner = (activeUserId === ephemeralOwnerId);
  const iAmAdmin = isCurrentUserAdmin();
  if (!iAmOwner && !iAmAdmin) return false;
  if (u.userId === activeUserId) return false;
  if (u.isAdmin && !iAmAdmin) return false;
  return true;
}

let openPopoverUserId = null;
function onUserNameClicked(u, labelElem) {
  if (openPopoverUserId === u.userId) {
    hideUserActionPopover();
    return;
  }
  openPopoverUserId = u.userId;
  buildAndPositionPopover(u, labelElem);
}

function buildAndPositionPopover(u, labelElem) {
  userActionPopover.innerHTML = "";
  userActionPopover.classList.remove("hidden");

  if (u.isEditor) {
    const removeEd = document.createElement("div");
    removeEd.classList.add("user-action-item");
    removeEd.textContent = "Remove Editor";
    removeEd.addEventListener("click", () => {
      sendWSMessage({
        type: MESSAGE_TYPES.REMOVE_EDITOR,
        userId: activeUserId,
        targetUserId: u.userId,
      });
      hideUserActionPopover();
    });
    userActionPopover.appendChild(removeEd);
  } else {
    const makeEd = document.createElement("div");
    makeEd.classList.add("user-action-item");
    makeEd.textContent = "Make Editor";
    makeEd.addEventListener("click", () => {
      sendWSMessage({
        type: MESSAGE_TYPES.MAKE_EDITOR,
        userId: activeUserId,
        targetUserId: u.userId,
      });
      hideUserActionPopover();
    });
    userActionPopover.appendChild(makeEd);
  }

  const kickItem = document.createElement("div");
  kickItem.classList.add("user-action-item");
  kickItem.textContent = "Kick User";
  kickItem.addEventListener("click", () => {
    sendWSMessage({
      type: MESSAGE_TYPES.KICK_USER,
      userId: activeUserId,
      targetUserId: u.userId,
    });
    hideUserActionPopover();
  });
  userActionPopover.appendChild(kickItem);

  userActionPopover.style.left = "-9999px";
  userActionPopover.style.top = "-9999px";

  requestAnimationFrame(() => {
    const popRect = userActionPopover.getBoundingClientRect();
    const popHeight = popRect.height;

    const userListRect = sessionUsersList.getBoundingClientRect();
    const labelRect = labelElem.getBoundingClientRect();
    const anchorMidY = (labelRect.top + labelRect.bottom) / 2;
    const offsetX = 10;

    const finalLeft = userListRect.right + offsetX;
    const finalTop = anchorMidY - popHeight / 2;

    userActionPopover.style.left = finalLeft + "px";
    userActionPopover.style.top = finalTop + "px";
  });
}

function hideUserActionPopover() {
  openPopoverUserId = null;
  userActionPopover.classList.add("hidden");
}

document.addEventListener("click", (evt) => {
  if (
    openPopoverUserId &&
    !evt.target.closest("#user-action-popover") &&
    !evt.target.classList.contains("user-name-clickable")
  ) {
    hideUserActionPopover();
  }
});

/* ------------------------------------------------------------------
   LOG OUT => downgrade
------------------------------------------------------------------ */
function doLogout() {
  if (!currentUser) {
    return;
  }
  const oldUserId = "user_" + currentUser.id;
  const newAnonId = "anon_" + Math.floor(Math.random() * 999999);

  sendWSMessage({
    type: MESSAGE_TYPES.DOWNGRADE_USER_ID,
    oldUserId,
    newUserId: newAnonId,
  });

  token = "";
  currentUser = null;
  localStorage.removeItem("token");
  localStorage.removeItem("user");

  activeUserId = newAnonId;
  localStorage.setItem("activeUserId", newAnonId);

  updateCanvasUserId(newAnonId);
  showMessage("You are now anonymous.");
  updateLocalUserUI();
}

/* ------------------------------------------------------------------
   USER PANEL => log in/log out
------------------------------------------------------------------ */
userInfoPanel.addEventListener("click", (evt) => {
  if (isLoggedIn()) {
    if (confirm("Log out?")) {
      doLogout();
    }
  } else {
    if (!loginDropdown.contains(evt.target)) {
      loginDropdown.classList.toggle("hidden");
    }
  }
});

document.addEventListener("click", (evt) => {
  if (
    !loginDropdown.classList.contains("hidden") &&
    !loginDropdown.contains(evt.target) &&
    !userInfoPanel.contains(evt.target)
  ) {
    loginDropdown.classList.add("hidden");
  }
});

/* ------------------------------------------------------------------
   LOGIN => upgrade
------------------------------------------------------------------ */
loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPassword").value;

  fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pass }),
  })
    .then((res) => {
      if (!res.ok) {
        return res.json().then((obj) => {
          throw new Error(obj.message || "Login failed");
        });
      }
      return res.json();
    })
    .then((data) => {
      token = data.token;
      currentUser = data.user;
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(currentUser));

      const newUserId = "user_" + currentUser.id;
      const oldUserId = activeUserId;
      localStorage.setItem("activeUserId", newUserId);
      activeUserId = newUserId;

      if (oldUserId.startsWith("anon_")) {
        sendWSMessage({
          type: MESSAGE_TYPES.UPGRADE_USER_ID,
          oldUserId,
          newUserId,
          newName: currentUser.name,
          newIsAdmin: (currentUser.role === "admin"),
        });
      }
      updateCanvasUserId(newUserId);
      showMessage("Logged in as " + currentUser.name);
      loginDropdown.classList.add("hidden");
      updateLocalUserUI();
    })
    .catch((err) => {
      showMessage(err.message, true);
    });
});

/* ------------------------------------------------------------------
   REGISTER => upgrade
------------------------------------------------------------------ */
registerLink.addEventListener("click", (e) => {
  e.preventDefault();
  loginDropdown.classList.add("hidden");
  registerModal.classList.remove("hidden");
});

registerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  registerMessage.textContent = "";

  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value;
  const confirmPassword = document.getElementById("regConfirm").value;

  fetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password, confirmPassword }),
  })
    .then((res) => {
      if (!res.ok) {
        return res.json().then((obj) => {
          throw new Error(obj.message || "Registration failed");
        });
      }
      return res.json();
    })
    .then((data) => {
      token = data.token;
      currentUser = data.user;
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(currentUser));

      const newId = "user_" + currentUser.id;
      const oldId = activeUserId;
      localStorage.setItem("activeUserId", newId);
      activeUserId = newId;

      if (oldId.startsWith("anon_")) {
        sendWSMessage({
          type: MESSAGE_TYPES.UPGRADE_USER_ID,
          oldUserId: oldId,
          newUserId: newId,
          newName: currentUser.name,
          newIsAdmin: (currentUser.role === "admin"),
        });
      }
      updateCanvasUserId(newId);

      registerMessage.textContent = "Registration successful!";
      registerMessage.style.color = "green";
      setTimeout(() => {
        registerModal.classList.add("hidden");
        showMessage("Logged in as " + currentUser.name);
        updateLocalUserUI();
      }, 1000);
    })
    .catch((err) => {
      registerMessage.textContent = err.message;
      registerMessage.style.color = "red";
    });
});

registerCancelBtn.addEventListener("click", () => {
  registerModal.classList.add("hidden");
});

/* ------------------------------------------------------------------
   PROJECT MANAGEMENT
------------------------------------------------------------------ */
openPMBtn.addEventListener("click", () => {
  if (activeUserId !== ephemeralOwnerId && !isCurrentUserAdmin()) {
    showMessage("Must be owner or admin to open panel.", true);
    return;
  }
  pmModal.classList.remove("hidden");
});
closePMBtn.addEventListener("click", () => pmModal.classList.add("hidden"));

loadVersionsBtn.addEventListener("click", () => {
  showMessage("Version loading not implemented in ephemeral mode.", true);
});
saveNewVersionBtn.addEventListener("click", () => {
  if (!isLoggedIn()) {
    showMessage("You must log in to save a project version.", true);
    return;
  }
  showMessage("Saving ephemeral version not implemented.", true);
});
deleteProjectBtn.addEventListener("click", () => {
  showMessage("Delete ephemeral project not implemented.", true);
});

/* ------------------------------------------------------------------
   PROJECT NAME EDIT
------------------------------------------------------------------ */
projectNameEl.addEventListener("click", () => {
  startEditingProjectName();
});

function startEditingProjectName() {
  const input = document.createElement("input");
  input.type = "text";
  input.value = projectNameEl.textContent || "Untitled Project";
  input.id = "edit-project-name";
  projectNameEl.replaceWith(input);
  input.focus();

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitNameChange(input.value);
    } else if (e.key === "Escape") {
      revertNameChange();
    }
  });
  input.addEventListener("blur", () => {
    commitNameChange(input.value);
  });
}

function commitNameChange(newName) {
  if (!newName.trim()) {
    revertNameChange();
    return;
  }
  if (activeUserId !== ephemeralOwnerId && !isCurrentUserAdmin()) {
    showMessage("Only session owner or admin can rename.", true);
    revertNameChange();
    return;
  }
  sendWSMessage({
    type: MESSAGE_TYPES.PROJECT_NAME_CHANGE,
    userId: activeUserId,
    newName,
  });
}

function revertNameChange() {
  restoreNameSpan();
}

function restoreNameSpan() {
  const oldInput = document.getElementById("edit-project-name");
  if (!oldInput) return;
  const span = document.createElement("span");
  span.id = "project-name";
  span.title = "Click to edit project name";
  span.textContent = setProjectNameFromServer.name || "Untitled Project";
  span.style.cursor = "pointer";
  oldInput.replaceWith(span);
  span.addEventListener("click", () => startEditingProjectName());
}

/* ------------------------------------------------------------------
   FINAL INIT
------------------------------------------------------------------ */
window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  connectWebSocket();
  initCanvas(activeUserId);
  updateLocalUserUI();
});

/* ------------------------------------------------------------------
   UNDO/REDO UI + Keyboard
------------------------------------------------------------------ */
undoBtn?.addEventListener("click", () => {
  sendWSMessage({ type: MESSAGE_TYPES.UNDO, userId: activeUserId });
});
redoBtn?.addEventListener("click", () => {
  sendWSMessage({ type: MESSAGE_TYPES.REDO, userId: activeUserId });
});

// Keyboard shortcuts: Ctrl+Z => undo, Ctrl+Shift+Z or Ctrl+Y => redo
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && !e.shiftKey && e.key === "z") {
    e.preventDefault();
    sendWSMessage({ type: MESSAGE_TYPES.UNDO, userId: activeUserId });
  } else if ((e.ctrlKey && e.shiftKey && e.key === "z") || (e.ctrlKey && e.key === "y")) {
    e.preventDefault();
    sendWSMessage({ type: MESSAGE_TYPES.REDO, userId: activeUserId });
  }
});

/* ------------------------------------------------------------------
   CHAT FEATURE
------------------------------------------------------------------ */

// 1) Grab references to the chat DOM elements
const chatMessagesDiv = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");

/**
 * Appends a chat message to the chat log.
 * For a more polished UI, you might colorize or style based on user.
 */
function appendChatMessage(userId, text) {
  const div = document.createElement("div");
  div.textContent = `${userId}: ${text}`;
  div.classList.add("chat-message")
  chatMessagesDiv.appendChild(div);

  // Optionally, scroll to bottom
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

/**
 * Sends a chat message to the server via WebSocket.
 */
function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  window.__sendWSMessage({
    type: MESSAGE_TYPES.CHAT_MESSAGE,
    userId: activeUserId,
    text
  });

  chatInput.value = "";
}

/**
 * Attach click/enter key event to send chat messages.
 */
chatSendBtn.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendChatMessage();
  }
});

/* 
   Now, in handleServerMessage (already in app.js), we have:
   --------------------------------------------------------
   case MESSAGE_TYPES.CHAT_MESSAGE:
     appendChatMessage(data.message.userId, data.message.text);
     break;
*/

