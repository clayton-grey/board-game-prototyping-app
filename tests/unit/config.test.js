// tests/unit/config.test.js
describe('config.js under NODE_ENV=test', () => {
  let originalEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('Node environment is pinned to test => DB_NAME forced; DB_USER, etc. come from env', () => {
    process.env.NODE_ENV = 'test';
    // Suppose .env.test or Docker sets DB_USER=admin, DB_PASSWORD=whatever

    jest.resetModules();
    const config = require('../../server/config.js').default;

    // DB_NAME forced to test
    expect(config.DB_NAME).toBe('board_game_prototyping_test');

    // DB_USER might be 'admin' if your .env.test says so:
    expect(config.DB_USER).toBe('admin');

    // If DB_PASSWORD is set in .env.test as well, we confirm that:
    // expect(config.DB_PASSWORD).toBe('mySecretPassword');

    // If DB_SSL is 'true', then:
    // expect(config.DB_SSL).toBe(true);

    // Or you can do partial checks if you're not sure
  });
});
