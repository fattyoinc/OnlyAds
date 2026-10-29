/**
 * SQLite via Node's built-in driver (node:sqlite, no native dependency).
 * WAL mode for concurrent reads during ingestion; foreign keys enforced.
 * Migrations in server/migrations are applied in order, each in a transaction,
 * and recorded in schema_migrations so they run exactly once.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export function migrate(db: DB, dir = MIGRATIONS_DIR): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const pending = files.filter((f) => !done.has(f));
  if (!pending.length) return [];
  // Table rebuilds (SQLite's way to change constraints) need FK enforcement off
  // *outside* the transaction; integrity is re-checked before re-enabling.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const f of pending) {
      tx(db, () => {
        db.exec(readFileSync(join(dir, f), 'utf8'));
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length) throw new Error(`migration ${f} broke ${broken.length} foreign key reference(s)`);
        db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
      });
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return pending;
}

/** Run fn in a transaction; rolls back on any error. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Consistent online backup to a new file (safe while the server is running). */
export function backup(db: DB, toPath: string): void {
  if (!/^[\w./-]+\.db$/.test(toPath)) throw new Error('Backup path must be a simple *.db path');
  db.prepare('VACUUM INTO ?').run(toPath);
}
