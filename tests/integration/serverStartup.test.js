// tests/integration/serverStartup.test.js

import request from 'supertest';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import app from '../../server/app.js';
import { handleWebSocketConnection } from '../../server/ws/collaboration.js';
import { closeDBPool } from './testUtils.js';

describe('Server Startup Integration Test', () => {
  let server;

  beforeAll((done) => {
    server = createServer(app);
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws) => handleWebSocketConnection(ws, wss));
    server.listen(0, done);
  });

  afterAll(async () => {
    server.close();
    await closeDBPool();
  });

  test('responds with HTML at /', async () => {
    const res = await request(server).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/<title>Board Game Prototyping<\/title>/);
  });
});
