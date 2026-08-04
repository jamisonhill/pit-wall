// ============================================================================
// THE ARCHIVE HANDLE
//
// A thin wrapper around the F1DB SQLite file. Uses node:sqlite, which ships with
// Node itself — no native module to compile, no npm dependency, and the database
// is read straight off disk rather than loaded into memory (the NAS has little of
// it to spare).
//
// Opened READ-ONLY. Nothing in this application ever writes to the archive; the
// only way its contents change is a new release replacing the whole file.
//
// Every statement is prepared once and cached. F1DB has ~187,000 result rows and
// 127 indexes, so the queries are fast, but re-parsing the same SQL on every
// request would not be.
// ============================================================================

import { DatabaseSync } from 'node:sqlite';
import { log } from '../logger.js';

let db = null;
let dbVersion = null;
const statements = new Map(); // sql → prepared StatementSync

/** True once an archive has been opened and is safe to query. */
export function isReady() {
  return db !== null;
}

/** Which F1DB release is currently open, e.g. "v2026.11.0". */
export function version() {
  return dbVersion;
}

/**
 * Point the handle at a database file. Called on boot and again whenever the
 * downloader swaps in a newer release.
 */
export function openArchive(dbPath, releaseVersion) {
  closeArchive();
  // readOnly guarantees a bug in a query can never damage the archive, and lets
  // SQLite skip journal setup entirely.
  db = new DatabaseSync(dbPath, { readOnly: true });
  dbVersion = releaseVersion ?? null;
  log.info('Archive opened', { version: dbVersion, path: dbPath });
}

export function closeArchive() {
  statements.clear(); // prepared statements belong to the connection that made them
  try { db?.close(); } catch { /* already closed */ }
  db = null;
}

/** Prepare-and-cache. Internal to this module. */
function prepared(sql) {
  if (!db) {
    // Callers should check isReady() and return a 503 instead of reaching here,
    // but a clear message beats a null-dereference if one slips through.
    throw new Error('archive not ready');
  }
  let stmt = statements.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    statements.set(sql, stmt);
  }
  return stmt;
}

/**
 * Run a query and return every row.
 * Named parameters are written `:name` in the SQL and passed as `{ name: value }`.
 * @returns {object[]}
 */
export function all(sql, params = {}) {
  return prepared(sql).all(params);
}

/**
 * Run a query and return the first row, or null.
 * @returns {object|null}
 */
export function get(sql, params = {}) {
  return prepared(sql).get(params) ?? null;
}
