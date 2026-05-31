export const SCHEMA_VERSION = 1

export const migrations: Record<number, string> = {
  1: `
    CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER);
    INSERT INTO schema_meta VALUES (1);
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      last_opened TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS db_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      host TEXT,
      port INTEGER,
      database TEXT NOT NULL,
      user TEXT
    );
    CREATE TABLE IF NOT EXISTS http_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS http_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER,
      request TEXT NOT NULL,
      response TEXT NOT NULL,
      executed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `
}
