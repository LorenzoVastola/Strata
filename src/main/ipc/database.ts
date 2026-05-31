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
}

const pools = new Map<number, DbPool>()

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
      encrypted_password
    FROM db_connections
    WHERE id = ?
  `).get(connectionId) as SavedConnection | undefined
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

const ensurePool = (connectionId: number) => {
  const existing = pools.get(connectionId)
  if (existing) return existing

  const connection = getSavedConnection(connectionId)
  if (!connection) throw new Error('Connessione non trovata.')

  const pool = createPool(connection)
  const entry = { driver: connection.driver, pool }
  pools.set(connectionId, entry)
  return entry
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

const queryPool = async (connectionId: number, query: string, params: unknown[] = []) => {
  const entry = ensurePool(connectionId)
  const startedAt = performance.now()

  if (entry.driver === 'mysql') {
    const execute = (entry.pool as mysql.Pool).execute as unknown as (
      sql: string,
      values: unknown[],
    ) => Promise<[unknown, mysql.FieldPacket[]]>
    const [rows, fields] = await execute(query, params)
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

  const [databases, tables, columns, indexes, foreignKeys] = await Promise.all([
    queryPool(connectionId, `
      SELECT schema_name AS name
      FROM information_schema.schemata
      WHERE schema_name NOT IN (?, ?, ?, ?)
      ORDER BY schema_name
    `, ['information_schema', 'mysql', 'performance_schema', 'sys']),
    queryPool(connectionId, `
      SELECT table_schema AS databaseName, table_name AS name
      FROM information_schema.tables
      WHERE table_schema NOT IN (?, ?, ?, ?)
      ORDER BY table_schema, table_name
    `, ['information_schema', 'mysql', 'performance_schema', 'sys']),
    queryPool(connectionId, `
      SELECT
        table_schema AS databaseName,
        table_name AS tableName,
        column_name AS name,
        column_type AS type,
        column_key AS columnKey,
        is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema NOT IN (?, ?, ?, ?)
      ORDER BY table_schema, table_name, ordinal_position
    `, ['information_schema', 'mysql', 'performance_schema', 'sys']),
    queryPool(connectionId, `
      SELECT table_schema AS databaseName, table_name AS tableName, index_name AS name, column_name AS columnName, non_unique AS nonUnique
      FROM information_schema.statistics
      WHERE table_schema NOT IN (?, ?, ?, ?)
      ORDER BY table_schema, table_name, index_name, seq_in_index
    `, ['information_schema', 'mysql', 'performance_schema', 'sys']),
    queryPool(connectionId, `
      SELECT
        constraint_schema AS databaseName,
        table_name AS tableName,
        constraint_name AS name,
        column_name AS columnName,
        referenced_table_name AS referencedTable,
        referenced_column_name AS referencedColumn
      FROM information_schema.key_column_usage
      WHERE referenced_table_name IS NOT NULL AND constraint_schema NOT IN (?, ?, ?, ?)
      ORDER BY constraint_schema, table_name, constraint_name
    `, ['information_schema', 'mysql', 'performance_schema', 'sys']),
  ])

  return buildSchemaTree(databases.rows, tables.rows, columns.rows, indexes.rows, foreignKeys.rows)
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
    return getDb().prepare(`
      SELECT id, type AS driver, name, host, port, user, database
      FROM db_connections
      ORDER BY name
    `).all()
  })

  ipcMain.handle('db:saveConnection', (_event, input: DbConnectionInput) => {
    const connection = normalizeConnection(input)
    const result = getDb().prepare(`
      INSERT INTO db_connections (name, type, host, port, database, user, encrypted_password)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      connection.name,
      connection.driver,
      connection.host,
      connection.port,
      connection.database,
      connection.user,
      encryptPassword(connection.password),
    )

    return Number(result.lastInsertRowid)
  })

  ipcMain.handle('db:testConnection', async (_event, input: DbConnectionInput) => {
    try {
      await testConnection(input)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('db:connect', async (_event, connectionId: number) => {
    ensurePool(connectionId)
    return true
  })

  ipcMain.handle('db:getSchema', async (_event, connectionId: number) => {
    const connection = getSavedConnection(connectionId)
    if (!connection) throw new Error('Connessione non trovata.')
    return connection.driver === 'mysql' ? getMysqlSchema(connectionId) : getPostgresSchema(connectionId)
  })

  ipcMain.handle('db:query', async (_event, connectionId: number, query: string, params: unknown[] = []) => {
    return queryPool(connectionId, query, params)
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
    const tableRef = connection.driver === 'mysql'
      ? `${quoteIdentifier(connection.driver, databaseName)}.${quoteIdentifier(connection.driver, tableName)}`
      : `${quoteIdentifier(connection.driver, databaseName)}.${quoteIdentifier(connection.driver, tableName)}`

    const dataQuery = connection.driver === 'mysql'
      ? `SELECT * FROM ${tableRef} LIMIT ? OFFSET ?`
      : `SELECT * FROM ${tableRef} LIMIT $1 OFFSET $2`
    const countQuery = `SELECT COUNT(*) AS total FROM ${tableRef}`
    const [data, count] = await Promise.all([
      queryPool(connectionId, dataQuery, [limit, offset]),
      queryPool(connectionId, countQuery),
    ])
    const total = Number(count.rows[0]?.total ?? 0)

    return { ...data, total, page, pageSize: limit }
  })

  ipcMain.handle('db:disconnect', async (_event, connectionId: number) => {
    const entry = pools.get(connectionId)
    if (!entry) return true

    await entry.pool.end()
    pools.delete(connectionId)
    return true
  })
}
