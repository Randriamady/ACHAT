// ============================================================
// POOL DE CONNEXION POSTGRESQL
// La base et le schema sont geres par l'administration/migration.
// ============================================================

const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const targetDb = process.env.DB_NAME || process.env.PGDATABASE || 'sipromad';

function createPool(database = targetDb) {
  return new Pool({
    host: String(process.env.DB_HOST ?? process.env.PGHOST ?? 'localhost'),
    port: Number(process.env.DB_PORT ?? process.env.PGPORT ?? 5432),
    database,
    user: String(process.env.DB_USER ?? process.env.PGUSER ?? 'postgres'),
    password: String(process.env.DB_PASSWORD ?? process.env.PGPASSWORD ?? ''),
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: true }
      : false,
    max: Number(process.env.DB_POOL_MAX || 20),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const [salt, hash] = String(storedHash).split(':');
  if (!salt || !hash) return false;
  const derived = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  const storedBuffer = Buffer.from(hash, 'hex');
  const derivedBuffer = Buffer.from(derived, 'hex');
  return storedBuffer.length === derivedBuffer.length && crypto.timingSafeEqual(storedBuffer, derivedBuffer);
}

let mainPool = null;

function getPool() {
  if (!mainPool) mainPool = createPool();
  return mainPool;
}

async function closePool() {
  if (!mainPool) return;
  const pool = mainPool;
  mainPool = null;
  await pool.end();
}

async function query(text, params) {
  return getPool().query(text, params);
}

module.exports = {
  closePool,
  createPool,
  getPool,
  hashPassword,
  query,
  targetDb,
  verifyPassword,
};
