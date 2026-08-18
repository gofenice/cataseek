import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

/**
 * This server runs with MySQL `wait_timeout = 30`, so the database closes any
 * connection idle for 30 seconds. mysql2's own `idleTimeout` defaults to 60s,
 * which left a window where the pool believed a connection was alive for a full
 * 30 seconds after MySQL had already killed it. Handing one of those out threw
 * PROTOCOL_CONNECTION_LOST / ECONNRESET, and because authenticateJWT reported
 * any thrown error as a 401, the dashboard logged the user out. (Aborted_clients
 * on the server had reached ~45k.)
 *
 * Retiring idle connections well before MySQL does keeps the pool honest;
 * `withRetry` below covers the race that remains when a connection dies between
 * the pool handing it over and the query reaching the wire.
 */
const IDLE_TIMEOUT_MS = 10_000; // must stay comfortably under MySQL's wait_timeout

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 25,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  idleTimeout: IDLE_TIMEOUT_MS,
  maxIdle: 5,
});

/**
 * Errors that mean "this particular connection is dead", not "this query is
 * wrong". Retrying these once picks up a fresh connection from the pool; a
 * genuine SQL error is never retried.
 */
const TRANSIENT_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ER_CON_COUNT_ERROR',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
]);

export const isTransientDbError = (error: any): boolean =>
  !!error && (TRANSIENT_CODES.has(error.code) || error.fatal === true);

const withRetry = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error: any) {
    if (!isTransientDbError(error)) throw error;
    // One retry only — the second attempt gets a freshly opened connection.
    return await run();
  }
};

export const query = async (sql: string, params?: any[]) => {
  return withRetry(async () => {
    const [rows] = await pool.execute(sql, params);
    return rows;
  });
};

export const getConnection = async () => {
  return await pool.getConnection();
};

export default pool;
