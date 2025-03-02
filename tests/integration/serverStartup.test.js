// tests/integration/serverStartup.test.js

import request from 'supertest';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import app from '../../server/app.js';
import { handleWebSocketConnection } from '../../server/ws/collaboration.js';

describe('Server Startup Integration Test', () => {
  let server;

  beforeAll((done) => {
    // Create an HTTP server from the Express app
    server = createServer(app);

    // Create a WebSocket server on top of the same HTTP server
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws) => handleWebSocketConnection(ws, wss));

    // Listen on ephemeral port 0 => OS picks a random available port
    server.listen(0, () => {
      done();
    });
  });

  afterAll((done) => {
    // Gracefully shut down
    server.close(done);
  });

  test('responds with HTML at /', async () => {
    const res = await request(server).get('/');
    expect(res.statusCode).toBe(200);
    // We expect the HTML from index.html or some default text
    expect(res.text).toMatch(/<title>Board Game Prototyping<\/title>/);
  });
});
