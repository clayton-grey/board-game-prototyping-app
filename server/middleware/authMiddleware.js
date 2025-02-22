// server/middleware/authMiddleware.js
import { AuthService } from '../services/AuthService.js';
import config from '../config.js';

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  try {
    const user = AuthService.verifyToken(token); 
    // If verify succeeds, user is the decoded payload
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Forbidden: Invalid token" });
  }
};

export const authorizeAdmin = (req, res, next) => {
  // Simple admin check
  if (req.user && req.user.role === "admin") {
    return next();
  }
  return res.status(403).json({ message: "Access denied. Admins only." });
};
