// server/utils/asyncHandler.js

/**
 * A higher-order function to wrap async route handlers, 
 * automatically passing errors to next() for the global error handler.
 */

export function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
