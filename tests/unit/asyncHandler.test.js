// tests/unit/asyncHandler.test.js
import { asyncHandler } from '../../server/utils/asyncHandler.js';

describe('asyncHandler', () => {
  test('calls next with error if the wrapped function rejects', async () => {
    const mockReq = {};
    const mockRes = {};
    const mockNext = jest.fn();

    const failingFn = async () => {
      throw new Error('Oops!');
    };
    const wrapped = asyncHandler(failingFn);

    await wrapped(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(1);
    const [err] = mockNext.mock.calls[0];
    expect(err.message).toBe('Oops!');
  });

  test('calls the handler normally if no error', async () => {
    const mockReq = {};
    const mockRes = {};
    const mockNext = jest.fn();

    const successFn = async (req, res, next) => {
      // No error
      return 'OK';
    };
    const wrapped = asyncHandler(successFn);

    await wrapped(mockReq, mockRes, mockNext);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
