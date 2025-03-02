// server/utils/Permissions.js

/**
 * We unify how we check "isAdmin", "isOwner", etc.
 * In the ephemeral session user object, we now store:
 *   user.globalRole = 'admin' | 'user'
 *   user.sessionRole = 'owner' | 'editor' | 'viewer'
 *
 * isAdmin is determined by user.globalRole === 'admin'.
 * isOwner is sessionRole === 'owner'.
 * isEditor is sessionRole === 'editor' OR 'owner' (owner implicitly can edit).
 */

export function isAdmin(user) {
  return user.globalRole === 'admin';
}

export function isOwner(user) {
  return user.sessionRole === 'owner';
}

export function isEditor(user) {
  // Let's treat "owner" as at least "editor" level in session
  return user.sessionRole === 'editor' || user.sessionRole === 'owner';
}

export function isViewer(user) {
  return user.sessionRole === 'viewer';
}

/**
 * canManageOthers => global admin or session owner
 */
export function canManageOthers(user) {
  return isAdmin(user) || isOwner(user);
}

/**
 * canKickUser => only if kicker canManage, and target is not an admin or owner
 */
export function canKickUser(kicker, target) {
  if (!canManageOthers(kicker)) return false;
  if (isAdmin(target)) return false;
  if (isOwner(target)) return false;
  return true;
}

/**
 * canRenameProject => if user is admin or session owner
 */
export function canRenameProject(user) {
  return canManageOthers(user);
}

/**
 * canEditProject => if user is admin or session owner or session editor
 */
export function canEditProject(user) {
  // For ephemeral session-based editing, we interpret "editor" as well
  // But you can customize as you see fit.
  return isAdmin(user) || isOwner(user) || isEditor(user);
}
