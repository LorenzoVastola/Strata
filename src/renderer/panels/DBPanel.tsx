import Editor, { type OnMount } from '@monaco-editor/react'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Download,
  Key,
  Link,
  Loader2,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  Table2,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

type DbTab =
  | {
      id: string
      kind: 'table'
      title: string
      connectionId: number
      databaseName: string
      tableName: string
      columnsMeta: DbColumn[]
      page: number
      pageSize: number
      result: DbQueryResult | null
      loading: boolean
      error: string | null
      view: 'data' | 'properties'
    }
  | {
      id: string
      kind: 'query'
      title: string
      connectionId: number
      sql: string
      result: DbQueryResult | null
      loading: boolean
      error: string | null
    }

type Toast = { kind: 'success' | 'error'; message: string } | null

type DBPanelProps = {
  initialConnectionId?: number | null
  newConnectionRequestId?: number
}

type DbContextMenu =
  | { kind: 'connection'; x: number; y: number; connection: DbConnection }
  | { kind: 'table'; x: number; y: number; connection: DbConnection; databaseName: string; table: DbTable }

const defaultForm: DbConnectionInput = {
  driver: 'mysql',
  name: '',
  host: 'localhost',
  port: 3306,
  user: '',
  password: '',
  database: '',
}

const formatDuration = (duration: number) => `${Math.round(duration)}ms`

const isPrimaryKey = (column: DbColumn) => column.columnKey === 'PRI'

const isForeignKey = (table: DbTable | null, columnName: string) =>
  Boolean(table?.foreignKeys.some((key) => key.columnName === columnName))

const getColumnKeyLabel = (table: DbTable | null, column: DbColumn) => {
  const keys = []
  if (isPrimaryKey(column)) keys.push('PK')
  if (isForeignKey(table, column.name)) keys.push('FK')
  if (column.columnKey === 'UNI') keys.push('UNI')
  if (column.columnKey === 'MUL' && !isForeignKey(table, column.name)) keys.push('INDEX')
  return keys.join(', ')
}

const groupIndexes = (indexes: DbIndex[]) => {
  const grouped = new Map<string, { name: string; type: string; columns: string[] }>()

  indexes.forEach((index) => {
    const existing = grouped.get(index.name) ?? {
      name: index.name,
      type: index.name === 'PRIMARY' ? 'PRIMARY' : index.nonUnique === 0 ? 'UNIQUE' : 'INDEX',
      columns: [],
    }
    if (index.columnName) existing.columns.push(index.columnName)
    grouped.set(index.name, existing)
  })

  return [...grouped.values()]
}

const connectionStatusClass: Record<NonNullable<DbConnection['status']>, string> = {
  connected: 'bg-emerald-500',
  disconnected: 'bg-zinc-500',
  error: 'bg-red-500',
}

