// tests/unit/collabUtils.test.js
import {
  broadcastToSession,
  broadcastElementState,
  broadcastUserList,
} from "../../server/ws/collabUtils.js";
import { WebSocket } from "ws";
import { MESSAGE_TYPES } from "../../shared/wsMessageTypes.js";

jest.mock("ws", () => {
  const MockWebSocket = jest.fn().mockImplementation(() => ({
    readyState: 1,
    send: jest.fn((msg, cb) => {
      if (cb) cb(); // mimic behavior
    }),
  }));
  MockWebSocket.OPEN = 1;
  return { WebSocket: MockWebSocket };
});

describe("collabUtils", () => {
  let mockSession;

  beforeEach(() => {
    mockSession = {
      code: "test-session",
      projectName: "TestProject",
      elements: [{ id: 1, x: 10, y: 10, w: 50, h: 50, lockedBy: null }],
      users: new Map(),
    };
    const user1Socket = new WebSocket();
    const user2Socket = new WebSocket();
    // user1 => 'owner', user2 => 'viewer'
    mockSession.users.set("user1", {
      userId: "user1",
      socket: user1Socket,
      name: "UserOne",
      color: "#123",
      sessionRole: "owner",
      globalRole: "user",
      joinOrder: 1,
    });
    mockSession.users.set("user2", {
      userId: "user2",
      socket: user2Socket,
      name: "UserTwo",
      color: "#456",
      sessionRole: "viewer",
      globalRole: "admin",
      joinOrder: 2,
    });
  });

  test("broadcastToSession sends stringified data to all connected user sockets", () => {
    broadcastToSession(mockSession, { type: "TEST_MESSAGE", hello: "world" });

    for (const user of mockSession.users.values()) {
      expect(user.socket.send).toHaveBeenCalledTimes(1);
      const sentMsg = user.socket.send.mock.calls[0][0];
      expect(JSON.parse(sentMsg)).toMatchObject({
        type: "TEST_MESSAGE",
        hello: "world",
      });
    }
  });

  test("broadcastElementState sends ELEMENT_STATE with elements & projectName", () => {
    broadcastElementState(mockSession);

    for (const user of mockSession.users.values()) {
      expect(user.socket.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(user.socket.send.mock.calls[0][0]);
      expect(msg.type).toBe(MESSAGE_TYPES.ELEMENT_STATE);
      expect(msg.elements).toEqual(mockSession.elements);
      expect(msg.projectName).toBe(mockSession.projectName);
    }
  });

  test("broadcastUserList sends SESSION_USERS array with sessionRole & globalRole, no ownerUserId", () => {
    broadcastUserList(mockSession);

    for (const user of mockSession.users.values()) {
      expect(user.socket.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(user.socket.send.mock.calls[0][0]);
      expect(msg.type).toBe(MESSAGE_TYPES.SESSION_USERS);

      expect(Array.isArray(msg.users)).toBe(true);
      expect(msg.users.length).toBe(2);

      // user1 => sessionRole='owner'
      const u1 = msg.users.find((u) => u.userId === "user1");
      expect(u1.sessionRole).toBe("owner");
      expect(u1.globalRole).toBe("user");

      // user2 => sessionRole='viewer', globalRole='admin'
      const u2 = msg.users.find((u) => u.userId === "user2");
      expect(u2.sessionRole).toBe("viewer");
      expect(u2.globalRole).toBe("admin");

      // We do NOT send an 'ownerUserId' property anymore
      expect(msg).not.toHaveProperty("ownerUserId");
    }
  });

  test("broadcastToSession does nothing if user socket is missing or not open", () => {
    // user2 => no socket
    mockSession.users.get("user2").socket = null;
    // user1 => closed
    mockSession.users.get("user1").socket.readyState = 3; // CLOSED

    broadcastToSession(mockSession, { type: "ANY" });

    for (const user of mockSession.users.values()) {
      if (!user.socket) continue;
      expect(user.socket.send).not.toHaveBeenCalled();
    }
  });
});
