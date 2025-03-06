// tests/integration/wsCollaboration.test.js

/**
 * ./tests/integration/wsCollaboration.test.js
 * This tests real-time collaboration over WS.
 *
 * We also close the DB pool in afterAll to avoid open handles.
 */
import { createServer } from "http";
import request from "supertest";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import app from "../../server/app.js";
import { handleWebSocketConnection } from "../../server/ws/collaboration.js";
import { closeDBPool } from "./testUtils.js";

jest.setTimeout(30000);

describe("WebSocket Collaboration Integration Test", () => {
  let server, wss, port;
  let client1, client2;
  let sessionCode;

  beforeAll((done) => {
    server = createServer(app);
    wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => handleWebSocketConnection(ws, wss));
    server.listen(0, () => {
      port = server.address().port;
      // ephemeral session code
      sessionCode = `testWS_${Date.now()}`;
      done();
    });
  });

  afterAll(async () => {
    // Clean up websockets if still open
    if (client1 && client1.readyState === WebSocket.OPEN) client1.close();
    if (client2 && client2.readyState === WebSocket.OPEN) client2.close();
    server.close();

    // Also close DB pool
    await closeDBPool();
  });

  test("HTTP server is up => GET / responds 200", async () => {
    const res = await request(server).get("/");
    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/<title>Board Game Prototyping<\/title>/);
  });

  test("Two WS clients => concurrency scenario", (done) => {
    const messagesClient1 = [];
    const messagesClient2 = [];

    client1 = new WebSocket(`ws://localhost:${port}`);
    client2 = new WebSocket(`ws://localhost:${port}`);

    function handleIncoming(wsName, msgStr, storage) {
      try {
        const data = JSON.parse(msgStr);
        storage.push(data);
      } catch (err) {
        console.error(wsName, "parse error:", err, msgStr);
      }
    }

    let step = 0;

    // Connect + join session
    client1.on("open", () => {
      client1.send(
        JSON.stringify({
          type: "join-session",
          userId: "testUser1",
          sessionCode,
          name: "UserOne",
          userRole: "admin",
        }),
      );
    });
    client2.on("open", () => {
      client2.send(
        JSON.stringify({
          type: "join-session",
          userId: "testUser2",
          sessionCode,
          name: "UserTwo",
          userRole: "admin",
        }),
      );
    });

    client1.on("message", (raw) => {
      handleIncoming("client1", raw, messagesClient1);
      proceedIfReady();
    });
    client2.on("message", (raw) => {
      handleIncoming("client2", raw, messagesClient2);
      proceedIfReady();
    });

    function lockedBy(msg, elementId, locker) {
      return (
        msg.type === "element-state" &&
        msg.elements?.some((e) => e.id === elementId && e.lockedBy === locker)
      );
    }

    function atPosition(msg, elementId, x, y) {
      return (
        msg.type === "element-state" &&
        msg.elements?.some((e) => e.id === elementId && e.x === x && e.y === y)
      );
    }

    function lastElemState(msgs) {
      return [...msgs].reverse().find((m) => m.type === "element-state");
    }

    function proceedIfReady() {
      if (step === 0) {
        // Wait until each client has at least 2 inbound messages
        if (messagesClient1.length >= 2 && messagesClient2.length >= 2) {
          step = 1;
          client1.send(
            JSON.stringify({
              type: "element-grab",
              userId: "testUser1",
              elementId: 1,
            }),
          );
        }
      } else if (step === 1) {
        // Wait for both to see lockedBy='testUser1' for element #1
        const c1HasLock = messagesClient1.some((m) =>
          lockedBy(m, 1, "testUser1"),
        );
        const c2HasLock = messagesClient2.some((m) =>
          lockedBy(m, 1, "testUser1"),
        );
        if (c1HasLock && c2HasLock) {
          step = 2;
          // Move the locked element to (500,300)
          client1.send(
            JSON.stringify({
              type: "element-move",
              userId: "testUser1",
              elementId: 1,
              x: 500,
              y: 300,
            }),
          );
        }
      } else if (step === 2) {
        // Wait until each sees element #1 at (500,300)
        const c1HasMove = messagesClient1.some((m) =>
          atPosition(m, 1, 500, 300),
        );
        const c2HasMove = messagesClient2.some((m) =>
          atPosition(m, 1, 500, 300),
        );
        if (c1HasMove && c2HasMove) {
          step = 3;
          // user2 tries to move same => locked => ignore
          client2.send(
            JSON.stringify({
              type: "element-move",
              userId: "testUser2",
              elementId: 1,
              x: 999,
              y: 999,
            }),
          );
          // No new broadcast from server expected => finalize
          setTimeout(() => {
            const lastStateC2 = lastElemState(messagesClient2);
            if (lastStateC2) {
              const el = lastStateC2.elements.find((e) => e.id === 1);
              expect(el.x).toBe(500);
              expect(el.y).toBe(300);
            }
            done();
          }, 200);
        }
      }
    }
  });
});
