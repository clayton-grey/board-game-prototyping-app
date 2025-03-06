// server/index.js
import http from "http";
import { WebSocketServer } from "ws";
import app from "./app.js";
import { handleWebSocketConnection } from "./ws/collaboration.js";
import config from "./config.js";

// Create an HTTP server from the Express app
const server = http.createServer(app);

// Create a WebSocket server on top of the same HTTP server
const wss = new WebSocketServer({ server });

// Handle new WebSocket connections
wss.on("connection", (ws) => handleWebSocketConnection(ws, wss));

// Finally, start listening on the configured port
server.listen(config.PORT, () => {
  console.log(`Server running on port ${config.PORT}`);
});
