const fs = require('fs/promises');
const path = require('path');
const { createPool, hashPassword } = require('./pool');

const migrationsDirectory = path.join(__dirname, 'migrations');

async function ensureAdminUser(client) {
  const identifier = process.env.AUTH_IDENTIFIER || process.env.AUTH_EMAIL;
  const password = process.env.AUTH_PASSWORD;
  const name = process.env.AUTH_NAME || 'Admin';

  if (!identifier || !password) {
    throw new Error('AUTH_IDENTIFIER et AUTH_PASSWORD sont obligatoires.');
  }

  const result = await client.query(
    'SELECT id FROM users WHERE LOWER(identifier) = LOWER($1)',
    [identifier]
  );

  if (result.rowCount > 0) return;

  await client.query(
    `INSERT INTO users (identifier, password_hash, name, role, is_active)
     VALUES ($1, $2, $3, 'admin', TRUE)`,
    [identifier, hashPassword(password), name]
  );
  console.log(`Utilisateur administrateur cree : ${identifier}`);
}

async function migrate() {
  const pool = createPool();
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await fs.readdir(migrationsDirectory))
      .filter((file) => /^\d+.*\.sql$/i.test(file))
      .sort();

    for (const file of files) {
      const applied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [file]
      );
      if (applied.rowCount > 0) continue;

      const sql = await fs.readFile(path.join(migrationsDirectory, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Migration appliquee : ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    await ensureAdminUser(client);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error('Echec des migrations PostgreSQL :', error.message);
    process.exitCode = 1;
  });
}

module.exports = { migrate };
