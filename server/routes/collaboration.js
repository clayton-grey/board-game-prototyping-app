import { WebSocketServer } from 'ws';

let activeSessions = {};

const setupWebSocket = (server) => {
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
        console.log('New WebSocket connection');

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === 'join-session') {
                    if (!activeSessions[data.sessionId]) {
                        activeSessions[data.sessionId] = new Set();
                    }
                    activeSessions[data.sessionId].add(ws);
                    console.log(`User joined session ${data.sessionId}`);
                } else if (data.type === 'canvas-update') {
                    if (activeSessions[data.sessionId]) {
                        activeSessions[data.sessionId].forEach(client => {
                            if (client !== ws && client.readyState === ws.OPEN) {
                                client.send(JSON.stringify({ type: 'canvas-update', data: data.data }));
                            }
                        });
                    }
                }
            } catch (error) {
                console.error('Error handling message:', error);
            }
        });

        ws.on('close', () => {
            Object.keys(activeSessions).forEach(sessionId => {
                activeSessions[sessionId].delete(ws);
                if (activeSessions[sessionId].size === 0) {
                    delete activeSessions[sessionId];
                }
            });
            console.log('WebSocket disconnected');
        });
    });
};

export default setupWebSocket;
