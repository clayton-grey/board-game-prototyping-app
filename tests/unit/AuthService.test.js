// tests/unit/AuthService.test.js
import { AuthService } from '../../server/services/AuthService.js';
import config from '../../server/config.js';
import jwt from 'jsonwebtoken';

jest.mock('../../server/config.js', () => {
  return {
    __esModule: true,
    default: {
      JWT_SECRET: 'test_secret_key',
    },
  };
});

describe('AuthService', () => {
  afterAll(() => {
    jest.restoreAllMocks();
  });

  test('userPayload returns a minimal payload object', () => {
    const mockUser = {
      id: 123,
      email: 'user@example.com',
      role: 'admin',
      name: 'Alice',
      password: 'hashed_pass',
    };

    const payload = AuthService.userPayload(mockUser);
    expect(payload).toEqual({
      id: 123,
      email: 'user@example.com',
      role: 'admin',
      name: 'Alice',
      isAdmin: true,
    });
  });

  test('createToken creates a JWT string', () => {
    const payload = { id: 1, email: 'test@example.com' };
    const token = AuthService.createToken(payload, '1h');
    expect(typeof token).toBe('string');
    // Basic check: it should have three parts separated by '.'
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });

  test('verifyToken returns the decoded payload if valid', () => {
    const payload = { id: 999, email: 'verify@test.com' };
    const token = AuthService.createToken(payload, '1h');

    // Should decode to the same data
    const decoded = AuthService.verifyToken(token);
    expect(decoded.id).toBe(999);
    expect(decoded.email).toBe('verify@test.com');
  });

  test('verifyToken throws error if invalid signature', () => {
    const payload = { foo: 'bar' };
    const token = jwt.sign(payload, 'some_other_secret'); // not using our test_secret_key

    expect(() => {
      AuthService.verifyToken(token);
    }).toThrow();
  });

  test('verifyToken throws error if token is expired', async () => {
    // A token that expires immediately
    const token = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 1 }, 'test_secret_key');
    expect(() => AuthService.verifyToken(token)).toThrow(/jwt expired/i);
  });
});
