// tests/unit/ProjectServiceErrorHandling.test.js
import { ProjectService } from '../../server/services/ProjectService.js';
import pool from '../../server/database.js';
import { HttpError } from '../../server/utils/HttpError.js';

// We use the same jest mock for the pool that your other tests do
jest.mock('../../server/database.js', () => {
  return {
    __esModule: true,
    default: {
      query: jest.fn(),
    },
  };
});

describe('ProjectService - Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createProject throws an error if INSERT fails', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB insertion error'));

    // We do not wrap with try/catch => we want to see that it actually throws
    await expect(ProjectService.createProject(999, 'TestName', 'Desc'))
      .rejects
      .toThrow('DB insertion error');

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('listVersions rethrows if DB fails', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB read error'));

    await expect(ProjectService.listVersions(123))
      .rejects
      .toThrow('DB read error');
  });

  test('rollbackVersion => if final insertion fails, rethrows error', async () => {
    // 1) Mock that the old version is found
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 999, version_number: 3, project_data: { key: 'someValue' } }],
    });
    // 2) Mock the next query for getMaxVersion => 3
    pool.query.mockResolvedValueOnce({ rows: [{ max_ver: 3 }] });
    // 3) Mock the final insertion to fail
    pool.query.mockRejectedValueOnce(new Error('Failing final insert'));

    await expect(ProjectService.rollbackVersion(1, 999))
      .rejects
      .toThrow('Failing final insert');

    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  test('rollbackVersion => if old version not found => throws 404 HttpError', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // no version found
    await expect(ProjectService.rollbackVersion(1, 9999))
      .rejects
      .toThrow(HttpError); // specifically your code: new HttpError('Version not found.', 404)

    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
