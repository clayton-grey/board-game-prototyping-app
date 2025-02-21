// ./client/js/app.js
import { MESSAGE_TYPES } from "../../shared/wsMessageTypes.js";
import {
  initCanvas,
  handleCanvasMessage,
  handleUserColorUpdate,
  setProjectNameFromServer,
} from "./canvas.js";

window.addEventListener("DOMContentLoaded", () => {
  // Prevent right-click context menu so we can use right/middle drag in canvas
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  // ------------------------------------------------------------------
  // LOCAL USER & TOKEN
  // ------------------------------------------------------------------
  let token = localStorage.getItem("token") || "";
  let currentUser = localStorage.getItem("user")
    ? JSON.parse(localStorage.getItem("user"))
    : null;

  // Decide the local user ID, stored in localStorage["activeUserId"]
  // This ID is what we send to the server's WebSocket
  function getLocalUserId() {
    // If user is logged in (ex: user_4)
    if (currentUser) {
      return "user_" + currentUser.id;
    }
    // Otherwise fallback to an existing anonymous ID or create one
    let anonId = localStorage.getItem("anonId");
    if (!anonId) {
      anonId = "anon_" + Math.floor(Math.random() * 999999);
      localStorage.setItem("anonId", anonId);
    }
    return anonId;
  }

  let activeUserId = localStorage.getItem("activeUserId");
  if (!activeUserId) {
    activeUserId = getLocalUserId();
    localStorage.setItem("activeUserId", activeUserId);
  } else {
    // If user logs in after having an anon ID, unify
    if (currentUser && !activeUserId.startsWith("user_")) {
      activeUserId = "user_" + currentUser.id;
      localStorage.setItem("activeUserId", activeUserId);
    }
  }

  // Quick check to see if we have a valid login token
  function isLoggedIn() {
    return !!token && !!currentUser;
  }

  // We'll store the currentProjectName for UI
  let currentProjectName = "Loading...";
  const projectId = localStorage.getItem("projectId") || 1;

  // ------------------------------------------------------------------
  // DOM ELEMENTS FOR PROJECT & USER UI
  // ------------------------------------------------------------------
  const projectNameEl = document.getElementById("project-name");
  const openPMBtn = document.getElementById("open-project-manager");
  const pmModal = document.getElementById("project-manager-modal");
  const closePMBtn = document.getElementById("close-project-manager");
  const loadVersionsBtn = document.getElementById("loadVersionsBtn");
  const saveNewVersionBtn = document.getElementById("saveNewVersionBtn");
  const versionsList = document.getElementById("versionsList");
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

  // ------------------------------------------------------------------
  // SINGLE WEBSOCKET
  // ------------------------------------------------------------------
  let ws = null;
  let sessionUsers = [];

  // Helper to send a message if socket is open
  function sendWSMessage(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function connectWebSocket() {
    ws = new WebSocket("ws://localhost:3000");

    ws.onopen = () => {
      console.log("Unified WS connected");
      // Let the server know who we are so it can track us
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

      switch (data.type) {
        // ---------------------------
        // Session / user messages
        // ---------------------------
        case MESSAGE_TYPES.SESSION_USERS: {
          sessionUsers = data.users || [];
          renderSessionUsers();

          // Also update the color / name info used by the canvas
          // so we can draw locked elements, remote cursors, etc.
          sessionUsers.forEach((u) => {
            handleUserColorUpdate(u.userId, u.name, u.color);
          });

          // If we see ourselves, update top-right circle color
          const me = sessionUsers.find((u) => u.userId === activeUserId);
          if (me) {
            userCircle.style.background = me.color;
            userCircleText.textContent = getInitial(me.name);
          }
          break;
        }

        // Project name changed by some user
        case MESSAGE_TYPES.PROJECT_NAME_CHANGE: {
          currentProjectName = data.newName;
          restoreNameSpan();
          showMessage(`Project renamed to "${currentProjectName}" by another user.`);

          // Let canvas know too, if you want
          setProjectNameFromServer(currentProjectName);
          break;
        }

        // ---------------------------
        // Canvas / element messages
        // ---------------------------
        case MESSAGE_TYPES.ELEMENT_STATE:
        case MESSAGE_TYPES.CURSOR_UPDATES:
        case "cursor-update": // older singular
          // Hand off to canvas.js
          handleCanvasMessage(data, activeUserId);
          break;

        default:
          console.log("Unknown WebSocket message type:", data.type, data);
          break;
      }
    };

    ws.onclose = () => {
      console.log("Unified WS closed");
    };
  }

  // This is how we announce ourselves
  function doJoinSession() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const userName = currentUser ? currentUser.name : "Anonymous";
    ws.send(
      JSON.stringify({
        type: MESSAGE_TYPES.JOIN_SESSION,
        userId: activeUserId,
        name: userName,
      })
    );
  }

  // We’ll export the function so canvas.js can send messages too
  // but in this example we’ll just attach it on the window for clarity
  window.__sendWSMessage = sendWSMessage;

  // ------------------------------------------------------------------
  // INIT
  // ------------------------------------------------------------------
  connectWebSocket();
  initCanvas(activeUserId); // sets up all canvas event handlers
  updateLocalUserUI();

  // ------------------------------------------------------------------
  // RENDER USERS
  // ------------------------------------------------------------------
  function renderSessionUsers() {
    sessionUsersList.innerHTML = "";
    sessionUsers.forEach((u) => {
      const li = document.createElement("li");
      const circle = document.createElement("div");
      circle.classList.add("session-user-circle");
      circle.style.background = u.color;

      const nameSpan = document.createElement("span");
      nameSpan.textContent = u.name;

      li.appendChild(circle);
      li.appendChild(nameSpan);
      sessionUsersList.appendChild(li);
    });
  }

  // ------------------------------------------------------------------
  // LOCAL USER UI
  // ------------------------------------------------------------------
  userInfoPanel.addEventListener("click", (evt) => {
    if (isLoggedIn()) {
      if (confirm("Log out?")) {
        doLogout();
      }
    } else {
      if (loginDropdown.contains(evt.target)) return;
      loginDropdown.classList.toggle("hidden");
    }
  });

  document.addEventListener("click", (evt) => {
    if (!loginDropdown.classList.contains("hidden")) {
      if (!loginDropdown.contains(evt.target) && !userInfoPanel.contains(evt.target)) {
        loginDropdown.classList.add("hidden");
      }
    }
  });

  function updateLocalUserUI() {
    let displayName = "Anonymous";
    if (currentUser && currentUser.name) {
      displayName = currentUser.name;
    }
    userNameSpan.textContent = displayName;
    userCircle.style.background = "#888"; // overridden by server once we see ourselves in SESSION_USERS
    userCircleText.textContent = getInitial(displayName);
  }

  function doLogout() {
    token = "";
    currentUser = null;
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    // revert to anonymous ID
    let anonId = "anon_" + Math.floor(Math.random() * 999999);
    localStorage.setItem("anonId", anonId);
    localStorage.setItem("activeUserId", anonId);

    showMessage("Logged out.");
    updateLocalUserUI();
    doJoinSession();
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
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

        // Now that we’re logged in, unify the userId
        const newId = "user_" + currentUser.id;
        localStorage.setItem("activeUserId", newId);

        showMessage("Logged in.");
        loginDropdown.classList.add("hidden");
        updateLocalUserUI();
        doJoinSession();
      })
      .catch((err) => {
        console.error(err);
        showMessage("Error logging in: " + err.message, true);
      });
  });

  registerLink.addEventListener("click", (e) => {
    e.preventDefault();
    loginDropdown.classList.add("hidden");
    registerModal.classList.remove("hidden");
  });

  registerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    registerMessage.textContent = "";

    const name = document.getElementById("regName").value;
    const email = document.getElementById("regEmail").value;
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
        // auto-login
        token = data.token;
        currentUser = data.user;
        localStorage.setItem("token", token);
        localStorage.setItem("user", JSON.stringify(currentUser));

        const newId = "user_" + currentUser.id;
        localStorage.setItem("activeUserId", newId);

        registerMessage.textContent = "Registration successful! Logging you in...";
        registerMessage.style.color = "green";

        setTimeout(() => {
          registerModal.classList.add("hidden");
          showMessage("Logged in as " + currentUser.name);
          updateLocalUserUI();
          doJoinSession();
        }, 1000);
      })
      .catch((err) => {
        console.error(err);
        registerMessage.textContent = err.message;
        registerMessage.style.color = "red";
      });
  });

  registerCancelBtn.addEventListener("click", () => {
    registerModal.classList.add("hidden");
  });

  function getInitial(str) {
    if (!str) return "?";
    return str.trim().charAt(0).toUpperCase();
  }

  // ------------------------------------------------------------------
  // PROJECT RENAME & UI
  // ------------------------------------------------------------------
  projectNameEl.addEventListener("click", () => {
    startEditingProjectName();
  });

  function startEditingProjectName() {
    const input = document.createElement("input");
    input.type = "text";
    input.value = projectNameEl.textContent || currentProjectName;
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
    if (!isLoggedIn()) {
      showMessage("Please log in to rename project", true);
      revertNameChange();
      return;
    }

    fetch(`/projects/${projectId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: newName, description: "" }),
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((obj) => {
            throw new Error(obj.message || "Failed to rename project");
          });
        }
        return res.json();
      })
      .then((updatedProj) => {
        currentProjectName = updatedProj.name;
        // Also broadcast to all via WebSocket
        sendWSMessage({
          type: MESSAGE_TYPES.PROJECT_NAME_CHANGE,
          newName: currentProjectName,
        });
      })
      .catch((err) => {
        console.error(err);
        showMessage("Error renaming: " + err.message, true);
      })
      .finally(() => {
        restoreNameSpan();
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
    span.textContent = currentProjectName;
    span.style.cursor = "pointer";
    oldInput.replaceWith(span);
    span.addEventListener("click", () => {
      startEditingProjectName();
    });
  }

  // ------------------------------------------------------------------
  // PROJECT MANAGER (VERSIONS, DELETE, etc.)
  // ------------------------------------------------------------------
  openPMBtn.addEventListener("click", () => pmModal.classList.remove("hidden"));
  closePMBtn.addEventListener("click", () => pmModal.classList.add("hidden"));

  loadVersionsBtn.addEventListener("click", () => {
    if (!isLoggedIn()) {
      showMessage("Log in to load versions", true);
      return;
    }
    fetch(`/projects/${projectId}/versions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load versions");
        return res.json();
      })
      .then((versions) => {
        versionsList.innerHTML = "";
        versions.forEach((v) => {
          const li = document.createElement("li");
          li.textContent = `Version #${v.version_number} (ID:${v.id})`;
          const rollbackBtn = document.createElement("button");
          rollbackBtn.textContent = "Rollback";
          rollbackBtn.style.marginLeft = "10px";
          rollbackBtn.addEventListener("click", () => rollbackVersion(v.id));
          li.appendChild(rollbackBtn);
          versionsList.appendChild(li);
        });
      })
      .catch((err) => {
        console.error(err);
        showMessage(err.message, true);
      });
  });

  function rollbackVersion(verId) {
    fetch(`/projects/${projectId}/versions/${verId}/rollback`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to rollback");
        return res.json();
      })
      .then((data) => {
        showMessage(`Rollback success. New ver: ${data.newVersion.version_number}`);
      })
      .catch((err) => {
        console.error(err);
        showMessage(err.message, true);
      });
  }

  saveNewVersionBtn.addEventListener("click", () => {
    if (!isLoggedIn()) {
      showMessage("Log in to save version", true);
      return;
    }
    const payload = {
      project_data: {
        note: "Manual save from UI",
        time: new Date().toISOString(),
      },
    };
    fetch(`/projects/${projectId}/versions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to save version");
        return res.json();
      })
      .then((newVer) => showMessage(`Created version #${newVer.version_number}`))
      .catch((err) => {
        console.error(err);
        showMessage(err.message, true);
      });
  });

  deleteProjectBtn.addEventListener("click", () => {
    if (!isLoggedIn()) {
      showMessage("Log in to delete project", true);
      return;
    }
    if (!confirm("Are you sure you want to delete this project?")) return;
    fetch(`/projects/${projectId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to delete project");
        return res.json();
      })
      .then(() => showMessage("Project deleted."))
      .catch((err) => {
        console.error(err);
        showMessage(err.message, true);
      });
  });

  // ------------------------------------------------------------------
  // UTILITY
  // ------------------------------------------------------------------
  function showMessage(msg, isError = false) {
    messageContainer.textContent = msg;
    messageContainer.style.color = isError ? "red" : "green";
    setTimeout(() => {
      if (messageContainer.textContent === msg) {
        messageContainer.textContent = "";
      }
    }, 4000);
  }
});
