import { ipcMain, safeStorage } from 'electron'
import { createRequire } from 'module'
import mysql from 'mysql2/promise'
import { getDb } from '../storage/db'

const require = createRequire(import.meta.url)
const { Pool: PgPool } = require('pg') as {
  Pool: new (config: Record<string, unknown>) => {
    connect: () => Promise<{ query: (query: string, values?: unknown[]) => Promise<QueryResult>; release: () => void }>
    query: (query: string, values?: unknown[]) => Promise<QueryResult>
    end: () => Promise<void>
  }
}

type Driver = 'mysql' | 'postgres'

type DbConnectionInput = {
  driver: Driver
  name: string
  host: string
  port: number
  user: string
  password: string
  database: string
  readOnly: boolean
}

type SavedConnection = Omit<DbConnectionInput, 'password'> & {
  id: number
  encrypted_password: string | null
}

type QueryResult = {
  rows?: Record<string, unknown>[]
  fields?: { name: string }[]
  rowCount?: number
}

type DbPool = {
  driver: Driver
  pool: mysql.Pool | InstanceType<typeof PgPool>
  status: ConnectionStatus
}

type ConnectionStatus = 'connected' | 'disconnected' | 'error'
type QueryPoolTarget = number | DbPool

const pools = new Map<number, DbPool>()
const connectionStates = new Map<number, { status: ConnectionStatus; error?: string }>()

const systemSchemas = new Set(['information_schema', 'mysql', 'performance_schema', 'sys', 'pg_catalog'])

const encryptPassword = (password: string) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron safeStorage non disponibile su questo sistema.')
  }
  return safeStorage.encryptString(password).toString('base64')
}

const decryptPassword = (encryptedPassword: string | null) => {
  if (!encryptedPassword) return ''
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron safeStorage non disponibile su questo sistema.')
  }
  return safeStorage.decryptString(Buffer.from(encryptedPassword, 'base64'))
}

const normalizeConnection = (input: DbConnectionInput) => ({
  driver: input.driver,
  name: input.name.trim(),
  host: input.host.trim(),
  port: Number(input.port),
  user: input.user.trim(),
  password: input.password,
  database: input.database.trim(),
  readOnly: Boolean(input.readOnly),
})

const getSavedConnection = (connectionId: number) => {
  return getDb().prepare(`
    SELECT
      id,
      type AS driver,
      name,
      host,
      port,
      user,
      database,
      encrypted_password,
      read_only AS readOnly
    FROM db_connections
    WHERE id = ?
  `).get(connectionId) as SavedConnection | undefined
}

const touchConnection = (connectionId: number) => {
  getDb().prepare('UPDATE db_connections SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), connectionId)
}

const createPool = (connection: SavedConnection) => {
  const password = decryptPassword(connection.encrypted_password)

  if (connection.driver === 'mysql') {
    return mysql.createPool({
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password,
      database: connection.database,
      waitForConnections: true,
      connectionLimit: 5,
    })
  }

  return new PgPool({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password,
    database: connection.database,
    max: 5,
  })
}

const setConnectionState = (connectionId: number, status: ConnectionStatus, error?: string) => {
  connectionStates.set(connectionId, { status, error })
}

const testPool = async (entry: DbPool) => {
  if (!entry.pool) {
    throw new Error('Connessione non attiva. Clicca destro -> Connetti.')
  }

  if (entry.driver === 'mysql') {
    await (entry.pool as mysql.Pool).execute('SELECT 1')
    return
  }

  await (entry.pool as InstanceType<typeof PgPool>).query('SELECT 1')
}

const reconnect = async (connectionId: number) => {
  const connection = getSavedConnection(connectionId)
  if (!connection) {
    setConnectionState(connectionId, 'error', 'Connessione non trovata.')
    throw new Error('Connessione non trovata.')
  }

  const stale = pools.get(connectionId)
  if (stale?.pool) {
    await stale.pool.end().catch(() => undefined)
    pools.delete(connectionId)
  }

  let pool: mysql.Pool | InstanceType<typeof PgPool> | null = null
  try {
    pool = createPool(connection)
    const entry = { driver: connection.driver, pool, status: 'connected' as const }
    await testPool(entry)
    pools.set(connectionId, entry)
    setConnectionState(connectionId, 'connected')
    touchConnection(connectionId)
    return entry
  } catch (err) {
    if (pool) await pool.end().catch(() => undefined)
    const message = err instanceof Error ? err.message : String(err)
    setConnectionState(connectionId, 'error', message)
    throw new Error(`Connessione non attiva. Clicca destro -> Connetti. Dettaglio: ${message}`)
  }
}

const ensurePool = async (connectionId: number) => {
  const existing = pools.get(connectionId)
  if (existing?.pool) {
    return existing
  }
  if (existing && !existing.pool) pools.delete(connectionId)

  return reconnect(connectionId)
}

const testConnection = async (input: DbConnectionInput) => {
  const connection = normalizeConnection(input)

  if (connection.driver === 'mysql') {
    const client = await mysql.createConnection({
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: connection.password,
      database: connection.database,
    })
    await client.execute('SELECT 1')
    await client.end()
    return
  }

  const pool = new PgPool({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    max: 1,
  })
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
  } finally {
    client.release()
    await pool.end()
  }
}

