// =========================
// FILE: client/js/app.js
// =========================

import { MESSAGE_TYPES } from "../../shared/wsMessageTypes.js";
import {
  initCanvas,
  handleCanvasMessage,
  handleUserColorUpdate,
  setProjectNameFromServer,
  updateCanvasUserId,
  removeCursorsForMissingUsers,
} from "./canvas.js";
import { connectWebSocket, sendWSMessage } from "./wsClient.js";

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

let sessionUsers = [];
let ephemeralSessionCode = localStorage.getItem("sessionCode") || "defaultSession";

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

/** A small wrapper for fetch JSON calls. */
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

/**
 * A simple helper to display a short message in the top
 * of the project manager or any other container.
 */
function showMessage(msg, isError = false) {
  messageContainer.textContent = msg;
  messageContainer.style.color = isError ? "red" : "green";
  setTimeout(() => {
    if (messageContainer.textContent === msg) {
      messageContainer.textContent = "";
    }
  }, 3000);
}

/** Connect to WS and set up callback. */
function startWebSocket() {
  connectWebSocket(handleServerMessage);
}

/** Called after WS is open => send a JOIN_SESSION message. */
function doJoinSession() {
  if (!sendWSMessage) return;
  const userName = currentUser ? currentUser.name : "Anonymous";
  let userRole = isCurrentUserAdmin() ? "admin" : "";

  sendWSMessage({
    type: MESSAGE_TYPES.JOIN_SESSION,
    userId: activeUserId,
    name: userName,
    sessionCode: ephemeralSessionCode,
    userRole,
  });
}

/** Master WS message handler => route by type. */
function handleServerMessage(data) {
  switch (data.type) {
    case MESSAGE_TYPES.SESSION_USERS:
      sessionUsers = data.users || [];
      renderSessionUsers();
      updateLocalUserUI();
      sessionUsers.forEach((u) => {
        handleUserColorUpdate(u.userId, u.name, u.color);
      });
      removeCursorsForMissingUsers(sessionUsers.map((u) => u.userId));
      const me = sessionUsers.find((u) => u.userId === activeUserId);
      if (me) {
        userCircle.style.background = me.color;
        userCircleText.textContent = getInitial(me.name);
      }
      break;

    case MESSAGE_TYPES.PROJECT_NAME_CHANGE: {
      const { newName } = data;
      setProjectNameFromServer(newName);
      restoreNameSpan();
      showMessage(`Renamed to: ${newName}`);
      break;
    }

    case MESSAGE_TYPES.CHAT_MESSAGE:
      appendChatMessage(data.message.userId, data.message.text);
      break;

    case MESSAGE_TYPES.ELEMENT_STATE:
    case MESSAGE_TYPES.CURSOR_UPDATE:
    case MESSAGE_TYPES.CURSOR_UPDATES:
      handleCanvasMessage(data, activeUserId);
      break;

    case MESSAGE_TYPES.KICKED:
      alert("You have been kicked from the session.");
      break;

    case MESSAGE_TYPES.UNDO_REDO_FAILED:
      showMessage(data.reason || "Undo/Redo failed", true);
      break;

    default:
      console.log("Unknown message:", data.type, data);
  }
}

/** Show/hide UI elements if I'm an owner/admin. */
function updateUIVisibility() {
  if (!isLoggedIn()) {
    openPMBtn.style.display = "none";
  } else if (amIOwnerOrAdmin()) {
    openPMBtn.style.display = "inline-block";
  } else {
    openPMBtn.style.display = "none";
  }
}

function getInitial(str) {
  if (!str) return "?";
  return str.trim().charAt(0).toUpperCase();
}

/** Are we ephemeral owner or admin in ephemeral session logic? */
function amIOwnerOrAdmin() {
  const me = sessionUsers.find((u) => u.userId === activeUserId);
  if (!me) return false;
  if (me.globalRole === "admin") return true;
  return me.sessionRole === "owner";
}

