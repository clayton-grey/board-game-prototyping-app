export default {
  coverageProvider: 'babel',
  collectCoverage: true,
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/client/',
  ],
  projects: [
    {
      displayName: 'server',
      testEnvironment: 'node',
      transform: {
        '^.+\\.[tj]s$': 'babel-jest'
      },
      testMatch: [
        '<rootDir>/tests/unit/**/*.test.js',
        '<rootDir>/tests/integration/**/*.test.js'
      ]
    },
    {
      displayName: 'client',
      collectCoverage: false,
      testEnvironment: 'jsdom',
      transform: {
        '^.+\\.[tj]s$': 'babel-jest'
      },
      testMatch: ['<rootDir>/tests/client/**/*.test.js'],
      setupFiles: ['jest-canvas-mock'],
      setupFilesAfterEnv: ['@testing-library/jest-dom']
    }
  ]
};
