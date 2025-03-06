// tests/unit/handlerUtils.test.js
import { sessionGuard } from "../../server/ws/handlers/handlerUtils.js";

describe("handlerUtils - sessionGuard", () => {
  test("returns immediately if session is falsy", () => {
    const mockFn = jest.fn();
    const guardedFn = sessionGuard(mockFn);

    guardedFn(
      null,
      { some: "data" },
      {
        /* mockWs */
      },
    );
    expect(mockFn).not.toHaveBeenCalled();

    guardedFn(undefined, { some: "data" }, {});
    expect(mockFn).not.toHaveBeenCalled();
  });

  test("calls the wrapped function if session is truthy", () => {
    const mockFn = jest.fn();
    const guardedFn = sessionGuard(mockFn);

    const fakeSession = { code: "test-session" };
    const fakeData = { type: "example" };
    const fakeWs = { readyState: 1 };

    guardedFn(fakeSession, fakeData, fakeWs);
    expect(mockFn).toHaveBeenCalledWith(fakeSession, fakeData, fakeWs);
  });

  test("returns whatever the wrapped function returns", () => {
    const mockFn = jest.fn().mockReturnValue("someValue");
    const guardedFn = sessionGuard(mockFn);

    const out = guardedFn({ code: "test" }, {}, {});
    expect(out).toBe("someValue");
  });
});
