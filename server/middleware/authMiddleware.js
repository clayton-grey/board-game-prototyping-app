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
    // user now has { id, email, isAdmin, name } from the token
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Forbidden: Invalid token" });
  }
};

export const authorizeAdmin = (req, res, next) => {
  // Now checking isAdmin instead of role==='admin'
  if (req.user && req.user.isAdmin) {
    return next();
  }
  return res.status(403).json({ message: "Access denied. Admins only." });
};
