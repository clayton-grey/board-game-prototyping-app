// tests/unit/HttpError.test.js
import { HttpError } from '../../server/utils/HttpError.js';

describe('HttpError', () => {
  test('creates an error with a message and statusCode', () => {
    const err = new HttpError('Not Found', 404);
    expect(err.message).toBe('Not Found');
    expect(err.statusCode).toBe(404);
    expect(err.stack).toBeDefined();
    // The name property should be 'Error' or 'HttpError' depending on environment
    expect(err.name).toBe('HttpError');
  });

  test('defaults to statusCode=500 if not provided', () => {
    const err = new HttpError('Server failure');
    expect(err.statusCode).toBe(500);
  });

  test('stack trace is captured (V8 only)', () => {
    // Just confirm it has a 'stack' property
    expect(new HttpError('Test').stack).toContain('HttpError');
  });
});
