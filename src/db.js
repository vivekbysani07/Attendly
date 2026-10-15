const { Pool, types } = require('pg');

// Postgres returns COUNT/SUM as strings by default; make them plain numbers.
types.setTypeParser(20, v => parseInt(v, 10));     // bigint
types.setTypeParser(1700, v => parseFloat(v));     // numeric

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add your Neon connection string (see README).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000     // Neon's free database can take a few seconds to wake up
});
pool.on('error', e => console.error('Database connection dropped:', e.message));

const wrap = c => ({
  all: async (sql, p = []) => (await c.query(sql, p)).rows,
  one: async (sql, p = []) => (await c.query(sql, p)).rows[0] || null,
  run: (sql, p = []) => c.query(sql, p)
});

const db = {
  ...wrap(pool),
  async tx(fn) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(wrap(c));
      await c.query('COMMIT');
      return out;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch (_) { /* connection already gone */ }
      throw e;
    } finally { c.release(); }
  },
  end: () => pool.end(),
  init: () => pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id             SERIAL PRIMARY KEY,
      name           TEXT NOT NULL,
      email          TEXT NOT NULL UNIQUE,
      password_hash  TEXT NOT NULL,
      college        TEXT DEFAULT '',
      department     TEXT DEFAULT '',
      semester       TEXT DEFAULT '',
      prev_held      INTEGER NOT NULL DEFAULT 0,
      prev_attended  INTEGER NOT NULL DEFAULT 0,
      target         DOUBLE PRECISION NOT NULL DEFAULT 75,
      created_at     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id      SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name    TEXT NOT NULL,
      active  INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS subjects_user_name ON subjects(user_id, lower(name));
    CREATE TABLE IF NOT EXISTS attendance (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date       TEXT NOT NULL,
      period     INTEGER NOT NULL CHECK(period BETWEEN 1 AND 6),
      status     TEXT NOT NULL CHECK(status IN ('PRESENT','ABSENT')),
      subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
      UNIQUE(user_id, date, period)
    );
    CREATE TABLE IF NOT EXISTS holidays (
      id      SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date    TEXT NOT NULL,
      reason  TEXT DEFAULT '',
      UNIQUE(user_id, date)
    );
    CREATE TABLE IF NOT EXISTS timetable (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      weekday    INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 6),
      period     INTEGER NOT NULL CHECK(period BETWEEN 1 AND 6),
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      UNIQUE(user_id, weekday, period)
    );
    CREATE INDEX IF NOT EXISTS idx_att_user_date ON attendance(user_id, date);
  `)
};

module.exports = db;
