// tests/unit/ProjectService.test.js

import { ProjectService } from '../../server/services/ProjectService.js';
import pool from '../../server/database.js';
import { HttpError } from '../../server/utils/HttpError.js';

jest.mock('../../server/database.js', () => {
  return {
    __esModule: true,
    default: {
      query: jest.fn(),
    },
  };
});

describe('ProjectService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createVersion increments version number correctly', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ max_ver: 2 }] });
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 10, version_number: 3, created_at: '2023-01-01', project_data: {} },
      ],
    });

    const result = await ProjectService.createVersion(123, { some: 'data' });
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      id: 10,
      version_number: 3,
      created_at: '2023-01-01',
    });
  });

  test('rollbackVersion throws 404 if old version not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(ProjectService.rollbackVersion(123, 999)).rejects.toThrow(HttpError);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('rollbackVersion creates a new version from old data', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, version_number: 2, project_data: { key: 'old' } }],
    });
    pool.query.mockResolvedValueOnce({ rows: [{ max_ver: 2 }] });
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 2, version_number: 3, created_at: '2023-02-01' }],
    });

    const result = await ProjectService.rollbackVersion(123, 1);
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      message: 'Project rolled back successfully',
      newVersion: { id: 2, version_number: 3 },
    });
  });

  test('userCanEditProject returns true if user is admin', async () => {
    const user = { id: 999, role: 'admin' };
    // Should short-circuit to true, no DB query
    const canEdit = await ProjectService.userCanEditProject(123, user);
    expect(canEdit).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('userCanEditProject returns false if project not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // getProjectOwnerId => no row
    const user = { id: 50, role: 'user' };
    const canEdit = await ProjectService.userCanEditProject(999, user);
    expect(canEdit).toBe(false);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('userCanEditProject returns true if user is owner', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ owner_id: 50 }] });
    const user = { id: 50, role: 'user' };
    const canEdit = await ProjectService.userCanEditProject(123, user);
    expect(canEdit).toBe(true);
  });

  test('userCanEditProject returns false if user is neither admin nor owner', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ owner_id: 55 }] });
    const user = { id: 50, role: 'user' };
    const canEdit = await ProjectService.userCanEditProject(123, user);
    expect(canEdit).toBe(false);
  });
});
