// ./shared/wsMessageTypes.js

export const MESSAGE_TYPES = {
  JOIN_SESSION: 'join-session',
  CURSOR_UPDATE: 'cursor-update',
  CURSOR_UPDATES: 'cursor-updates',

  ELEMENT_GRAB: 'element-grab',
  ELEMENT_MOVE: 'element-move',
  ELEMENT_RELEASE: 'element-release',
  ELEMENT_STATE: 'element-state',

  ELEMENT_DESELECT: 'element-deselect',
  ELEMENT_CREATE: 'element-create',
  ELEMENT_DELETE: 'element-delete',

  ELEMENT_RESIZE: 'element-resize',

  PROJECT_NAME_CHANGE: 'project-name-change',
  SESSION_USERS: 'session-users',
  UPGRADE_USER_ID: 'upgrade-user-id',

  MAKE_EDITOR: 'make-editor',
  REMOVE_EDITOR: 'remove-editor',
  KICK_USER: 'kick-user',
  KICKED: 'kicked',

  UNDO: 'undo',
  REDO: 'redo',
  UNDO_REDO_FAILED: 'undo-redo-failed',

  CHAT_MESSAGE: 'chat-message',
};