/** Called after login/out or user list changes => update user circle, name, etc. */
function updateLocalUserUI() {
  let displayName = currentUser?.name || "Anonymous";
  userNameSpan.textContent = displayName;
  const me = sessionUsers.find((x) => x.userId === activeUserId);
  let finalColor = "#888";
  if (me?.color) {
    finalColor = me.color;
  }
  userCircle.style.background = finalColor;
  userCircleText.textContent = getInitial(displayName);
  updateUIVisibility();
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
  if (!iAmOwner && !iAmAdmin) return false;
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
    if (u.sessionRole !== "owner") {
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
  }

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

function doLogout() {
  if (!currentUser) return;
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

// Toggle login dropdown if not logged in, or prompt logout if logged in
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

// If user clicks outside => close the dropdown
document.addEventListener("click", (evt) => {
  if (
    !loginDropdown.classList.contains("hidden") &&
    !loginDropdown.contains(evt.target) &&
    !userInfoPanel.contains(evt.target)
  ) {
    loginDropdown.classList.add("hidden");
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPassword").value;

  try {
    const data = await fetchJSON("/auth/login", "POST", { email, password: pass });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(currentUser));

    const newUserId = "user_" + currentUser.id;
    const oldUserId = activeUserId;
    localStorage.setItem("activeUserId", newUserId);
    activeUserId = newUserId;

    // If previously ephemeral, we upgrade
    if (oldUserId.startsWith("anon_")) {
      sendWSMessage({
        type: MESSAGE_TYPES.UPGRADE_USER_ID,
        oldUserId,
        newUserId,
        newName: currentUser.name,
        newIsAdmin: currentUser.role === "admin",
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

registerLink.addEventListener("click", (e) => {
  e.preventDefault();
  loginDropdown.classList.add("hidden");
  registerModal.classList.remove("hidden");
});

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
        newIsAdmin: currentUser.role === "admin",
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

registerCancelBtn.addEventListener("click", () => {
  registerModal.classList.add("hidden");
});

openPMBtn.addEventListener("click", () => {
  if (!amIOwnerOrAdmin()) {
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

projectNameEl?.addEventListener("click", () => {
  startEditingProjectName();
});

function startEditingProjectName() {
  if (!projectNameEl) return;
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
  if (!amIOwnerOrAdmin()) {
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
  const oldInput = document.getElementById("edit-project-name");
  if (!oldInput) return;
  const span = document.createElement("span");
  span.id = "project-name";
  span.title = "Click to edit project name";

  if (typeof window.currentProjectName === "string" && window.currentProjectName) {
    span.textContent = window.currentProjectName;
  } else {
    span.textContent = "Untitled Project";
  }
  oldInput.replaceWith(span);
  span.addEventListener("click", () => startEditingProjectName());
}

window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  startWebSocket(); // connect and set up handleServerMessage
  initCanvas(activeUserId);
  updateLocalUserUI();
});

undoBtn?.addEventListener("click", () => {
  sendWSMessage({ type: MESSAGE_TYPES.UNDO, userId: activeUserId });
});
redoBtn?.addEventListener("click", () => {
  sendWSMessage({ type: MESSAGE_TYPES.REDO, userId: activeUserId });
});

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && !e.shiftKey && e.key === "z") {
    e.preventDefault();
    sendWSMessage({ type: MESSAGE_TYPES.UNDO, userId: activeUserId });
  } else if ((e.ctrlKey && e.shiftKey && e.key === "z") || (e.ctrlKey && e.key === "y")) {
    e.preventDefault();
    sendWSMessage({ type: MESSAGE_TYPES.REDO, userId: activeUserId });
  }
});

function appendChatMessage(userId, text) {
  if (!chatMessagesDiv) return;
  const div = document.createElement("div");
  div.textContent = `${userId}: ${text}`;
  div.classList.add("chat-message");
  chatMessagesDiv.appendChild(div);
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

function sendChatMessage() {
  if (!chatInput) return;
  const text = chatInput.value.trim();
  if (!text) return;
  sendWSMessage({
    type: MESSAGE_TYPES.CHAT_MESSAGE,
    userId: activeUserId,
    text,
  });
  chatInput.value = "";
}

chatSendBtn?.addEventListener("click", sendChatMessage);
chatInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendChatMessage();
  }
});
