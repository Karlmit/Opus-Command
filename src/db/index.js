const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const schema = require('./schema');
const path = require('path');
const fs = require('fs');
const { DATA_DIR, DB_PATH } = require('../config');

let db;
let sqlite;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  template TEXT NOT NULL,
  container_id TEXT,
  home_volume TEXT,
  status TEXT DEFAULT 'stopped',
  avatar TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS terminal_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scrollback TEXT DEFAULT '',
  ai_state TEXT DEFAULT 'none',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  platform TEXT DEFAULT 'windows',
  hostname TEXT DEFAULT '',
  version TEXT DEFAULT '',
  labels TEXT DEFAULT '[]',
  capabilities TEXT DEFAULT '{}',
  status TEXT DEFAULT 'offline',
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_pairing_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL,
  name TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  shell TEXT NOT NULL,
  command TEXT NOT NULL,
  cwd TEXT,
  status TEXT DEFAULT 'queued',
  stdout TEXT DEFAULT '',
  stderr TEXT DEFAULT '',
  exit_code INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES connector_jobs(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  expires INTEGER
);

CREATE TABLE IF NOT EXISTS __migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);
`;

function runMigrations(sqliteDb) {
  const migrationsDir = path.join(__dirname, '../../drizzle');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const name = file.replace('.sql', '');
    const exists = sqliteDb.prepare('SELECT id FROM __migrations WHERE name = ?').get(name);
    if (!exists) {
      console.log(`[db] Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      sqliteDb.exec(sql);
      sqliteDb.prepare('INSERT INTO __migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
    }
  }
}

function initDB() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(SCHEMA_SQL);
  // Add avatar column to existing installations
  try { sqlite.exec("ALTER TABLE projects ADD COLUMN avatar TEXT DEFAULT ''"); } catch (_) {}
  try {
    sqlite.exec("ALTER TABLE projects ADD COLUMN sort_order INTEGER DEFAULT 0");
    // Backfill existing rows so their order is stable (oldest first).
    sqlite.exec("UPDATE projects SET sort_order = id WHERE sort_order = 0");
  } catch (_) {}
  try { sqlite.exec("ALTER TABLE connectors ADD COLUMN labels TEXT DEFAULT '[]'"); } catch (_) {}
  try { sqlite.exec("ALTER TABLE connectors ADD COLUMN capabilities TEXT DEFAULT '{}'"); } catch (_) {}
  runMigrations(sqlite);

  db = drizzle(sqlite, { schema });
  console.log(`[db] Database initialized at ${DB_PATH}`);
  return { db, sqlite };
}

function getDB() {
  if (!db) throw new Error('DB not initialized. Call initDB() first.');
  return db;
}

function getSQLite() {
  if (!sqlite) throw new Error('SQLite not initialized. Call initDB() first.');
  return sqlite;
}

module.exports = { initDB, getDB, getSQLite };