const queryPool = async (target: QueryPoolTarget, query: string, params: unknown[] = []) => {
  const entry = typeof target === 'number' ? await ensurePool(target) : target
  if (!entry?.pool) throw new Error('Connessione non attiva. Clicca destro -> Connetti.')
  const startedAt = performance.now()

  if (entry.driver === 'mysql') {
    const [rows, fields] = await (entry.pool as mysql.Pool).execute(
      query,
      params as Parameters<mysql.Pool['execute']>[1],
    )
    const resultRows = Array.isArray(rows) ? rows as Record<string, unknown>[] : []
    return {
      columns: (fields as mysql.FieldPacket[]).map((field) => field.name),
      rows: resultRows,
      rowCount: resultRows.length,
      duration: performance.now() - startedAt,
    }
  }

  const result = await (entry.pool as InstanceType<typeof PgPool>).query(query, params)
  return {
    columns: result.fields?.map((field) => field.name) ?? [],
    rows: result.rows ?? [],
    rowCount: result.rowCount ?? result.rows?.length ?? 0,
    duration: performance.now() - startedAt,
  }
}

const quoteIdentifier = (driver: Driver, identifier: string) => {
  if (!/^[\w$.-]+$/.test(identifier)) throw new Error('Identificatore SQL non valido.')
  const quote = driver === 'mysql' ? '`' : '"'
  return identifier
    .split('.')
    .map((part) => `${quote}${part.split(quote).join(`${quote}${quote}`)}${quote}`)
    .join('.')
}

const getMysqlSchema = async (connectionId: number) => {
  const connection = getSavedConnection(connectionId)
  if (!connection) throw new Error('Connessione non trovata.')
  const databaseName = connection.database?.trim()
  if (!databaseName) throw new Error('Database MySQL non impostato per la connessione.')
  const schemaPool = await ensurePool(connectionId)

  const tablesResult = await queryPool(schemaPool, `
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ?
    ORDER BY TABLE_NAME
  `, [databaseName])
  const tableNames = tablesResult.rows.map((row) => String(row.TABLE_NAME))

  const columnsByTable = await Promise.all(tableNames.map(async (tableName) => {
    const columnsResult = await queryPool(schemaPool, `
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `, [databaseName, tableName])
    return {
      tableName,
      columns: columnsResult.rows.map((row) => ({
        databaseName,
        tableName,
        name: String(row.COLUMN_NAME),
        type: String(row.DATA_TYPE),
        columnKey: String(row.COLUMN_KEY ?? ''),
        nullable: String(row.IS_NULLABLE ?? ''),
        defaultValue: row.COLUMN_DEFAULT === null || row.COLUMN_DEFAULT === undefined ? null : String(row.COLUMN_DEFAULT),
        extra: String(row.EXTRA ?? ''),
      })),
    }
  }))

  const [indexes, foreignKeys] = await Promise.all([
    queryPool(schemaPool, `
      SELECT table_schema AS databaseName, table_name AS tableName, index_name AS name, column_name AS columnName, non_unique AS nonUnique
      FROM information_schema.statistics
      WHERE table_schema = ?
      ORDER BY table_schema, table_name, index_name, seq_in_index
    `, [databaseName]),
    queryPool(schemaPool, `
      SELECT
        constraint_schema AS databaseName,
        table_name AS tableName,
        constraint_name AS name,
        column_name AS columnName,
        referenced_table_name AS referencedTable,
        referenced_column_name AS referencedColumn
      FROM information_schema.key_column_usage
      WHERE referenced_table_name IS NOT NULL AND constraint_schema = ?
      ORDER BY constraint_schema, table_name, constraint_name
    `, [databaseName]),
  ])
  const tables = tableNames.map((tableName) => ({ databaseName, name: tableName }))
  const columns = columnsByTable.flatMap((entry) => entry.columns)

  return buildSchemaTree([{ name: databaseName }], tables, columns, indexes.rows, foreignKeys.rows)
}

