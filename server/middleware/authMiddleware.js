// server/middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import config from "../config.js";

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  jwt.verify(token, config.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Forbidden: Invalid token" });
    }
    req.user = user; // Ensure user data is attached
    next();
  });
};

export const authorizeAdmin = (req, res, next) => {
  // Simple admin check (replace with actual logic)
  if (req.user && req.user.role === "admin") {
    return next();
  }
  return res.status(403).json({ message: "Access denied. Admins only." });
};
