// server/ws/handlers/handlerUtils.js

/**
 * sessionGuard(fn) => returns a handler that only runs if `session` is truthy.
 * This avoids repeating `if (!session) return;` in each handler.
 */
export function sessionGuard(fn) {
  return function (session, data, ws) {
    if (!session) return;
    return fn(session, data, ws);
  };
}
