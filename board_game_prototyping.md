
# Interactive Board Game Prototyping Environment Specification

## Purpose

This project aims to create an interactive board game prototyping environment that allows multiple users to collaborate in real time. Users will be able to connect to a shared session and interact with a full-screen canvas containing various virtual board game elements. The initial focus is to provide a flexible and interactive space for game design and testing, with potential future extensions to support game logic.

---

## Core Features

### Security

- All text input fields must have security precautions to prevent injection attacks.
- User authentication and data storage must adhere to industry-standard security practices.

### Canvas & User Interaction

- **Scrollable & Zoomable Canvas**:
  - The canvas has a fixed center point and supports zooming.
  - Minimum and maximum zoom levels should be configurable.
  - Clicking and dragging the canvas should move the viewport.
  - Zooming should center on the mouse cursor unless initiated from the UI, which centers on the current visual center.

- **Live Collaboration**:
  - Users in the same session should see a labeled and color-coded icon representing each connected user.
  - The cursor positions of connected users should update in real time.
  - Any movement or modification of elements should propagate instantly to all users.
  - Selection of elements should be unique, meaning each user can only select one element at a time.

- **Floating UI Elements**:
  - UI elements do not scale with canvas zoom.
  - A floating zoom control UI (bottom-right corner with configurable padding) should include:
    - A zoom percentage display (clickable for manual input).
    - Zoom in/out buttons (+/-) in 25% increments.
    - A button to frame all selected elements with a configurable padding.

- **Tooltips & Tutorials**:
  - The system should support tooltips and tutorials for better usability.

### User Management

- **User Accounts**:
  - Users can register with an email and password.
  - Passwords must be securely stored.
  - User preferences (e.g., hotkey settings) should be saved.
  - Users can customize hotkeys.

- **Admin Features**:
  - An admin panel should allow user management (updating user information and permissions).
  - The admin panel should provide analytics including:
    - Active session counts over time.
    - Total sessions created.
    - Per-user session and project statistics.
  - The admin panel should support exporting and importing projects.
  - Importing a project should make it the active version of a project by name.
  - Admin users should have the ability to roll back a project to previous saved versions.
  - If an admin rolls back a project to a previous version that is no longer available, users should be pushed to a new session and notified via a message. If the project is updated to a new version, users will receive a pop-up notification but can continue their session until they reload.
  - Admin users should be able to delete projects.
  - Deleting a project should prevent users from opening any session that uses it. Users attempting to access a session associated with a deleted project should be presented with a popover notification and redirected to a new session using the most recent project version.
  - When a session becomes invalid due to project deletion, all related session data, including expired image assets, should be removed as part of the project update and deletion processes.
  - Admins should have the ability to manually force the end of older sessions if necessary.

### Project & Session Management

- **Session Activity Tracking**:
  - Each session should have an activity queue to enable multi-step undo/redo.
  - Undo/redo controls should be available as floating UI elements.
  - All project changes to elements should be undoable.
  - The undo queue should store 40 steps per session.
  - Undo steps are session-specific and must track all user actions in order.
  - If a user disconnects and reconnects, their undo/redo history should be restored if possible.

- **Session Persistence & Project Versioning**:
  - Sessions should persist and have a unique, human-readable code (e.g., "SilverPeregrinFolly").
  - Sessions should be explicitly tied to a project version.
  - If a session is using an older version of a project, a popover should notify users that they are working with an outdated version, providing an option to update or continue with the existing version.
  - Sessions can be reset back to the last saved project state with a confirmation step.
  - Only changes from the original project version should be tracked until they are saved.
  - Session data should be efficiently managed, tracking only moved, flipped, or modified elements to minimize storage needs.
  - If a session expires due to inactivity, it should persist until manually ended by an admin if necessary.

- **Project Ownership & Permissions**:
  - Users can create, edit, and delete projects.
  - A project owner can assign permissions to other users.
  - Only the owner or admin can delete a project.
  - Only authorized users can save changes.

- **Project Loading & Saving**:
  - The site should support opening an existing project or creating a new one.
  - A default project can be configured.
  - A project has a **"saved"** state, with changes tracked in the session.
  - The project should have a version number that auto-increments on save.
  - A full copy of each previous version should be stored for restoration.
  - The admin interface should support exporting and importing projects, including all image assets.
  - Image assets should persist with the oldest available project version unless explicitly deleted.

### Image & Asset Storage

- Images should be stored at full resolution but optimized for efficient retrieval.
- When an image is removed from a project, it should persist only as long as it exists in at least one active version.
- The system should avoid redundant storage by linking assets to the oldest necessary version of a project.

---

## Real-Time Synchronization

- **Technology Considerations**:
  - The platform should use a market-preferred real-time technology (e.g., WebSockets) but can explore options based on trade-offs.
  - The latency for interactions like moving elements and cursor location should be minimized.
  - Some interactions can resolve client-side after receiving server confirmation.
  - The session host (player who starts the session) should act as the source of truth in case of conflicts.
  - PostgreSQL should be used for persistent storage.
