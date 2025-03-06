// tests/unit/projectHandlers.test.js
import { handleProjectNameChange } from "../../server/ws/handlers/projectHandlers.js";
import {
  broadcastToSession,
  broadcastElementState,
} from "../../server/ws/collabUtils.js";
import { MESSAGE_TYPES } from "../../shared/wsMessageTypes.js";

jest.mock("../../server/ws/collabUtils.js", () => ({
  broadcastToSession: jest.fn(),
  broadcastElementState: jest.fn(),
}));

describe("projectHandlers", () => {
  let mockSession, mockWs;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWs = { send: jest.fn() };
    mockSession = {
      code: "proj-test",
      projectName: "Old Name",
      users: new Map(),
      elements: [],
    };
  });

  test("handleProjectNameChange => sets session.projectName, broadcasts if user isOwner", () => {
    // previously had: user = { userId: 'owner1', isOwner: true }
    const user = { userId: "owner1", sessionRole: "owner", globalRole: "user" };
    mockSession.users.set("owner1", user);

    const data = { userId: "owner1", newName: "NewProjectName" };
    handleProjectNameChange(mockSession, data, mockWs);

    expect(mockSession.projectName).toBe("NewProjectName");
    expect(broadcastToSession).toHaveBeenCalledWith(mockSession, {
      type: MESSAGE_TYPES.PROJECT_NAME_CHANGE,
      newName: "NewProjectName",
    });
    expect(broadcastElementState).toHaveBeenCalledWith(mockSession);
  });

  test("handleProjectNameChange => sets session.projectName, broadcasts if user isAdmin", () => {
    // previously had: user = { userId: 'admin1', isAdmin: true }
    const adminUser = {
      userId: "admin1",
      sessionRole: "viewer",
      globalRole: "admin",
    };
    mockSession.users.set("admin1", adminUser);

    const data = { userId: "admin1", newName: "AdminRenamedIt" };
    handleProjectNameChange(mockSession, data, mockWs);

    expect(mockSession.projectName).toBe("AdminRenamedIt");
    expect(broadcastToSession).toHaveBeenCalled();
    expect(broadcastElementState).toHaveBeenCalled();
  });

  test("handleProjectNameChange => does nothing if user is normal user", () => {
    const user2 = {
      userId: "user2",
      sessionRole: "viewer",
      globalRole: "user",
    };
    mockSession.users.set("user2", user2);

    const data = { userId: "user2", newName: "Nope" };
    handleProjectNameChange(mockSession, data, mockWs);

    expect(mockSession.projectName).toBe("Old Name");
    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(broadcastElementState).not.toHaveBeenCalled();
  });

  test("handleProjectNameChange => does nothing if no newName or userId", () => {
    handleProjectNameChange(mockSession, {}, mockWs);
    expect(mockSession.projectName).toBe("Old Name");
    expect(broadcastToSession).not.toHaveBeenCalled();
  });

  test("handleProjectNameChange => does nothing if session is null", () => {
    handleProjectNameChange(null, { userId: "owner1", newName: "X" }, mockWs);
    expect(broadcastToSession).not.toHaveBeenCalled();
  });
});
