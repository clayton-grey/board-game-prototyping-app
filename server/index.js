// server/index.js
import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';

// CHANGED: We now import from server/ws/collaboration.js
import { handleWebSocketConnection } from './ws/collaboration.js';

import config from './config.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(express.json());
app.use(cors({ origin: '*' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static frontend files from `/client`
app.use(express.static(path.join(__dirname, '../client')));

// API Routes
app.use('/auth', authRoutes);
app.use('/projects', projectRoutes);

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// WebSocket handling
wss.on('connection', (ws) => handleWebSocketConnection(ws, wss));

// Start server
server.listen(config.PORT, () => {
  console.log(`Server running on port ${config.PORT}`);
});
