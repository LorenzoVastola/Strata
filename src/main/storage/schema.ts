export const SCHEMA_VERSION = 11

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
  `,
  2: `
    CREATE TABLE IF NOT EXISTS editor_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      open_tabs TEXT NOT NULL DEFAULT '[]',
      active_tab TEXT
    );
    INSERT OR IGNORE INTO editor_state (id, open_tabs, active_tab) VALUES (1, '[]', NULL);
    UPDATE schema_meta SET version = 2;
  `,
  3: `
    ALTER TABLE db_connections ADD COLUMN encrypted_password TEXT;
    UPDATE schema_meta SET version = 3;
  `,
  4: `
    CREATE TABLE IF NOT EXISTS http_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '[]',
      headers TEXT NOT NULL DEFAULT '[]',
      body TEXT NOT NULL DEFAULT '{}',
      auth TEXT NOT NULL DEFAULT '{}',
      timeout_ms INTEGER NOT NULL DEFAULT 30000,
      environment_id INTEGER,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(collection_id) REFERENCES http_collections(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS http_environments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      variables TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS http_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    UPDATE schema_meta SET version = 4;
  `,
  5: `
    CREATE TABLE IF NOT EXISTS http_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      parent_id INTEGER,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(collection_id) REFERENCES http_collections(id) ON DELETE CASCADE,
      FOREIGN KEY(parent_id) REFERENCES http_folders(id) ON DELETE CASCADE
    );
    ALTER TABLE http_requests ADD COLUMN folder_id INTEGER;
    UPDATE schema_meta SET version = 5;
  `,
  6: `
    ALTER TABLE http_requests ADD COLUMN description TEXT;
    UPDATE schema_meta SET version = 6;
  `,
  7: `
    ALTER TABLE http_requests ADD COLUMN scripts TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE http_requests ADD COLUMN response_captures TEXT NOT NULL DEFAULT '[]';
    UPDATE schema_meta SET version = 7;
  `,
  8: `
    UPDATE schema_meta SET version = 8;
  `,
  9: `
    CREATE TABLE IF NOT EXISTS ai_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      agent TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      read_only INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      agent TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS ai_session_files (
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(session_id, file_path),
      FOREIGN KEY(session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
    );
    UPDATE schema_meta SET version = 9;
  `,
  10: `
    ALTER TABLE db_connections ADD COLUMN last_used_at TEXT;
    UPDATE db_connections SET last_used_at = COALESCE(last_used_at, datetime('now'));
    UPDATE schema_meta SET version = 10;
  `,
  11: `
    ALTER TABLE db_connections ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;
    UPDATE schema_meta SET version = 11;
  `
}
