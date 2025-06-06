export default {
  projects: [
    {
      displayName: "server",
      testEnvironment: "node",
      transform: {
        "^.+\\.[tj]s$": "babel-jest",
      },
      testMatch: [
        "<rootDir>/tests/unit/**/*.test.js",
        "<rootDir>/tests/integration/**/*.test.js",
      ],
    },
    {
      displayName: "client",
      testEnvironment: "jsdom",
      transform: {
        "^.+\\.[tj]s$": "babel-jest",
      },
      testMatch: ["<rootDir>/tests/client/**/*.test.js"],
      setupFiles: ["jest-canvas-mock"],
    },
  ],
};
