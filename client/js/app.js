// client/js/app.js

import { MESSAGE_TYPES } from "../../shared/wsMessageTypes.js";
import {
  initCanvas,
  handleCanvasMessage,
  handleUserColorUpdate,
  setProjectNameFromServer,
  updateCanvasUserId,
  removeCursorsForMissingUsers,
} from "./canvas.js";

// A small helper for JSON fetch calls
async function fetchJSON(url, method = "GET", bodyObj = null) {
  const fetchOptions = { method, headers: {} };
  if (bodyObj) {
    fetchOptions.headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(bodyObj);
  }
  const res = await fetch(url, fetchOptions);
  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`Fetch error: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(data.message || `HTTP ${res.status} - ${res.statusText}`);
  }
  return data;
}

// Persisted info
let token = localStorage.getItem("token") || "";
let currentUser = localStorage.getItem("user")
  ? JSON.parse(localStorage.getItem("user"))
  : null;
let activeUserId = localStorage.getItem("activeUserId");
if (!activeUserId) {
  activeUserId = "anon_" + Math.floor(Math.random() * 999999);
  localStorage.setItem("activeUserId", activeUserId);
}

// ephemeral session code
let ephemeralSessionCode = localStorage.getItem("sessionCode") || "";
if (!ephemeralSessionCode) {
  ephemeralSessionCode = "defaultSession_" + Date.now();
  localStorage.setItem("sessionCode", ephemeralSessionCode);
}

const isLoggedIn = () => !!token && !!currentUser;
const isCurrentUserAdmin = () => currentUser && currentUser.role === "admin";

let sessionUsers = [];
let ws = null;

/** Exported for testing in direct unit style if desired */
export function getSessionUsers() {
  return sessionUsers;
}

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

const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");
const chatMessagesDiv = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send-btn");

// A simple ephemeral message function
function showMessage(msg, isError = false) {
  if (!messageContainer) return;
  messageContainer.textContent = msg;
  messageContainer.style.color = isError ? "red" : "green";
  // Clear the message after 3s
  setTimeout(() => {
    if (messageContainer.textContent === msg) {
      messageContainer.textContent = "";
    }
  }, 3000);
}

// 1) WebSocket
function connectWebSocket() {
  ws = new WebSocket("ws://localhost:3000");
  ws.onopen = () => {
    // Delay the call to doJoinSession() by one tick,
    // ensuring it can be observed in test harness immediately.
    setTimeout(doJoinSession, 0);
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

// 2) Handling incoming WS messages
function handleServerMessage(data) {
  switch (data.type) {
    case MESSAGE_TYPES.SESSION_USERS: {
      sessionUsers = data.users || [];
      renderSessionUsers();
      sessionUsers.forEach((u) => {
        handleUserColorUpdate(u.userId, u.name, u.color);
      });
      const userIds = sessionUsers.map((u) => u.userId);
      removeCursorsForMissingUsers(userIds);

      // update local user circle color
      const me = sessionUsers.find((u) => u.userId === activeUserId);
      if (me) {
        userCircle.style.background = me.color;
        userCircleText.textContent = getInitial(me.name);
      }
      break;
    }

    case MESSAGE_TYPES.PROJECT_NAME_CHANGE: {
      setProjectNameFromServer(data.newName);
      restoreNameSpanDom(data.newName);
      showMessage(`Renamed to: ${data.newName}`);
      break;
    }

    case MESSAGE_TYPES.CHAT_MESSAGE: {
      appendChatMessage(data.message.userId, data.message.text);
      break;
    }

    case MESSAGE_TYPES.ELEMENT_STATE:
    case MESSAGE_TYPES.CURSOR_UPDATE:
    case MESSAGE_TYPES.CURSOR_UPDATES:
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
      // console.log("Unknown message:", data.type, data);
      break;
  }
}

// 3) sendWSMessage wrapper
function sendWSMessage(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}
window.__sendWSMessage = sendWSMessage; // used by canvas.js

// 4) user management
function doLogout() {
  if (!currentUser) return;
  // oldUserId => user_xxx, new => anon_xxx
  const oldUserId = "user_" + currentUser.id;
  const newAnonId = "anon_" + Math.floor(Math.random() * 999999);

  sendWSMessage({
    type: MESSAGE_TYPES.DOWNGRADE_USER_ID,
    oldUserId,
    newUserId: newAnonId,
  });

  // Clear
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

function updateLocalUserUI() {
  let displayName = "Anonymous";
  if (currentUser?.name) {
    displayName = currentUser.name;
  }
  userNameSpan.textContent = displayName;
  const me = sessionUsers.find((x) => x.userId === activeUserId);
  let finalColor = "#888";
  if (me && me.color) {
    finalColor = me.color;
  }
  userCircle.style.background = finalColor;
  userCircleText.textContent = getInitial(displayName);
}

function renderSessionUsers() {
  sessionUsersList.innerHTML = "";
  sessionUsers.forEach((u) => {
    const li = document.createElement("li");

    const circle = document.createElement("div");
    circle.classList.add("session-user-circle");
    circle.style.background = u.color;
    li.appendChild(circle);

    const labelSpan = document.createElement("span");
    labelSpan.textContent = `${u.name} ${getRoleEmoji(u)}`;

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
  if (u.globalRole === "admin") return "🪄";
  if (u.sessionRole === "owner") return "🔑";
  if (u.sessionRole === "editor") return "✏️";
  return "";
}
function canManageUser(u) {
  const me = sessionUsers.find((x) => x.userId === activeUserId);
  if (!me) return false;
  const iAmAdmin = me.globalRole === "admin";
  const iAmOwner = me.sessionRole === "owner";
  if (!iAmAdmin && !iAmOwner) return false;
  if (u.userId === me.userId) return false;
  if (u.globalRole === "admin" && !iAmAdmin) return false;
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

  if (u.sessionRole === "editor") {
    // "Remove Editor"
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
  } else if (u.sessionRole !== "owner") {
    // "Make Editor" if not owner
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

  // "Kick user" if not owner/admin
  if (u.sessionRole !== "owner" && u.globalRole !== "admin") {
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
  }

  userActionPopover.style.left = "-9999px";
  userActionPopover.style.top = "-9999px";

  requestAnimationFrame(() => {
    const popRect = userActionPopover.getBoundingClientRect();
    const popHeight = popRect.height;
    const listRect = sessionUsersList.getBoundingClientRect();
    const labelRect = labelElem.getBoundingClientRect();
    const anchorMidY = (labelRect.top + labelRect.bottom) / 2;
    const offsetX = 10;
    const finalLeft = listRect.right + offsetX;
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

// 5) Project manager
function amIOwnerOrAdmin() {
  const me = sessionUsers.find((u) => u.userId === activeUserId);
  if (!me) return false;
  if (me.globalRole === "admin") return true;
  return me.sessionRole === "owner";
}

// 6) Project name editing
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
      commitNameChange(input.value.trim());
    } else if (e.key === "Escape") {
      revertNameChange();
    }
  });
  input.addEventListener("blur", () => {
    commitNameChange(input.value.trim());
  });
}

function commitNameChange(newName) {
  if (!newName) {
    revertNameChange();
    return;
  }
  if (!amIOwnerOrAdmin()) {
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
  restoreNameSpanDom(projectNameEl ? projectNameEl.textContent : "Test");
}

function restoreNameSpanDom(finalName) {
  // If an input is on the dom:
  const oldInput = document.getElementById("edit-project-name");
  if (!oldInput) return;
  const span = document.createElement("span");
  span.id = "project-name";
  span.title = "Click to edit project name";
  span.textContent = finalName;
  span.style.cursor = "pointer";
  oldInput.replaceWith(span);
  span.addEventListener("click", () => startEditingProjectName());
}

// 7) Utility
function getInitial(str) {
  if (!str) return "?";
  return str.trim().charAt(0).toUpperCase();
}

// 8) Chat
function appendChatMessage(userId, text) {
  const div = document.createElement("div");
  div.textContent = `${userId}: ${text}`;
  div.classList.add("chat-message");
  chatMessagesDiv.appendChild(div);
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

// 9) Additional setup
function addGlobalListeners() {
  // Right now, we do a contextmenu prevent
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // If user clicks userInfoPanel => either toggle login or do logout if logged in
  userInfoPanel.addEventListener("click", () => {
    if (isLoggedIn()) {
      if (confirm("Log out?")) {
        doLogout();
      }
    } else {
      if (!loginDropdown.classList.contains("hidden")) {
        loginDropdown.classList.add("hidden");
      } else {
        loginDropdown.classList.remove("hidden");
      }
    }
  });

  // If user clicks anywhere outside loginDropdown => hide it
  document.addEventListener("click", (evt) => {
    if (
      !loginDropdown.classList.contains("hidden") &&
      !loginDropdown.contains(evt.target) &&
      !userInfoPanel.contains(evt.target)
    ) {
      loginDropdown.classList.add("hidden");
    }
  });

  // login form
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("loginEmail").value.trim();
      const pass = document.getElementById("loginPassword").value;
      try {
        const data = await fetchJSON("/auth/login", "POST", {
          email,
          password: pass,
        });
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
      } catch (err) {
        showMessage(err.message, true);
      }
    });
  }

  // Register link => open register modal
  if (registerLink) {
    registerLink.addEventListener("click", (e) => {
      e.preventDefault();
      loginDropdown.classList.add("hidden");
      registerModal.classList.remove("hidden");
    });
  }

  // Register form
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      registerMessage.textContent = "";
      const name = document.getElementById("regName").value.trim();
      const email = document.getElementById("regEmail").value.trim();
      const password = document.getElementById("regPassword").value;
      const confirmPassword = document.getElementById("regConfirm").value;
      try {
        const data = await fetchJSON("/auth/register", "POST", {
          name,
          email,
          password,
          confirmPassword,
        });
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
      } catch (err) {
        registerMessage.textContent = err.message;
        registerMessage.style.color = "red";
      }
    });
  }

  // Cancel register
  registerCancelBtn.addEventListener("click", () => {
    registerModal.classList.add("hidden");
  });

  // Project Manager open
  openPMBtn.addEventListener("click", () => {
    if (!amIOwnerOrAdmin()) {
      showMessage("Must be owner or admin to open panel.", true);
      return;
    }
    pmModal.classList.remove("hidden");
  });
  // close pm
  closePMBtn.addEventListener("click", () => {
    pmModal.classList.add("hidden");
  });

  // load versions
  loadVersionsBtn.addEventListener("click", () => {
    showMessage("Version loading not implemented in ephemeral mode.", true);
  });
  // save version
  saveNewVersionBtn.addEventListener("click", () => {
    if (!isLoggedIn()) {
      showMessage("You must log in to save a project version.", true);
      return;
    }
    showMessage("Saving ephemeral version not implemented.", true);
  });
  // delete
  deleteProjectBtn.addEventListener("click", () => {
    showMessage("Delete ephemeral project not implemented.", true);
  });

  // project name click
  if (projectNameEl) {
    projectNameEl.addEventListener("click", () => {
      startEditingProjectName();
    });
  }

  // undo/redo
  if (undoBtn) {
    undoBtn.addEventListener("click", () => {
      sendWSMessage({ type: MESSAGE_TYPES.UNDO, userId: activeUserId });
    });
  }
  if (redoBtn) {
    redoBtn.addEventListener("click", () => {
      sendWSMessage({ type: MESSAGE_TYPES.REDO, userId: activeUserId });
    });
  }
  // Also keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && !e.shiftKey && e.key === "z") {
      e.preventDefault();
      sendWSMessage({ type: MESSAGE_TYPES.UNDO, userId: activeUserId });
    } else if ((e.ctrlKey && e.shiftKey && e.key === "z") || (e.ctrlKey && e.key === "y")) {
      e.preventDefault();
      sendWSMessage({ type: MESSAGE_TYPES.REDO, userId: activeUserId });
    }
  });

  // Chat
  if (chatSendBtn) {
    chatSendBtn.addEventListener("click", () => {
      sendChat();
    });
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendChat();
      }
    });
  }
}

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  sendWSMessage({
    type: MESSAGE_TYPES.CHAT_MESSAGE,
    userId: activeUserId,
    text
  });
  chatInput.value = "";
}

// On DOMContentLoaded
window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  connectWebSocket();
  initCanvas(activeUserId);
  updateLocalUserUI();
  addGlobalListeners();
});

/** Export some helpers for coverage or direct testing if needed */
export {
  doLogout,
  commitNameChange,
  revertNameChange,
  restoreNameSpanDom
};