const getPostgresSchema = async (connectionId: number) => {
  const [schemas, tables, columns, indexes, foreignKeys] = await Promise.all([
    queryPool(connectionId, `
      SELECT schema_name AS name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ($1, $2)
      ORDER BY schema_name
    `, ['information_schema', 'pg_catalog']),
    queryPool(connectionId, `
      SELECT table_schema AS "databaseName", table_name AS name
      FROM information_schema.tables
      WHERE table_schema NOT IN ($1, $2) AND table_type = $3
      ORDER BY table_schema, table_name
    `, ['information_schema', 'pg_catalog', 'BASE TABLE']),
    queryPool(connectionId, `
      SELECT
        table_schema AS "databaseName",
        table_name AS "tableName",
        column_name AS name,
        data_type AS type,
        is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema NOT IN ($1, $2)
      ORDER BY table_schema, table_name, ordinal_position
    `, ['information_schema', 'pg_catalog']),
    queryPool(connectionId, `
      SELECT schemaname AS "databaseName", tablename AS "tableName", indexname AS name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname NOT IN ($1, $2)
      ORDER BY schemaname, tablename, indexname
    `, ['information_schema', 'pg_catalog']),
    queryPool(connectionId, `
      SELECT
        tc.table_schema AS "databaseName",
        tc.table_name AS "tableName",
        tc.constraint_name AS name,
        kcu.column_name AS "columnName",
        ccu.table_name AS "referencedTable",
        ccu.column_name AS "referencedColumn"
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = $1 AND tc.table_schema NOT IN ($2, $3)
      ORDER BY tc.table_schema, tc.table_name, tc.constraint_name
    `, ['FOREIGN KEY', 'information_schema', 'pg_catalog']),
  ])

  return buildSchemaTree(schemas.rows, tables.rows, columns.rows, indexes.rows, foreignKeys.rows)
}

export async function getDatabaseSchema(connectionId: number) {
  const connection = getSavedConnection(connectionId)
  if (!connection) throw new Error('Connessione non trovata.')
  return connection.driver === 'mysql' ? getMysqlSchema(connectionId) : getPostgresSchema(connectionId)
}

export async function executeDatabaseQuery(connectionId: number, query: string, params: unknown[] = []) {
  return queryPool(connectionId, query, params)
}

export function isConnectionReadOnly(connectionId: number): boolean {
  const connection = getSavedConnection(connectionId)
  return Boolean(connection?.readOnly)
}

const buildSchemaTree = (
  databases: Record<string, unknown>[],
  tables: Record<string, unknown>[],
  columns: Record<string, unknown>[],
  indexes: Record<string, unknown>[],
  foreignKeys: Record<string, unknown>[],
) => {
  return databases
    .filter((database) => !systemSchemas.has(String(database.name)))
    .map((database) => {
      const databaseName = String(database.name)
      const databaseTables = tables
        .filter((table) => table.databaseName === databaseName)
        .map((table) => {
          const tableName = String(table.name)
          return {
            name: tableName,
            columns: columns.filter((column) => column.databaseName === databaseName && column.tableName === tableName),
            indexes: indexes.filter((index) => index.databaseName === databaseName && index.tableName === tableName),
            foreignKeys: foreignKeys.filter((key) => key.databaseName === databaseName && key.tableName === tableName),
          }
        })

      return { name: databaseName, tables: databaseTables }
    })
}

