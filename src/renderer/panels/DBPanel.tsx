import Editor, { type OnMount } from '@monaco-editor/react'
import {
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Key,
  Link,
  Play,
  Plus,
  RefreshCw,
  Table2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

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

const defaultForm: DbConnectionInput = {
  driver: 'mysql',
  name: '',
  host: 'localhost',
  port: 3306,
  user: '',
  password: '',
  database: '',
}

const formatDuration = (duration: number) => `${(duration / 1000).toFixed(2)}s`

const isPrimaryKey = (column: DbColumn) => column.columnKey === 'PRI'

const isForeignKey = (table: DbTable | null, columnName: string) =>
  Boolean(table?.foreignKeys.some((key) => key.columnName === columnName))

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

export default function DBPanel() {
  const [connections, setConnections] = useState<DbConnection[]>([])
  const [schemas, setSchemas] = useState<Record<number, DbSchemaNode[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null)
  const [isDialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<DbConnectionInput>(defaultForm)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [toast, setToast] = useState<Toast>(null)
  const [tabs, setTabs] = useState<DbTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [activeTabId, tabs])
  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId) ?? null

  const loadConnections = async () => {
    const nextConnections = await window.api.database.listConnections()
    setConnections(nextConnections)
    setSelectedConnectionId((prev) => prev ?? nextConnections[0]?.id ?? null)
  }

  const showToast = (nextToast: Toast) => {
    setToast(nextToast)
    window.setTimeout(() => setToast(null), 2800)
  }

  useEffect(() => {
    void loadConnections()
  }, [])

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
    setTestState('testing')
    const result = await window.api.database.testConnection(form)
    if (result.success) {
      setTestState('success')
      showToast({ kind: 'success', message: 'Connessione riuscita.' })
    } else {
      setTestState('error')
      showToast({ kind: 'error', message: result.error ?? 'Connessione fallita.' })
    }
  }

  const saveConnection = async () => {
    const id = await window.api.database.saveConnection(form)
    await loadConnections()
    setSelectedConnectionId(id)
    setDialogOpen(false)
    setForm(defaultForm)
    setTestState('idle')
    showToast({ kind: 'success', message: 'Connessione salvata.' })
  }

  const toggleConnection = async (connectionId: number) => {
    const key = `connection:${connectionId}`
    setSelectedConnectionId(connectionId)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

    if (!schemas[connectionId]) {
      await window.api.database.connect(connectionId)
      const schema = await window.api.database.getSchema(connectionId)
      setSchemas((prev) => ({ ...prev, [connectionId]: schema }))
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
      setTabs((prev) =>
        prev.map((item) =>
          item.id === tabId && item.kind === 'table'
            ? { ...item, page, pageSize, result, loading: false }
            : item,
        ),
      )
    } catch (err) {
      setTabs((prev) =>
        prev.map((item) =>
          item.id === tabId && item.kind === 'table'
            ? { ...item, loading: false, error: err instanceof Error ? err.message : String(err) }
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
        },
      ])
      void window.api.database.browseTable(connectionId, databaseName, table.name, 1, 100)
        .then((result) => {
          setTabs((prev) =>
            prev.map((tab) => tab.id === id && tab.kind === 'table' ? { ...tab, result, loading: false } : tab),
          )
        })
        .catch((err) => {
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === id && tab.kind === 'table'
                ? { ...tab, loading: false, error: err instanceof Error ? err.message : String(err) }
                : tab,
            ),
          )
        })
    }
    setActiveTabId(id)
  }

  const openQuery = () => {
    if (!selectedConnectionId) return

    const id = `query:${Date.now()}`
    setTabs((prev) => [
      ...prev,
      {
        id,
        kind: 'query',
        title: 'New Query',
        connectionId: selectedConnectionId,
        sql: 'SELECT 1;',
        result: null,
        loading: false,
        error: null,
      },
    ])
    setActiveTabId(id)
  }

  const runQuery = async (tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId)
    if (!tab || tab.kind !== 'query') return

    setTabs((prev) => prev.map((item) => item.id === tabId ? { ...item, loading: true, error: null } : item))
    try {
      const result = await window.api.database.query(tab.connectionId, tab.sql)
      setTabs((prev) =>
        prev.map((item) => item.id === tabId && item.kind === 'query' ? { ...item, result, loading: false } : item),
      )
    } catch (err) {
      setTabs((prev) =>
        prev.map((item) =>
          item.id === tabId && item.kind === 'query'
            ? { ...item, loading: false, error: err instanceof Error ? err.message : String(err) }
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
    <div className="relative flex h-full w-full bg-zinc-950 text-zinc-100">
      <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
          <Database className="h-4 w-4 text-zinc-400" />
          <span className="min-w-0 flex-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
            Database
          </span>
          <button
            type="button"
            title="Nuova connessione"
            onClick={() => setDialogOpen(true)}
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
                onClick={() => setDialogOpen(true)}
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

              return (
                <div key={connection.id}>
                  <button
                    type="button"
                    onClick={() => void toggleConnection(connection.id)}
                    className={`flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs hover:bg-zinc-800 ${
                      selectedConnectionId === connection.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300'
                    }`}
                  >
                    {isConnectionOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    <Database className="h-3.5 w-3.5 text-sky-400" />
                    <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                    <span className="text-[10px] text-zinc-500">{connection.driver}</span>
                  </button>

                  {isConnectionOpen && (
                    <div className="ml-5 border-l border-white/10">
                      {connectionSchemas.map((schema) => {
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
            onClick={openQuery}
            disabled={!selectedConnectionId}
            className="w-full rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 hover:bg-zinc-700 disabled:opacity-40"
          >
            New Query
          </button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="tabbar-scroll flex h-9 shrink-0 overflow-x-auto border-b border-zinc-800 bg-zinc-950">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex h-9 min-w-40 items-center gap-2 border-r border-zinc-800 px-3 text-xs ${
                tab.id === activeTabId ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500'
              }`}
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
                onClick={() => setDialogOpen(true)}
                className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
              >
                Nuova connessione
              </button>
            )}
          </div>
        ) : activeTab.kind === 'table' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
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
            </div>
            {activeTab.error && <div className="border-b border-red-900/60 bg-red-950/50 px-3 py-2 text-xs text-red-300">{activeTab.error}</div>}
            {activeTab.loading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Caricamento...</div>
            ) : (
              <DataGrid result={activeTab.result} columnsMeta={activeTab.columnsMeta} table={activeTableMeta} />
            )}
            <div className="h-7 shrink-0 border-t border-zinc-800 px-3 py-1 text-xs text-zinc-500">
              {activeTab.result
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
                theme="vs-dark"
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
              <span className="flex-1 text-sm font-medium">Nuova connessione</span>
              <button type="button" onClick={() => setDialogOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800">
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
                {testState === 'success' ? 'Test connessione superato' : testState === 'error' ? 'Test fallito' : ''}
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
                disabled={testState !== 'success'}
                className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40"
              >
                Salva
              </button>
            </div>
          </div>
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
