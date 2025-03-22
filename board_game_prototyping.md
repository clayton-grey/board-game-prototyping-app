# Interactive Board Game Prototyping Environment Specification (Updated)

## Purpose

This project aims to create an interactive board game prototyping environment that allows multiple users to collaborate in real time. Users will be able to connect to a shared session and interact with a full-screen canvas containing various virtual board game elements. The initial focus is to provide a flexible and interactive space for game design and testing, with potential future extensions to support game logic.

---

## Core Features

### Security

- [ ] All text input fields must have security precautions to prevent injection attacks.
- [x] User authentication and data storage must adhere to industry-standard security practices.  
       **Implementation Note**:  
       JWT authentication is used (via `AuthService`) for secure routes, and user passwords are salted & hashed with `bcryptjs`.

### Canvas & User Interaction

- **Scrollable & Zoomable Canvas**:

  - [x] The canvas has a fixed center point and supports zooming.
  - [x] Minimum and maximum zoom levels are configurable in code.
  - [x] Clicking and dragging the canvas moves the viewport (panning).
  - [x] Zooming centers on the mouse cursor unless initiated from UI buttons, which center on the visual midpoint.
  - **Implementation Note**:  
    Implemented in `client/js/canvas.js` with real-time rendering updates and transformations.

- **Live Collaboration**:

  - [x] Multiple users in the same session each have a labeled, color-coded icon.
  - [x] Cursor positions of connected users update in real time.
  - [x] Movement or modification of elements propagates to all users.
  - [x] Selections are unique—each user can select or “lock” an element. Locked elements cannot be moved by others.
  - **Implementation Note**:  
    Handled via WebSockets (`server/ws/`). Each user is assigned a color, and the server broadcasts cursor & element changes.

- **Floating UI Elements**:

  - [x] UI elements do not scale with canvas zoom.
  - [x] A floating zoom control UI (bottom-right corner) includes:
    - [x] Zoom percentage display (clickable for manual input is partially implemented).
    - [x] Zoom in/out buttons (+/-) in ~25% increments.
    - [x] A “frame all” button to fit selected elements into view with padding.
  - **Implementation Note**:  
    Implemented with DOM elements in `index.html` and zoom logic in `canvasCamera.js` / `canvas.js`, styled in `style.css`.

- **Tooltips & Tutorials**:

  - [ ] The system should support contextual tooltips or minimal tutorials for usability.
  - **Implementation Note**:  
    Not yet fully implemented beyond basic placeholders.

- **Additional Implemented Feature**:
  - [x] Shape rotation: users can rotate selected shapes via a rotation handle at the corner of the bounding box.

### User Management

- **User Accounts**:

  - [x] Users can register with an email and password.
  - [x] Passwords must be securely stored (via `bcryptjs`).
  - [ ] User preferences (like hotkeys) are planned for future storage.
  - [ ] Users can customize hotkeys (planned).
  - **Implementation Note**:  
    Login/registration routes exist in `auth.js`; user roles are stored in the `users` table.

- **Admin Features**:

  - [x] An admin panel allows user management (updating roles or deleting users).
  - [ ] The admin panel will provide analytics (session counts, user/project stats).
  - [ ] Exporting and importing projects is planned.
  - **Project Rollback** and versioning:
    - [x] Admins can roll back a project to previous saved versions (via `ProjectService.rollbackVersion()`).
    - [ ] If a rolled-back version is unavailable, users are pushed to a new session or receive a notification.
  - [ ] Deleting a project removes it from the database and should invalidate sessions that depend on it (the DB removal is done, session invalidation is not).
  - [ ] Admins can manually force-end older sessions if necessary.
  - **Implementation Note**:
    - Basic admin user management is in `admin.js`.
    - Rollback logic is in `ProjectService.rollbackVersion()`, but forcibly pushing users to new sessions is not fully automated.
    - Analytics and project import/export remain incomplete.

- **Additional Implemented Feature**:
  - [x] Owners or admins can kick users from a session (handled in `permissionHandlers.js`).

### Project & Session Management

- **Session Activity Tracking**:

  - [x] Each session has an activity queue enabling multi-step undo/redo.
  - [x] Undo/redo controls exist as floating UI elements (bottom-left).
  - [x] Project changes to elements (move, create, delete, resize, rotate) are undoable.
  - [x] The undo queue can store up to 50 steps, tracking user actions in order.
  - [ ] If a user disconnects, their undo/redo history should be restored if possible (currently not implemented).
  - **Implementation Note**:  
    Undo/redo logic is in `undoRedoHandlers.js` (server) and triggered by UI in `index.html`.

- **Session Persistence & Project Versioning**:

  - [ ] Sessions should persist with a unique, human-readable code.
  - [ ] Sessions tie explicitly to a project version (currently partial).
  - [ ] If an older project version is used, a popover should warn users.
  - [ ] Sessions can be reset to the last saved state.
  - [ ] Only changes from the original version are tracked until saved.
  - [ ] Session data must be minimal, storing only essential deltas.
  - [ ] Expired sessions remain until manually ended.
  - **Implementation Note**:
    - Project versioning in `project_versions` with rollback and incremental version numbers.
    - Sessions are ephemeral in memory via `SessionService.js`.
    - A more robust naming or persistence scheme is planned.

- **Project Ownership & Permissions**:

  - [x] Users can create, edit, and delete projects.
  - [ ] A project owner can assign permissions to others (beyond admin role) — not yet implemented.
  - [x] Only the owner or admin can delete a project.
  - [x] Only authorized users (owner/admin) can save changes.
  - **Implementation Note**:
    - Owner is tracked via `projects.owner_id`.
    - `ProjectService.userCanEditProject()` checks ownership/admin.

- **Project Loading & Saving**:

  - [x] The site allows opening existing projects or creating new ones (`projects.js`).
  - [x] A default project is automatically created for new users if none exists.
  - [ ] A project has a “saved” state, with changes tracked in sessions (partial).
  - [x] Version number auto-increments on save, older versions remain.
  - [ ] The admin interface should export/import projects and assets (planned).
  - [ ] Image assets persist with the oldest needed version (planned).
  - **Implementation Note**:
    - Creation/listing/saving is in `ProjectService.js` & `routes/projects.js`.
    - Import/export and advanced asset management remain unimplemented.

### Image & Asset Storage

- [ ] Images should be stored at full resolution but optimized for retrieval.
- [ ] Removing an image from a project should preserve it in older versions only.
- [ ] The system should avoid redundant storage by linking to the oldest needed version.
- **Implementation Note**:
  - Actual image uploads/storage are not yet implemented. DB tables are prepared for references, but further development is required.

---

## Real-Time Synchronization

- **Technology Considerations**:

  - [x] The platform uses WebSockets for real-time updates (see `ws/` folder).
  - [x] Latency is minimized by sending immediate local changes and broadcasting them.
  - [x] Some interactions can proceed client-side before server confirmation.
  - [ ] The session’s “owner” typically acts as a tie-breaker if conflicts arise (current logic uses element locking, not explicit owner tie-breaks).
  - [x] PostgreSQL is used for storing project data, with session states in memory.
  - **Implementation Note**:
    - Real-time message flows are in `messageDispatcher.js` plus `ws/handlers/`.
    - Conflict resolution beyond basic locking is still minimal.

---

## Additional Implemented Feature

- **Chat System**:
  - [x] A real-time chat feature is available; messages are broadcast to all users in the session (`chatHandlers.js`, `client/js/app.js`).
