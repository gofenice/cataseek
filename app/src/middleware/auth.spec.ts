/**
 * Regression cover for the "unexpected logout from Console" bug.
 *
 * A dropped pooled MySQL connection used to surface as 401, which the dashboard
 * treats as "your token is bad" — so it deleted the token and signed the user
 * out mid-session. The distinction these tests protect is narrow but critical:
 * 401 must mean the CREDENTIAL is bad, never that the database hiccuped.
 */

const mockQuery = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../config/database', () => ({
  query: (...a: any[]) => mockQuery(...a),
  // Real implementation — classifying errors correctly is part of what's tested.
  isTransientDbError: (e: any) =>
    !!e && (['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT',
             'ECONNREFUSED', 'ER_CON_COUNT_ERROR', 'PROTOCOL_SEQUENCE_TIMEOUT',
             'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'].includes(e.code) || e.fatal === true),
}));
jest.mock('../utils/auth', () => ({
  verifyToken: (...a: any[]) => mockVerifyToken(...a),
  comparePassword: jest.fn(),
}));

import { authenticateJWT } from './auth';

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const TENANT = {
  id: 7, store_name: 'Test', email: 't@example.com', plan_id: 1,
  status: 'active', role: 'merchant', meilisearch_index_name: 'store_7_products',
  search_enabled: 1, hosting_enabled: 0, api_key: 'k',
};

beforeEach(() => {
  mockQuery.mockReset();
  mockVerifyToken.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const run = async (headers: any = { authorization: 'Bearer good.token' }) => {
  const req: any = { headers };
  const res = makeRes();
  const next = jest.fn();
  await authenticateJWT(req, res, next);
  return { req, res, next };
};

describe('genuine auth failures still return 401', () => {
  it('rejects a missing Authorization header', async () => {
    const { res, next } = await run({});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a malformed header', async () => {
    const { res } = await run({ authorization: 'Token abc' });
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects an invalid or expired token', async () => {
    mockVerifyToken.mockReturnValue(null);
    const { res } = await run();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a token for a tenant that no longer exists', async () => {
    mockVerifyToken.mockReturnValue({ tenantId: 999 });
    mockQuery.mockResolvedValue([]);
    const { res } = await run();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('database failures must NOT look like auth failures', () => {
  // The actual bug: each of these used to return 401 and log the user out.
  const transient = [
    'PROTOCOL_CONNECTION_LOST', // idle connection reaped by MySQL wait_timeout=30
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
    'ER_CON_COUNT_ERROR',
  ];

  it.each(transient)('returns 503, not 401, on %s', async (code) => {
    mockVerifyToken.mockReturnValue({ tenantId: 7 });
    const err: any = new Error('connection lost');
    err.code = code;
    mockQuery.mockRejectedValue(err);

    const { res, next } = await run();

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryable: true }));
    expect(next).not.toHaveBeenCalled();
  });

  it('treats a fatal-flagged error as transient', async () => {
    mockVerifyToken.mockReturnValue({ tenantId: 7 });
    const err: any = new Error('fatal');
    err.fatal = true;
    mockQuery.mockRejectedValue(err);
    const { res } = await run();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 500, not 401, on an unexpected non-transient error', async () => {
    mockVerifyToken.mockReturnValue({ tenantId: 7 });
    mockQuery.mockRejectedValue(new Error('syntax error in SQL'));
    const { res } = await run();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.status).not.toHaveBeenCalledWith(401);
  });
});

describe('the happy path still works', () => {
  it('attaches the tenant and continues', async () => {
    mockVerifyToken.mockReturnValue({ tenantId: 7 });
    mockQuery.mockResolvedValue([TENANT]);

    const { req, res, next } = await run();

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user).toEqual(TENANT);
  });

  it('survives repeated calls, as page reloads and navigation produce', async () => {
    mockVerifyToken.mockReturnValue({ tenantId: 7 });
    mockQuery.mockResolvedValue([TENANT]);
    for (let i = 0; i < 5; i++) {
      const { next, res } = await run();
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    }
  });
});
