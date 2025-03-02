// tests/unit/authMiddleware.test.js
import { authenticateToken, authorizeAdmin } from '../../server/middleware/authMiddleware.js';
import { AuthService } from '../../server/services/AuthService.js';

jest.mock('../../server/services/AuthService.js');

describe('authMiddleware', () => {

  let mockReq, mockRes, mockNext;
  beforeEach(() => {
    mockReq = {
      headers: {},
      user: null,
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('authenticateToken', () => {
    test('returns 401 if no token provided', () => {
      // no Authorization header
      authenticateToken(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ message: 'Unauthorized: No token provided' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('returns 403 if token is invalid', () => {
      mockReq.headers['authorization'] = 'Bearer some_token';
      AuthService.verifyToken.mockImplementation(() => { throw new Error('Invalid token'); });

      authenticateToken(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ message: 'Forbidden: Invalid token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    test('sets req.user and calls next if token is valid', () => {
      mockReq.headers['authorization'] = 'Bearer valid_jwt';
      AuthService.verifyToken.mockReturnValue({ id: 123, email: 'test@example.com' });

      authenticateToken(mockReq, mockRes, mockNext);

      expect(AuthService.verifyToken).toHaveBeenCalledWith('valid_jwt');
      expect(mockReq.user).toEqual({ id: 123, email: 'test@example.com' });
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('authorizeAdmin', () => {
    test('calls next if req.user.isAdmin is true', () => {
      // Suppose authenticateToken was successful => sets req.user
      mockReq.user = { isAdmin: true };
      authorizeAdmin(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    test('returns 403 if user is not admin', () => {
      mockReq.user = { isAdmin: false };
      authorizeAdmin(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ message: 'Access denied. Admins only.' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