const stringifyValue = (value: unknown) => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function exportRows(result: DbQueryResult | null, format: 'csv' | 'json', filename: string) {
  if (!result) return

  const content = format === 'json'
    ? JSON.stringify(result.rows, null, 2)
    : [
        result.columns.join(','),
        ...result.rows.map((row) =>
          result.columns
            .map((column) => `"${stringifyValue(row[column]).split('"').join('""')}"`)
            .join(','),
        ),
      ].join('\n')

  const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.${format}`
  link.click()
  URL.revokeObjectURL(url)
}

function DataGrid({
  result,
  columnsMeta,
  table,
}: {
  result: DbQueryResult | null
  columnsMeta: DbColumn[]
  table: DbTable | null
}) {
  const [widths, setWidths] = useState<Record<string, number>>({})
  const columns = result?.columns ?? []

  if (!result) {
    return <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Nessun risultato</div>
  }

  const metaByName = new Map(columnsMeta.map((column) => [column.name, column]))

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-zinc-950">
      <table className="w-full border-separate border-spacing-0 text-left text-xs">
        <thead className="sticky top-0 z-10 bg-zinc-900">
          <tr>
            {columns.map((column) => {
              const meta = metaByName.get(column)
              return (
                <th
                  key={column}
                  className="relative border-b border-r border-zinc-800 px-2 py-2 font-medium text-zinc-200"
                  style={{ minWidth: widths[column] ?? 160, width: widths[column] ?? 160 }}
                >
                  <div className="flex min-w-0 items-center gap-1">
                    {meta && isPrimaryKey(meta) && <Key className="h-3 w-3 shrink-0 text-amber-400" />}
                    {isForeignKey(table, column) && <Link className="h-3 w-3 shrink-0 text-sky-400" />}
                    <span className="truncate">{column}</span>
                  </div>
                  <div className="truncate text-[10px] font-normal text-zinc-500">{meta?.type ?? ''}</div>
                  <span
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-sky-600"
                    onMouseDown={(event) => {
                      const startX = event.clientX
                      const startWidth = widths[column] ?? 160
                      const onMove = (moveEvent: MouseEvent) => {
                        setWidths((prev) => ({
                          ...prev,
                          [column]: Math.max(80, startWidth + moveEvent.clientX - startX),
                        }))
                      }
                      const onUp = () => {
                        window.removeEventListener('mousemove', onMove)
                        window.removeEventListener('mouseup', onUp)
                      }
                      window.addEventListener('mousemove', onMove)
                      window.addEventListener('mouseup', onUp)
                    }}
                  />
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-zinc-900/70">
              {columns.map((column) => {
                const value = row[column]
                return (
                  <td key={column} className="border-b border-r border-zinc-900 px-2 py-1.5 text-zinc-300">
                    {value === null || value === undefined ? (
                      <span className="italic text-zinc-600">NULL</span>
                    ) : (
                      <span className="block max-w-[360px] truncate">{stringifyValue(value)}</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableProperties({ table }: { table: DbTable | null }) {
  if (!table) {
    return <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Nessun metadato tabella</div>
  }

  const indexes = groupIndexes(table.indexes)

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-3 text-xs">
      <section>
        <table className="w-full border-separate border-spacing-0 text-left">
          <thead className="sticky top-0 z-10 bg-zinc-900">
            <tr className="text-zinc-400">
              {['Nome', 'Tipo', 'Nullable', 'Default', 'Key', 'Extra'].map((heading) => (
                <th key={heading} className="border-b border-r border-zinc-800 px-2 py-2 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.columns.map((column) => (
              <tr key={column.name} className="hover:bg-zinc-900/70">
                <td className="border-b border-r border-zinc-900 px-2 py-1.5 text-zinc-200">{column.name}</td>
                <td className="border-b border-r border-zinc-900 px-2 py-1.5 text-zinc-400">{column.type}</td>
                <td className="border-b border-r border-zinc-900 px-2 py-1.5 text-zinc-400">{column.nullable ?? ''}</td>
                <td className="border-b border-r border-zinc-900 px-2 py-1.5 text-zinc-500">{column.defaultValue ?? ''}</td>
                <td className="border-b border-r border-zinc-900 px-2 py-1.5 text-zinc-300">{getColumnKeyLabel(table, column)}</td>
                <td className="border-b border-r border-zinc-900 px-2 py-1.5 text-zinc-500">{column.extra ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-5">
        <h3 className="mb-2 text-[10px] font-medium uppercase text-zinc-500">Indexes</h3>
        {indexes.length === 0 ? (
          <div className="rounded border border-zinc-800 px-3 py-2 text-zinc-600">Nessun indice</div>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead className="bg-zinc-900">
              <tr className="text-zinc-400">
                <th className="border-b border-r border-zinc-800 px-2 py-2 font-medium">Nome indice</th>
                <th className="border-b border-r border-zinc-800 px-2 py-2 font-medium">Tipo</th>
                <th className="border-b border-r border-zinc-800 px-2 py-2 font-medium">Colonne</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((index) => (
                <tr key={index.name} className="hover:bg-zinc-900/70">
                  <td className="border-b border-r border-zinc-900 px-2 py-1.5 text-zinc-200">{index.name}</td>
                  <td className="border-b border-r border-zinc-900 px-2 py-1.5 text-zinc-400">{index.type}</td>
                  <td className="border-b border-r border-zinc-900 px-2 py-1.5 text-zinc-500">{index.columns.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-5">
        <h3 className="mb-2 text-[10px] font-medium uppercase text-zinc-500">Foreign Keys</h3>
        {table.foreignKeys.length === 0 ? (
          <div className="rounded border border-zinc-800 px-3 py-2 text-zinc-600">Nessuna foreign key</div>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead className="bg-zinc-900">
              <tr className="text-zinc-400">
                <th className="border-b border-r border-zinc-800 px-2 py-2 font-medium">Nome FK</th>
                <th className="border-b border-r border-zinc-800 px-2 py-2 font-medium">Relazione</th>
              </tr>
            </thead>
            <tbody>
              {table.foreignKeys.map((key) => (
                <tr key={`${key.name}:${key.columnName}`} className="hover:bg-zinc-900/70">
                  <td className="border-b border-r border-zinc-900 px-2 py-1.5 text-zinc-200">{key.name}</td>
                  <td className="border-b border-r border-zinc-900 px-2 py-1.5 text-zinc-500">
                    {key.columnName} -&gt; {key.referencedTable}.{key.referencedColumn}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

export default function DBPanel({ initialConnectionId = null, newConnectionRequestId = 0 }: DBPanelProps) {
  const [connections, setConnections] = useState<DbConnection[]>([])
  const [schemas, setSchemas] = useState<Record<number, DbSchemaNode[]>>({})
  const [schemaLoading, setSchemaLoading] = useState<Record<number, boolean>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null)
  const [isDialogOpen, setDialogOpen] = useState(false)
  const [editingConnectionId, setEditingConnectionId] = useState<number | null>(null)
  const [form, setForm] = useState<DbConnectionInput>(defaultForm)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [toast, setToast] = useState<Toast>(null)
  const [tabs, setTabs] = useState<DbTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<DbContextMenu | null>(null)
  const [theme, setTheme] = useState('one-dark-pro')
  const handledInitialConnectionRef = useRef<number | null>(null)
  const handledNewConnectionRequestRef = useRef(0)

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [activeTabId, tabs])
  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId) ?? null

  const loadConnections = async () => {
    const nextConnections = await window.api.database.listConnections()
    console.log('[DBPanel] listConnections response', {
      connectionIds: nextConnections.map((connection) => connection.id),
      connections: nextConnections.map((connection) => ({
        id: connection.id,
        idType: typeof connection.id,
        name: connection.name,
        host: connection.host,
        database: connection.database,
        status: connection.status,
      })),
    })
    setConnections(nextConnections)
    setSelectedConnectionId((prev) => prev ?? nextConnections[0]?.id ?? null)
  }

  const setConnectionStatus = (
    connectionId: number,
    status: NonNullable<DbConnection['status']>,
    statusError?: string,
  ) => {
    setConnections((prev) =>
      prev.map((connection) =>
        connection.id === connectionId ? { ...connection, status, statusError } : connection,
      ),
    )
  }

  const showToast = (nextToast: Toast) => {
    setToast(nextToast)
    window.setTimeout(() => setToast(null), 2800)
  }

  useEffect(() => {
    void loadConnections()
  }, [])

  useEffect(() => {
    window.api.getEditorSettings().then((s) => setTheme(s.theme || 'one-dark-pro')).catch(() => {})
    const handler = (e: Event) => setTheme((e as CustomEvent<string>).detail)
    window.addEventListener('strata:theme-change', handler)
    return () => window.removeEventListener('strata:theme-change', handler)
  }, [])

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null)
    window.addEventListener('click', closeContextMenu)
    return () => window.removeEventListener('click', closeContextMenu)
  }, [])

  useEffect(() => {
    console.log('[DBPanel] render schema tree state', {
      connectionIds: Object.keys(schemas),
      schemas,
    })
  }, [schemas])

  const updateForm = <K extends keyof DbConnectionInput>(key: K, value: DbConnectionInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setTestState('idle')
  }

  const updateDriver = (driver: DbDriver) => {
    setForm((prev) => ({
      ...prev,
      driver,
      port: driver === 'mysql' ? 3306 : 5432,
    }))
    setTestState('idle')
  }

  const testConnection = async () => {
    console.log('[DBPanel] db:testConnection request', {
      form: {
        driver: form.driver,
        name: form.name,
        host: form.host,
        port: form.port,
        user: form.user,
        database: form.database,
        hasPassword: Boolean(form.password),
      },
    })
    setTestState('testing')
    const result = await window.api.database.testConnection(form)
    console.log('[DBPanel] db:testConnection response', result)
    if (result.success) {
      setTestState('success')
      showToast({ kind: 'success', message: 'Connessione riuscita.' })
    } else {
      setTestState('error')
      showToast({ kind: 'error', message: result.error ?? 'Connessione fallita.' })
    }
  }

  const saveConnection = async () => {
    console.log('[DBPanel] db:saveConnection request', {
      editingConnectionId,
      form: {
        driver: form.driver,
        name: form.name,
        host: form.host,
        port: form.port,
        user: form.user,
        database: form.database,
        hasPassword: Boolean(form.password),
      },
    })
    const id = editingConnectionId
      ? editingConnectionId
      : await window.api.database.saveConnection(form)
    console.log('[DBPanel] db:saveConnection returned id', {
      id,
      idType: typeof id,
      editingConnectionId,
    })
    if (editingConnectionId) {
      await window.api.database.updateConnection(editingConnectionId, form)
      setSchemas((prev) => {
        const next = { ...prev }
        delete next[editingConnectionId]
        return next
      })
    }
    await loadConnections()
    setSelectedConnectionId(id)
    setDialogOpen(false)
    setEditingConnectionId(null)
    setForm(defaultForm)
    setTestState('idle')
    showToast({ kind: 'success', message: editingConnectionId ? 'Connessione aggiornata.' : 'Connessione salvata.' })
  }

  const refreshSchema = async (connectionId: number) => {
    const connection = connections.find((item) => item.id === connectionId)
    setSchemaLoading((prev) => ({ ...prev, [connectionId]: true }))
    try {
      console.log('[DBPanel] refresh requested; id passed to db:getSchema later', {
        connectionId,
        connectionIdType: typeof connectionId,
        selectedConnectionId,
        selectedConnectionIdType: typeof selectedConnectionId,
        knownConnectionIds: connections.map((item) => item.id),
        database: connection?.database,
        connectionName: connection?.name,
      })
      console.log('[DBPanel] db:connect request', {
        connectionId,
        connectionIdType: typeof connectionId,
      })
      await window.api.database.connect(connectionId)
      console.log('[DBPanel] db:getSchema request', {
        connectionId,
        connectionIdType: typeof connectionId,
        database: connection?.database,
      })
      const schema = await window.api.database.getSchema(connectionId)
      console.log('[DBPanel] db:getSchema response', {
        connectionId,
        database: connection?.database,
        schema,
        schemaCount: schema.length,
        tableCount: schema.reduce((count, node) => count + node.tables.length, 0),
      })
      setSchemas((prev) => ({ ...prev, [connectionId]: schema }))
      setConnectionStatus(connectionId, 'connected')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setConnectionStatus(connectionId, 'error', message)
      showToast({ kind: 'error', message })
    } finally {
      setSchemaLoading((prev) => ({ ...prev, [connectionId]: false }))
    }
  }

  const connectConnection = async (connectionId: number) => {
    setSchemaLoading((prev) => ({ ...prev, [connectionId]: true }))
    try {
      await window.api.database.connect(connectionId)
      setConnectionStatus(connectionId, 'connected')
      showToast({ kind: 'success', message: 'Connessione attiva.' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setConnectionStatus(connectionId, 'error', message)
      showToast({ kind: 'error', message })
    } finally {
      setSchemaLoading((prev) => ({ ...prev, [connectionId]: false }))
    }
  }

  const toggleConnection = async (connectionId: number) => {
    const key = `connection:${connectionId}`
    const willOpen = !expanded.has(key)
    setSelectedConnectionId(connectionId)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

    if (willOpen && !schemas[connectionId]) {
      await refreshSchema(connectionId)
    }
  }

  const toggleNode = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const loadTablePage = async (tabId: string, nextPage?: number, nextPageSize?: number) => {
    const tab = tabs.find((item) => item.id === tabId)
    if (!tab || tab.kind !== 'table') return

    const page = nextPage ?? tab.page
    const pageSize = nextPageSize ?? tab.pageSize
    setTabs((prev) => prev.map((item) => item.id === tabId ? { ...item, loading: true, error: null } : item))
    try {
      const result = await window.api.database.browseTable(
        tab.connectionId,
        tab.databaseName,
        tab.tableName,
        page,
        pageSize,
      )
      setConnectionStatus(tab.connectionId, 'connected')
      setTabs((prev) =>
        prev.map((item) =>
          item.id === tabId && item.kind === 'table'
            ? { ...item, page, pageSize, result, loading: false }
            : item,
        ),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setConnectionStatus(tab.connectionId, 'error', message)
      setTabs((prev) =>
        prev.map((item) =>
          item.id === tabId && item.kind === 'table'
            ? { ...item, loading: false, error: message }
            : item,
        ),
      )
    }
  }

  const openTable = (connectionId: number, databaseName: string, table: DbTable) => {
    const id = `table:${connectionId}:${databaseName}:${table.name}`
    if (!tabs.some((tab) => tab.id === id)) {
      setTabs((prev) => [
        ...prev,
        {
          id,
          kind: 'table',
          title: table.name,
          connectionId,
          databaseName,
          tableName: table.name,
          columnsMeta: table.columns,
          page: 1,
          pageSize: 100,
          result: null,
          loading: true,
          error: null,
          view: 'data',
        },
      ])
      void window.api.database.browseTable(connectionId, databaseName, table.name, 1, 100)
        .then((result) => {
          setConnectionStatus(connectionId, 'connected')
          setTabs((prev) =>
            prev.map((tab) => tab.id === id && tab.kind === 'table' ? { ...tab, result, loading: false } : tab),
          )
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          setConnectionStatus(connectionId, 'error', message)
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === id && tab.kind === 'table'
                ? { ...tab, loading: false, error: message }
                : tab,
            ),
          )
        })
    }
    setActiveTabId(id)
  }

  const openQuery = (connectionId = selectedConnectionId) => {
    if (!connectionId) return

    const id = `query:${Date.now()}`
    setTabs((prev) => [
      ...prev,
      {
        id,
        kind: 'query',
        title: 'New Query',
        connectionId,
        sql: 'SELECT 1;',
        result: null,
        loading: false,
        error: null,
      },
    ])
    setActiveTabId(id)
  }

  const openNewConnectionDialog = () => {
    setEditingConnectionId(null)
    setForm(defaultForm)
    setTestState('idle')
    setDialogOpen(true)
  }

  const openEditConnectionDialog = (connection: DbConnection) => {
    setEditingConnectionId(connection.id)
    setForm({
      driver: connection.driver,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: '',
      database: connection.database,
    })
    setTestState('success')
    setDialogOpen(true)
  }

  useEffect(() => {
    if (!initialConnectionId) return
    if (handledInitialConnectionRef.current === initialConnectionId) return
    const target = connections.find((connection) => connection.id === initialConnectionId)
    if (!target) return

    handledInitialConnectionRef.current = initialConnectionId
    setSelectedConnectionId(initialConnectionId)
    setExpanded((prev) => new Set(prev).add(`connection:${initialConnectionId}`))
    setSchemaLoading((prev) => ({ ...prev, [initialConnectionId]: true }))
    void (async () => {
      try {
        await window.api.database.connect(initialConnectionId)
        const schema = await window.api.database.getSchema(initialConnectionId)
        setSchemas((prev) => ({ ...prev, [initialConnectionId]: schema }))
        setConnections((prev) =>
          prev.map((connection) =>
            connection.id === initialConnectionId ? { ...connection, status: 'connected' } : connection,
          ),
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setConnections((prev) =>
          prev.map((connection) =>
            connection.id === initialConnectionId ? { ...connection, status: 'error', statusError: message } : connection,
          ),
        )
        setToast({ kind: 'error', message })
        window.setTimeout(() => setToast(null), 2800)
      } finally {
        setSchemaLoading((prev) => ({ ...prev, [initialConnectionId]: false }))
      }
    })()
  }, [connections, initialConnectionId])

  useEffect(() => {
    if (!newConnectionRequestId) return
    if (handledNewConnectionRequestRef.current === newConnectionRequestId) return

    handledNewConnectionRequestRef.current = newConnectionRequestId
    openNewConnectionDialog()
  }, [newConnectionRequestId])

  const disconnectConnection = async (connectionId: number) => {
    await window.api.database.disconnect(connectionId)
    setConnectionStatus(connectionId, 'disconnected')
    setSchemas((prev) => {
      const next = { ...prev }
      delete next[connectionId]
      return next
    })
    setExpanded((prev) => {
      const next = new Set(prev)
      next.delete(`connection:${connectionId}`)
      return next
    })
    showToast({ kind: 'success', message: 'Connessione disconnessa.' })
  }

  const deleteConnection = async (connection: DbConnection) => {
    if (!window.confirm(`Eliminare la connessione "${connection.name}"?`)) return

    await window.api.database.deleteConnection(connection.id)
    const nextTabs = tabs.filter((tab) => tab.connectionId !== connection.id)
    setSchemas((prev) => {
      const next = { ...prev }
      delete next[connection.id]
      return next
    })
    setTabs(nextTabs)
    setActiveTabId((prev) => prev && nextTabs.some((tab) => tab.id === prev) ? prev : nextTabs[0]?.id ?? null)
    await loadConnections()
    showToast({ kind: 'success', message: 'Connessione eliminata.' })
  }

  const runQuery = async (tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId)
    if (!tab || tab.kind !== 'query') return

    setTabs((prev) => prev.map((item) => item.id === tabId ? { ...item, loading: true, error: null } : item))
    try {
      const result = await window.api.database.query(tab.connectionId, tab.sql)
      setConnectionStatus(tab.connectionId, 'connected')
      setTabs((prev) =>
        prev.map((item) => item.id === tabId && item.kind === 'query' ? { ...item, result, loading: false } : item),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setConnectionStatus(tab.connectionId, 'error', message)
      setTabs((prev) =>
        prev.map((item) =>
          item.id === tabId && item.kind === 'query'
            ? { ...item, loading: false, error: message }
            : item,
        ),
      )
    }
  }

  const closeTab = (tabId: string) => {
    const index = tabs.findIndex((tab) => tab.id === tabId)
    const nextTabs = tabs.filter((tab) => tab.id !== tabId)
    setTabs(nextTabs)
    if (activeTabId === tabId) setActiveTabId(nextTabs[index] ? nextTabs[index].id : nextTabs[index - 1]?.id ?? null)
  }

  const activeTableMeta = activeTab?.kind === 'table'
    ? schemas[activeTab.connectionId]
      ?.find((schema) => schema.name === activeTab.databaseName)
      ?.tables.find((table) => table.name === activeTab.tableName) ?? null
    : null

  return (
    <div className="relative flex h-full w-full bg-zinc-950 text-zinc-100" style={{ background: 'var(--strata-bg)', color: 'var(--strata-text)' }}>
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900" style={{ background: 'var(--strata-sidebar)', borderColor: 'var(--strata-border)' }}>
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
          <Database className="h-4 w-4 text-zinc-400" />
          <span className="min-w-0 flex-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
            Database
          </span>
          <button
            type="button"
            title="Nuova connessione"
            onClick={openNewConnectionDialog}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {connections.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-zinc-400">Connetti il tuo primo database</p>
              <button
                type="button"
                onClick={openNewConnectionDialog}
                className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
              >
                Nuova connessione
              </button>
            </div>
          ) : (
            connections.map((connection) => {
              const connectionKey = `connection:${connection.id}`
              const isConnectionOpen = expanded.has(connectionKey)
              const connectionSchemas = schemas[connection.id] ?? []
              const isSchemaLoading = Boolean(schemaLoading[connection.id])

              return (
                <div key={connection.id}>
                  <button
                    type="button"
                    onClick={() => void toggleConnection(connection.id)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setSelectedConnectionId(connection.id)
                      setContextMenu({ kind: 'connection', x: event.clientX, y: event.clientY, connection })
                    }}
                    className={`flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs hover:bg-zinc-800 ${
                      selectedConnectionId === connection.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300'
                    }`}
                  >
                    {isConnectionOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    <span
                      title={connection.statusError ?? connection.status ?? 'disconnected'}
                      className={`h-2 w-2 shrink-0 rounded-full ${connectionStatusClass[connection.status ?? 'disconnected']}`}
                    />
                    <Database className="h-3.5 w-3.5 text-sky-400" />
                    <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                    {isSchemaLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />}
                    <span className="text-[10px] text-zinc-500">{connection.driver}</span>
                  </button>

                  {isConnectionOpen && (
                    <div className="ml-5 border-l border-white/10">
                      {isSchemaLoading ? (
                        <div className="flex items-center gap-2 px-2 py-2 text-xs text-zinc-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Caricamento schema...
                        </div>
                      ) : connectionSchemas.length === 0 ? (
                        <div className="px-2 py-2 text-xs text-zinc-600">Schema vuoto</div>
                      ) : connectionSchemas.length === 1 ? (
                        connectionSchemas[0].tables.map((table) => {
                          const schema = connectionSchemas[0]
                          const tableKey = `${connection.id}:${schema.name}:${table.name}`
                          const isTableOpen = expanded.has(tableKey)

                          return (
                            <div key={tableKey}>
                              <button
                                type="button"
                                onClick={() => toggleNode(tableKey)}
                                onDoubleClick={() => openTable(connection.id, schema.name, table)}
                                onContextMenu={(event) => {
                                  event.preventDefault()
                                  setContextMenu({
                                    kind: 'table',
                                    x: event.clientX,
                                    y: event.clientY,
                                    connection,
                                    databaseName: schema.name,
                                    table,
                                  })
                                }}
                                className="flex w-full items-center gap-1 px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800"
                              >
                                {isTableOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                <Table2 className="h-3.5 w-3.5 text-amber-400" />
                                <span className="min-w-0 flex-1 truncate">{table.name}</span>
                              </button>

                              {isTableOpen && (
                                <div className="ml-5 border-l border-white/10 text-xs">
                                  {table.columns.map((column) => (
                                    <div key={column.name} className="flex items-center gap-1 px-2 py-0.5 text-zinc-500">
                                      {isPrimaryKey(column) && <Key className="h-3 w-3 text-amber-400" />}
                                      {isForeignKey(table, column.name) && <Link className="h-3 w-3 text-sky-400" />}
                                      <span className="min-w-0 flex-1 truncate">{column.name}</span>
                                      <span className="truncate text-[10px] text-zinc-600">{column.type}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })
                      ) : connectionSchemas.map((schema) => {
                        const schemaKey = `${connection.id}:${schema.name}`
                        const isSchemaOpen = expanded.has(schemaKey)

                        return (
                          <div key={schemaKey}>
                            <button
                              type="button"
                              onClick={() => toggleNode(schemaKey)}
                              className="flex w-full items-center gap-1 px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800"
                            >
                              {isSchemaOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              <Database className="h-3.5 w-3.5 text-emerald-400" />
                              <span className="truncate">{schema.name}</span>
                            </button>

                            {isSchemaOpen && (
                              <div className="ml-5 border-l border-white/10">
                                {schema.tables.map((table) => {
                                  const tableKey = `${schemaKey}:${table.name}`
                                  const isTableOpen = expanded.has(tableKey)

                                  return (
                                    <div key={tableKey}>
                                      <button
                                        type="button"
                                        onClick={() => toggleNode(tableKey)}
                                        onDoubleClick={() => openTable(connection.id, schema.name, table)}
                                        onContextMenu={(event) => {
                                          event.preventDefault()
                                          setContextMenu({
                                            kind: 'table',
                                            x: event.clientX,
                                            y: event.clientY,
                                            connection,
                                            databaseName: schema.name,
                                            table,
                                          })
                                        }}
                                        className="flex w-full items-center gap-1 px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800"
                                      >
                                        {isTableOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                        <Table2 className="h-3.5 w-3.5 text-amber-400" />
                                        <span className="min-w-0 flex-1 truncate">{table.name}</span>
                                      </button>

                                      {isTableOpen && (
                                        <div className="ml-5 border-l border-white/10 text-xs">
                                          <div className="px-2 py-1 text-[10px] uppercase text-zinc-600">Columns</div>
                                          {table.columns.map((column) => (
                                            <div key={column.name} className="flex items-center gap-1 px-2 py-0.5 text-zinc-500">
                                              {isPrimaryKey(column) && <Key className="h-3 w-3 text-amber-400" />}
                                              {isForeignKey(table, column.name) && <Link className="h-3 w-3 text-sky-400" />}
                                              <span className="min-w-0 flex-1 truncate">{column.name}</span>
                                              <span className="truncate text-[10px] text-zinc-600">{column.type}</span>
                                            </div>
                                          ))}
                                          <div className="px-2 py-1 text-[10px] uppercase text-zinc-600">Indexes</div>
                                          {table.indexes.map((index) => (
                                            <div key={`${index.name}:${index.columnName ?? index.definition}`} className="px-2 py-0.5 text-zinc-500">
                                              {index.name}
                                            </div>
                                          ))}
                                          <div className="px-2 py-1 text-[10px] uppercase text-zinc-600">Foreign Keys</div>
                                          {table.foreignKeys.map((key) => (
                                            <div key={`${key.name}:${key.columnName}`} className="px-2 py-0.5 text-zinc-500">
                                              {key.columnName} -&gt; {key.referencedTable}.{key.referencedColumn}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="flex h-10 shrink-0 items-center border-t border-zinc-800 px-2">
          <button
            type="button"
            onClick={() => openQuery()}
            disabled={!selectedConnectionId}
            className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
          >
            New Query
          </button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="tabbar-scroll flex h-9 shrink-0 overflow-x-auto border-b border-zinc-800 bg-zinc-950" style={{ background: 'var(--strata-tab-bar)', borderColor: 'var(--strata-border)' }}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex h-9 min-w-40 items-center gap-2 border-r border-zinc-800 px-3 text-xs ${
                tab.id === activeTabId ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500'
              }`}
              style={tab.id === activeTabId ? { background: 'var(--strata-tab-active)', color: 'var(--strata-text)', borderColor: 'var(--strata-border)' } : { borderColor: 'var(--strata-border)' }}
            >
              <button type="button" onClick={() => setActiveTabId(tab.id)} className="min-w-0 flex-1 truncate text-left">
                {tab.title}
              </button>
              <button
                type="button"
                aria-label={`Chiudi ${tab.title}`}
                onClick={() => closeTab(tab.id)}
                className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {!activeTab ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Database className="h-10 w-10 text-zinc-700" />
            <p className="text-sm text-zinc-500">
              {connections.length === 0 ? 'Connetti il tuo primo database' : 'Seleziona una tabella o apri una query'}
            </p>
            {connections.length === 0 && (
              <button
                type="button"
                onClick={openNewConnectionDialog}
                className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
              >
                Nuova connessione
              </button>
            )}
          </div>
        ) : activeTab.kind === 'table' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
              <div className="flex rounded border border-zinc-800 bg-zinc-950 p-0.5">
                {(['data', 'properties'] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => {
                      setTabs((prev) =>
                        prev.map((tab) =>
                          tab.id === activeTab.id && tab.kind === 'table' ? { ...tab, view } : tab,
                        ),
                      )
                    }}
                    className={`rounded px-2 py-1 text-xs ${
                      activeTab.view === view ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
                    }`}
                  >
                    {view === 'data' ? 'Data' : 'Properties'}
                  </button>
                ))}
              </div>

              {activeTab.view === 'data' && (
                <>
                  <button
                    type="button"
                    onClick={() => void loadTablePage(activeTab.id)}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button type="button" className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800">
                    Insert riga
                  </button>
                  <button
                    type="button"
                    onClick={() => exportRows(activeTab.result, 'csv', activeTab.tableName)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => exportRows(activeTab.result, 'json', activeTab.tableName)}
                    className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                  >
                    JSON
                  </button>
                  <div className="flex-1" />
                  <select
                    value={activeTab.pageSize}
                    onChange={(event) => void loadTablePage(activeTab.id, 1, Number(event.target.value))}
                    className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={500}>500</option>
                  </select>
                  <button
                    type="button"
                    disabled={activeTab.page <= 1}
                    onClick={() => void loadTablePage(activeTab.id, activeTab.page - 1)}
                    className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(activeTab.result?.total && activeTab.page * activeTab.pageSize >= activeTab.result.total)}
                    onClick={() => void loadTablePage(activeTab.id, activeTab.page + 1)}
                    className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
                  >
                    Next
                  </button>
                </>
              )}
            </div>
            {activeTab.error && <div className="border-b border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">{activeTab.error}</div>}
            {activeTab.view === 'properties' ? (
              <TableProperties table={activeTableMeta} />
            ) : activeTab.loading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Caricamento...</div>
            ) : (
              <DataGrid result={activeTab.result} columnsMeta={activeTab.columnsMeta} table={activeTableMeta} />
            )}
            <div className="h-7 shrink-0 border-t border-zinc-800 px-3 py-1 text-xs text-zinc-500">
              {activeTab.view === 'properties'
                ? `${activeTableMeta?.columns.length ?? activeTab.columnsMeta.length} columns`
                : activeTab.result
                ? `Showing ${(activeTab.page - 1) * activeTab.pageSize + 1}-${Math.min(activeTab.page * activeTab.pageSize, activeTab.result.total ?? activeTab.result.rowCount)} of ${activeTab.result.total ?? activeTab.result.rowCount} rows · ${formatDuration(activeTab.result.duration)}`
                : 'Showing 0 rows'}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
              <button
                type="button"
                onClick={() => void runQuery(activeTab.id)}
                className="flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600"
              >
                <Play className="h-3.5 w-3.5" />
                Run
              </button>
              <span className="text-xs text-zinc-500">{selectedConnection?.name}</span>
            </div>
            <div className="h-64 shrink-0 border-b border-zinc-800">
              <Editor
                height="100%"
                language="sql"
                theme={theme}
                value={activeTab.sql}
                onChange={(value) => {
                  const sql = value ?? ''
                  setTabs((prev) => prev.map((tab) => tab.id === activeTab.id && tab.kind === 'query' ? { ...tab, sql } : tab))
                }}
                onMount={((editor, monaco) => {
                  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                    void runQuery(activeTab.id)
                  })
                }) as OnMount}
                options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on' }}
              />
            </div>
            {activeTab.error && <div className="border-b border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">{activeTab.error}</div>}
            {activeTab.loading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Esecuzione...</div>
            ) : (
              <DataGrid result={activeTab.result} columnsMeta={[]} table={null} />
            )}
            <div className="h-7 shrink-0 border-t border-zinc-800 px-3 py-1 text-xs text-zinc-500">
              {activeTab.result
                ? `${activeTab.result.rowCount} rows · ${formatDuration(activeTab.result.duration)}`
                : 'Ctrl+Enter per eseguire'}
            </div>
          </div>
        )}
      </section>

      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="w-[460px] rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex h-11 items-center border-b border-zinc-800 px-4">
              <span className="flex-1 text-sm font-medium">{editingConnectionId ? 'Modifica connessione' : 'Nuova connessione'}</span>
              <button
                type="button"
                onClick={() => {
                  setDialogOpen(false)
                  setEditingConnectionId(null)
                }}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 text-xs">
              <label className="col-span-2 flex flex-col gap-1">
                Driver
                <select
                  value={form.driver}
                  onChange={(event) => updateDriver(event.target.value as DbDriver)}
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none"
                >
                  <option value="mysql">MySQL</option>
                  <option value="postgres">PostgreSQL</option>
                </select>
              </label>
              <label className="col-span-2 flex flex-col gap-1">
                Nome
                <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 outline-none" />
              </label>
              <label className="flex flex-col gap-1">
                Host
                <input value={form.host} onChange={(event) => updateForm('host', event.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 outline-none" />
              </label>
              <label className="flex flex-col gap-1">
                Port
                <input type="number" value={form.port} onChange={(event) => updateForm('port', Number(event.target.value))} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 outline-none" />
              </label>
              <label className="flex flex-col gap-1">
                User
                <input value={form.user} onChange={(event) => updateForm('user', event.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 outline-none" />
              </label>
              <label className="flex flex-col gap-1">
                Password
                <input type="password" value={form.password} onChange={(event) => updateForm('password', event.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 outline-none" />
              </label>
              <label className="col-span-2 flex flex-col gap-1">
                Database
                <input value={form.database} onChange={(event) => updateForm('database', event.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 outline-none" />
              </label>
            </div>
            <div className="flex items-center gap-2 border-t border-zinc-800 px-4 py-3">
              <span className="flex-1 text-xs text-zinc-500">
                {testState === 'success'
                  ? editingConnectionId ? 'Lascia la password vuota per mantenerla invariata' : 'Test connessione superato'
                  : testState === 'error' ? 'Test fallito' : ''}
              </span>
              <button
                type="button"
                onClick={() => void testConnection()}
                disabled={testState === 'testing'}
                className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600 disabled:opacity-50"
              >
                {testState === 'testing' ? 'Test...' : 'Test connessione'}
              </button>
              <button
                type="button"
                onClick={() => void saveConnection()}
                disabled={!editingConnectionId && testState !== 'success'}
                className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40"
              >
                {editingConnectionId ? 'Aggiorna' : 'Salva'}
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-48 overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 py-1 text-xs text-zinc-200 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.kind === 'connection' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null)
                  void connectConnection(contextMenu.connection.id)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800"
              >
                <Power className="h-3.5 w-3.5" />
                Connetti
              </button>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null)
                  setExpanded((prev) => new Set(prev).add(`connection:${contextMenu.connection.id}`))
                  void refreshSchema(contextMenu.connection.id)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null)
                  openQuery(contextMenu.connection.id)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Nuova query
              </button>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null)
                  openEditConnectionDialog(contextMenu.connection)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800"
              >
                <Pencil className="h-3.5 w-3.5" />
                Modifica connessione
              </button>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null)
                  void disconnectConnection(contextMenu.connection.id)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800"
              >
                <Power className="h-3.5 w-3.5" />
                Disconnetti
              </button>
              <button
                type="button"
                onClick={() => {
                  const { connection } = contextMenu
                  setContextMenu(null)
                  void deleteConnection(connection)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-300 hover:bg-red-950/50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Elimina connessione
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null)
                  openTable(contextMenu.connection.id, contextMenu.databaseName, contextMenu.table)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800"
              >
                <Table2 className="h-3.5 w-3.5" />
                Browse Data
              </button>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null)
                  openQuery(contextMenu.connection.id)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Nuova query
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(contextMenu.table.name)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800"
              >
                <Copy className="h-3.5 w-3.5" />
                Copia nome tabella
              </button>
            </>
          )}
        </div>
      )}

      {toast && (
        <div
          className={`fixed right-4 top-4 z-50 rounded border px-3 py-2 text-xs shadow-xl ${
            toast.kind === 'success'
              ? 'border-emerald-800 bg-emerald-950 text-emerald-200'
              : 'border-red-800 bg-red-950 text-red-200'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}
