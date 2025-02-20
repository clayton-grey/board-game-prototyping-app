import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const activeUsers = new Map();

// Middleware
app.use(express.json());
app.use(cors({ origin: "*" }));

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve Static Frontend Files from `/client`
app.use(express.static(path.join(__dirname, "../client")));

// API Routes
app.use("/auth", authRoutes);
app.use("/projects", projectRoutes);

// Serve `index.html` for the root route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

// WebSocket Connection Handling
wss.on("connection", (ws) => {
  console.log("New WebSocket connection");

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "cursor-update") {
        // Store user cursor position and track socket reference
        activeUsers.set(data.userId, { x: data.x, y: data.y, socket: ws });

        // Broadcast updated cursor positions to all clients
        const cursorData = {
          type: "cursor-updates",
          cursors: Object.fromEntries(
            [...activeUsers].map(([userId, { x, y }]) => [userId, { x, y }])
          )
        };

        wss.clients.forEach(client => {
          if (client.readyState === ws.OPEN) {
            client.send(JSON.stringify(cursorData));
          }
        });
      }
    } catch (error) {
      console.error("WebSocket JSON Parse Error:", error.message);
    }
  });

  ws.on("close", () => {
    console.log("WebSocket disconnected");

    // Remove user from activeUsers when they disconnect
    for (const [userId, userData] of activeUsers.entries()) {
      if (userData.socket === ws) {
        activeUsers.delete(userId);
      }
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