export function registerDatabaseIpc(): void {
  ipcMain.handle('db:listConnections', () => {
    const savedConnections = getDb().prepare(`
      SELECT id, type AS driver, name, host, port, user, database, read_only AS readOnly, last_used_at AS lastUsedAt
      FROM db_connections
      ORDER BY COALESCE(last_used_at, '') DESC, name
    `).all() as Array<Record<string, unknown> & { id: number }>

    return savedConnections.map((connection) => {
      const state = connectionStates.get(connection.id)
      return {
        ...connection,
        readOnly: Boolean(connection.readOnly),
        status: state?.status ?? (pools.has(connection.id) ? 'connected' : 'disconnected'),
        statusError: state?.error,
      }
    })
  })

  ipcMain.handle('db:saveConnection', (_event, input: DbConnectionInput) => {
    const connection = normalizeConnection(input)
    const result = getDb().prepare(`
      INSERT INTO db_connections (name, type, host, port, database, user, encrypted_password, read_only)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      connection.name,
      connection.driver,
      connection.host,
      connection.port,
      connection.database,
      connection.user,
      encryptPassword(connection.password),
      connection.readOnly ? 1 : 0,
    )

    const connectionId = Number(result.lastInsertRowid)
    touchConnection(connectionId)
    setConnectionState(connectionId, 'disconnected')
    return connectionId
  })

  ipcMain.handle('db:updateConnection', (_event, connectionId: number, input: DbConnectionInput) => {
    const previous = getSavedConnection(connectionId)
    if (!previous) throw new Error('Connessione non trovata.')

    const connection = normalizeConnection(input)
    const encryptedPassword = connection.password
      ? encryptPassword(connection.password)
      : previous.encrypted_password

    getDb().prepare(`
      UPDATE db_connections
      SET name = ?, type = ?, host = ?, port = ?, database = ?, user = ?, encrypted_password = ?, read_only = ?
      WHERE id = ?
    `).run(
      connection.name,
      connection.driver,
      connection.host,
      connection.port,
      connection.database,
      connection.user,
      encryptedPassword,
      connection.readOnly ? 1 : 0,
      connectionId,
    )

    const entry = pools.get(connectionId)
    if (entry) {
      void entry.pool.end()
      pools.delete(connectionId)
    }
    setConnectionState(connectionId, 'disconnected')
    return true
  })

  ipcMain.handle('db:testConnection', async (_event, input: DbConnectionInput) => {
    try {
      await testConnection(input)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('db:connect', async (_event, connectionId: number) => {
    await reconnect(connectionId)
    return true
  })

  ipcMain.handle('db:getSchema', async (_event, connectionId: number) => {
    return getDatabaseSchema(connectionId)
  })

  ipcMain.handle('db:query', async (_event, connectionId: number, query: string, params: unknown[] = []) => {
    return executeDatabaseQuery(connectionId, query, params)
  })

  ipcMain.handle('db:browseTable', async (
    _event,
    connectionId: number,
    databaseName: string,
    tableName: string,
    page: number,
    pageSize: number,
  ) => {
    const connection = getSavedConnection(connectionId)
    if (!connection) throw new Error('Connessione non trovata.')

    const limit = Math.max(1, Math.min(500, pageSize))
    const offset = Math.max(0, page - 1) * limit
    const tableRef = `${quoteIdentifier(connection.driver, databaseName)}.${quoteIdentifier(connection.driver, tableName)}`

    const dataQuery = connection.driver === 'mysql'
      ? `SELECT * FROM ${tableRef} LIMIT ${limit} OFFSET ${offset}`
      : `SELECT * FROM ${tableRef} LIMIT $1 OFFSET $2`
    const countQuery = `SELECT COUNT(*) AS total FROM ${tableRef}`
    const [data, count] = await Promise.all([
      queryPool(connectionId, dataQuery, connection.driver === 'mysql' ? [] : [limit, offset]),
      queryPool(connectionId, countQuery),
    ])
    const total = Number(count.rows[0]?.total ?? 0)

    return { ...data, total, page, pageSize: limit }
  })

  ipcMain.handle('db:disconnect', async (_event, connectionId: number) => {
    const entry = pools.get(connectionId)
    if (!entry) {
      setConnectionState(connectionId, 'disconnected')
      return true
    }

    await entry.pool.end()
    pools.delete(connectionId)
    setConnectionState(connectionId, 'disconnected')
    return true
  })

  ipcMain.handle('db:deleteConnection', async (_event, connectionId: number) => {
    const entry = pools.get(connectionId)
    if (entry) {
      await entry.pool.end()
      pools.delete(connectionId)
    }

    getDb().prepare('DELETE FROM db_connections WHERE id = ?').run(connectionId)
    connectionStates.delete(connectionId)
    return true
  })
}
