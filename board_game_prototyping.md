# Interactive Board Game Prototyping Environment Specification

## Purpose

This project aims to create an interactive board game prototyping environment that allows multiple users to collaborate in real time. Users will be able to connect to a shared session and interact with a full-screen canvas containing various virtual board game elements. The initial focus is to provide a flexible and interactive space for game design and testing, with potential future extensions to support game logic.

---

## Core Features

### Security
- All text input fields must have security precautions to prevent injection attacks.
- User authentication and data storage must adhere to industry-standard security practices.
- **Implementation Note**:  
  In the current code, JWT authentication is used (via `AuthService`) for secure routes, and user passwords are salted & hashed with `bcryptjs`.  

### Canvas & User Interaction

- **Scrollable & Zoomable Canvas**:
  - The canvas has a fixed center point and supports zooming.
  - Minimum and maximum zoom levels are configurable in code.
  - Clicking and dragging the canvas moves the viewport (panning).
  - Zooming centers on the mouse cursor unless initiated from UI buttons, which center on the visual midpoint.
  - **Implementation Note**:  
    This behavior exists in `client/js/canvas.js`, with real-time rendering updates and user-based transformations.

- **Live Collaboration**:
  - Multiple users in the same session each have a labeled, color-coded icon.
  - Cursor positions of connected users update in real time.
  - Movement or modification of elements propagates to all users.
  - Selections are unique—each user can select or “lock” an element. Locked elements cannot be moved by others.
  - **Implementation Note**:  
    This is handled via WebSockets (`ws/` folder). Each user is assigned a color, and the server broadcasts cursor & element changes.

- **Floating UI Elements**:
  - UI elements do not scale with canvas zoom.
  - A floating zoom control UI (bottom-right corner) includes:
    - Zoom percentage display (clickable for manual input, not fully implemented yet in the final UI).
    - Zoom in/out buttons (+/-) in 25% increments.
    - A “frame all” button to fit selected elements into view with padding.
  - **Implementation Note**:  
    Implemented in `index.html` and `canvas.js`, with styles in `style.css`.

- **Tooltips & Tutorials**:
  - The system should support contextual tooltips or minimal tutorials for usability.
  - **Implementation Note**:  
    Tooltips are not yet fully implemented—some placeholders exist in the UI, but a robust help/tutorial system is still planned.

### User Management

- **User Accounts**:
  - Users can register with an email and password.
  - Passwords must be securely stored (currently done via `bcryptjs`).
  - User preferences (like hotkeys) are planned for future storage.
  - Users can customize hotkeys (planned).
  - **Implementation Note**:  
    Login/registration routes exist (`auth.js`), with roles stored in the `users` table.

- **Admin Features**:
  - An admin panel allows user management (updating roles or deleting users).
  - The admin panel will provide analytics (session counts, user/project stats).
  - Exporting and importing projects is planned.
  - **Project Rollback** and versioning:
    - Admins can roll back a project to previous saved versions.
    - If a rolled-back version is unavailable, users are pushed to a new session or receive a notification.
  - Deleting a project removes it from the database and should invalidate sessions that depend on it.
  - Admins can manually force-end older sessions if necessary.
  - **Implementation Note**:
    - Basic admin user management is in `admin.js`.
    - Project rollback logic exists in `ProjectService.rollbackVersion()`, though forcibly pushing users to new sessions is not fully automated yet.
    - Analytics and project import/export remain to be completed.

### Project & Session Management

- **Session Activity Tracking**:
  - Each session should have an activity queue to enable multi-step undo/redo.
  - Undo/redo controls as floating UI elements.
  - All project changes to elements should be undoable.
  - The undo queue should store 40 steps, tracking user actions in order.
  - If a user disconnects, their undo/redo history should be restored if possible.
  - **Implementation Note**:  
    Undo/redo is **not yet** implemented. The current code tracks real-time moves but does not store a local or server-based undo stack.

- **Session Persistence & Project Versioning**:
  - Sessions should persist, each having a unique, human-readable code (e.g., “SilverPeregrinFolly”).
  - Sessions tie explicitly to a project version.
  - If an older project version is used, a popover should warn users.
  - Sessions can be reset to the last saved state.
  - Only changes from the original version should be tracked until saved.
  - Session data must be minimal, only storing essential deltas.
  - Expired sessions remain until manually ended if needed.
  - **Implementation Note**:  
    - Project versioning is implemented in the `project_versions` table, with rollback and version-number increments.  
    - Sessions are partially in-memory (`SessionService.js`) and do not yet fully integrate with the database for automatic expiration or partial deltas.  
    - A basic ephemeral session code approach is used; a more robust naming scheme is still planned.

- **Project Ownership & Permissions**:
  - Users can create, edit, and delete projects.
  - A project owner can assign permissions to others.
  - Only the owner or admin can delete a project.
  - Only authorized users can save changes.
  - **Implementation Note**:  
    - Owner is tracked via `projects.owner_id`.  
    - A basic user permission check is in `ProjectService.userCanEditProject()`.  

- **Project Loading & Saving**:
  - The site should allow opening existing projects or creating new ones.
  - A default project is automatically created for new users if none exists.
  - A project has a “saved” state, with changes tracked in sessions.
  - Version number auto-increments on save, and older versions remain for restoration.
  - The admin interface should export/import projects and assets.
  - Image assets persist with the oldest needed version.
  - **Implementation Note**:
    - Project creation, listing, and version saving exist in `projects.js` and `ProjectService.js`.
    - Import/export and advanced asset management are forthcoming.

### Image & Asset Storage

- Images should be stored at full resolution but optimized for retrieval.
- Removing an image from a project should preserve it in older versions only.
- The system should avoid redundant storage by linking to the oldest needed version.
- **Implementation Note**:
  - Actual image upload/storage is **not** yet implemented. The database is prepared for asset references, but further development is required.

---

## Real-Time Synchronization

- **Technology Considerations**:
  - The platform uses WebSockets for real-time updates (see `ws/` folder).
  - Latency is minimized by sending immediate local changes and broadcasting them.
  - Some interactions can proceed client-side before server confirmation.
  - The session’s “owner” typically acts as a tie-breaker if conflicts arise.
  - PostgreSQL is used for storing project data, with session states in memory.
  - **Implementation Note**:
    - Real-time message flows are in `messageDispatcher.js` and handlers under `ws/handlers/`.
    - Conflict resolution beyond simple locking is left for future improvements.
