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
