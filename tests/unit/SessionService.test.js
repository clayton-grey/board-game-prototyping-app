// tests/unit/SessionService.test.js
import { SessionService } from "../../server/services/SessionService.js";
import { Session } from "../../server/services/Session.js";

describe("SessionService", () => {
  beforeEach(() => {
    // Clear the sessionMap by removing known sessions
    SessionService.removeSession("test-code-1");
    SessionService.removeSession("test-code-2");
  });

  test("getOrCreateSession creates a new Session instance", () => {
    const s = SessionService.getSession("test-code-1");
    expect(s).toBeNull();

    const created = SessionService.getOrCreateSession("test-code-1");
    expect(created).toBeInstanceOf(Session);

    const again = SessionService.getSession("test-code-1");
    expect(again).toBe(created);
  });

  test("removeSession deletes from the map", () => {
    const s = SessionService.getOrCreateSession("test-code-2");
    expect(SessionService.getSession("test-code-2")).toBe(s);

    SessionService.removeSession("test-code-2");
    expect(SessionService.getSession("test-code-2")).toBeNull();
  });
});
