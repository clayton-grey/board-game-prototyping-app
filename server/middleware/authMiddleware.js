// =========================
// FILE: server/middleware/authMiddleware.js
// =========================

import { AuthService } from "../services/AuthService.js";

/**
 * authenticateToken
 *  - If no token => 401, if invalid => 403,
 *  - else sets req.user and calls next().
 */
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    // Your unit test expects res.status(401)
    res.status(401).json({ message: "Unauthorized: No token provided" });
    return;
  }

  try {
    const user = AuthService.verifyToken(token);
    req.user = user;
    next();
  } catch (err) {
    // Your unit test expects res.status(403)
    res.status(403).json({ message: "Forbidden: Invalid token" });
  }
};

/**
 * authorizeAdmin
 *  - If req.user.isAdmin is not true => 403
 *  - else next()
 */
export const authorizeAdmin = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    return next();
  }
  // Again, your test expects direct res calls
  res.status(403).json({ message: "Access denied. Admins only." });
};
