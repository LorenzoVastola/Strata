import Editor from '@monaco-editor/react'
import { Check, Clock, Copy, Edit2, FilePlus2, Folder, FolderPlus, Loader2, MoreHorizontal, Play, Plus, Save, Trash2, Upload, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'

type RequestTab = 'params' | 'headers' | 'body' | 'auth' | 'scripts'
type ResponseTab = 'body' | 'headers' | 'timeline'
type SidebarMode = 'collections' | 'history'
type ContextMenu =
  | { kind: 'collection'; x: number; y: number; collection: HttpCollection }
  | { kind: 'folder'; x: number; y: number; folder: HttpFolder }
  | { kind: 'request'; x: number; y: number; request: HttpRequest }
  | { kind: 'history'; x: number; y: number; item: HistoryItem }
type HistoryItem = { id: number; request: Record<string, unknown>; response: Record<string, unknown>; executedAt: string }

const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const methodClass: Record<HttpMethod, string> = {
  GET: 'text-emerald-400',
  POST: 'text-yellow-400',
  PUT: 'text-sky-400',
  PATCH: 'text-orange-400',
  DELETE: 'text-red-400',
}
const headerSuggestions = ['Content-Type', 'Authorization', 'Accept', 'User-Agent', 'Cache-Control', 'X-API-Key']

const uid = () => Math.random().toString(36).slice(2)
const emptyRow = (): HttpKeyValue => ({ id: uid(), key: '', value: '', enabled: true })
const defaultRequest = (collectionId: number): HttpRequest => ({
  collectionId,
  folderId: null,
  name: 'New Request',
  method: 'GET',
  url: 'https://api.example.com',
  params: [emptyRow()],
  headers: [emptyRow()],
  body: { type: 'none', rawType: 'json', raw: '{\n  \n}', fields: [emptyRow()] },
  auth: { type: 'none' },
  scripts: { preRequest: '', postResponse: '' },
  responseCaptures: [],
  sanitizeHistory: false,
  timeoutMs: 30000,
  environmentId: null,
})
const defaultAuth = (type: HttpAuth['type']): HttpAuth => {
  if (type === 'bearer') return { type: 'bearer', token: '' }
  if (type === 'basic') return { type: 'basic', username: '', password: '' }
  if (type === 'apiKey') return { type: 'apiKey', key: '', value: '', addTo: 'header' }
  return { type: 'none' }
}

const statusClass = (status?: number) => {
  if (!status) return 'text-zinc-500'
  if (status >= 200 && status < 300) return 'text-emerald-400'
  if (status >= 300 && status < 400) return 'text-sky-400'
  if (status >= 400 && status < 500) return 'text-orange-400'
  return 'text-red-400'
}

const prettyBody = (body: string, raw: boolean) => {
  if (raw) return body
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

const bodyLanguage = (body: string) => {
  try {
    JSON.parse(body)
    return 'json'
  } catch {
    return 'text'
  }
}

const formatSize = (size: number) => `${(size / 1024).toFixed(size >= 10240 ? 1 : 2)} KB`

const relativeTime = (value: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s fa`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min fa`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h fa`
  return `${Math.floor(hours / 24)}g fa`
}

const syncUrlParams = (urlValue: string, params: HttpKeyValue[]) => {
  try {
    const url = new URL(urlValue)
    url.search = ''
    params.filter((param) => param.enabled && param.key).forEach((param) => url.searchParams.set(param.key, param.value))
    return url.toString()
  } catch {
    return urlValue
  }
}

const envVariables = (environments: HttpEnvironment[], activeId?: number | null) => {
  const variables = new Map<string, string>()
  environments.find((environment) => environment.name.toLowerCase() === 'globals')?.variables
    .filter((item) => item.enabled && item.key)
    .forEach((item) => variables.set(item.key, item.value))
  environments.find((environment) => environment.id === activeId)?.variables
    .filter((item) => item.enabled && item.key)
    .forEach((item) => variables.set(item.key, item.value))
  return variables
}

const replaceVariables = (value: string, variables: Map<string, string>) =>
  value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => variables.get(key) ?? `{{${key}}}`)

const missingVariables = (value: string, variables: Map<string, string>) => {
  const missing = new Set<string>()
  value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    if (!variables.has(key)) missing.add(key)
    return ''
  })
  return [...missing]
}

const historyToRequest = (item: HistoryItem, fallbackCollectionId: number): HttpRequest => ({
  collectionId: Number(item.request.collectionId ?? fallbackCollectionId),
  name: String(item.request.name ?? 'History Request'),
  method: (item.request.method as HttpMethod) ?? 'GET',
  url: String(item.request.url ?? item.request.resolvedUrl ?? ''),
  params: Array.isArray(item.request.params) ? item.request.params as HttpKeyValue[] : [emptyRow()],
  headers: Array.isArray(item.request.headers) ? item.request.headers as HttpKeyValue[] : [emptyRow()],
  body: (item.request.body as HttpBody) ?? { type: 'none', rawType: 'json', raw: '', fields: [emptyRow()] },
  auth: (item.request.auth as HttpAuth) ?? { type: 'none' },
  scripts: (item.request.scripts as HttpScripts) ?? { preRequest: '', postResponse: '' },
  responseCaptures: Array.isArray(item.request.responseCaptures) ? item.request.responseCaptures as HttpResponseCapture[] : [],
  sanitizeHistory: Boolean(item.request.sanitizeHistory),
  timeoutMs: Number(item.request.timeoutMs ?? 30000),
  environmentId: item.request.environmentId === undefined ? null : Number(item.request.environmentId),
})

const authPreview = (auth: HttpAuth) => {
  if (auth.type === 'bearer' && auth.token) return `Authorization: Bearer ${auth.token}`
  if (auth.type === 'basic') return `Authorization: Basic ${btoa(`${auth.username}:${auth.password}`)}`
  if (auth.type === 'apiKey' && auth.key) return auth.addTo === 'query' ? `Query: ${auth.key}=${auth.value}` : `Header: ${auth.key}: ${auth.value}`
  return ''
}

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`

const splitCurl = (command: string) => {
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  let escaped = false
  for (const char of command.replace(/\\\r?\n/g, ' ')) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

const parseCurl = (command: string, collectionId: number): HttpRequest => {
  const tokens = splitCurl(command)
  const request = defaultRequest(collectionId)
  let method: HttpMethod = 'GET'
  let url = ''
  const headers: HttpKeyValue[] = []
  let rawBody = ''
  let auth: HttpAuth = { type: 'none' }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const next = tokens[index + 1]
    if (token === 'curl') continue
    if ((token === '-X' || token === '--request') && next) {
      method = next.toUpperCase() as HttpMethod
      index += 1
    } else if ((token === '-H' || token === '--header') && next) {
      const separator = next.indexOf(':')
      if (separator > -1) headers.push({ id: uid(), key: next.slice(0, separator).trim(), value: next.slice(separator + 1).trim(), enabled: true })
      index += 1
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii'].includes(token) && next) {
      rawBody = next
      if (method === 'GET') method = 'POST'
      index += 1
    } else if ((token === '-u' || token === '--user') && next) {
      const [username, ...passwordParts] = next.split(':')
      auth = { type: 'basic', username, password: passwordParts.join(':') }
      index += 1
    } else if (!token.startsWith('-') && !url) {
      url = token
    }
  }

  return {
    ...request,
    name: 'Imported cURL',
    method,
    url,
    headers: headers.length ? headers : [emptyRow()],
    body: rawBody ? { type: 'raw', rawType: 'text', raw: rawBody, fields: [emptyRow()] } : request.body,
    auth,
  }
}

const downloadJson = (filename: string, payload: unknown) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const postmanAuth = (auth: HttpAuth) => {
  if (auth.type === 'bearer') return { type: 'bearer', bearer: [{ key: 'token', value: auth.token, type: 'string' }] }
  if (auth.type === 'basic') {
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: auth.username, type: 'string' },
        { key: 'password', value: auth.password, type: 'string' },
      ],
    }
  }
  if (auth.type === 'apiKey') {
    return {
      type: 'apikey',
      apikey: [
        { key: 'key', value: auth.key, type: 'string' },
        { key: 'value', value: auth.value, type: 'string' },
        { key: 'in', value: auth.addTo === 'query' ? 'query' : 'header', type: 'string' },
      ],
    }
  }
  return undefined
}

const requestToPostmanItem = (request: HttpRequest) => ({
  name: request.name,
  description: request.description ?? '',
  request: {
    method: request.method,
    header: request.headers.filter((header) => header.enabled && header.key).map((header) => ({
      key: header.key,
      value: header.value,
      description: header.description ?? '',
      disabled: false,
    })),
    url: { raw: request.url },
    auth: postmanAuth(request.auth),
    body: request.body.type === 'raw'
      ? { mode: 'raw', raw: request.body.raw ?? '', options: { raw: { language: request.body.rawType ?? 'text' } } }
      : request.body.type === 'x-www-form-urlencoded'
        ? {
            mode: 'urlencoded',
            urlencoded: (request.body.fields ?? []).filter((field) => field.key).map((field) => ({
              key: field.key,
              value: field.value,
              description: field.description ?? '',
              disabled: !field.enabled,
            })),
          }
        : request.body.type === 'form-data'
          ? {
              mode: 'formdata',
              formdata: (request.body.fields ?? []).filter((field) => field.key).map((field) => ({
                key: field.key,
                value: field.value,
                type: 'text',
                description: field.description ?? '',
                disabled: !field.enabled,
              })),
            }
          : undefined,
  },
})

const keyValueFromPostman = (items: Array<Record<string, unknown>> = []): HttpKeyValue[] =>
  items.map((item) => ({
    id: uid(),
    key: String(item.key ?? ''),
    value: String(item.value ?? ''),
    enabled: item.disabled !== true,
    description: typeof item.description === 'string' ? item.description : '',
  })).filter((item) => item.key || item.value)

const authFromPostman = (auth: Record<string, unknown> | undefined): HttpAuth => {
  if (!auth) return { type: 'none' }
  if (auth.type === 'bearer') {
    const token = ((auth.bearer as Array<Record<string, unknown>> | undefined) ?? []).find((item) => item.key === 'token')?.value
    return { type: 'bearer', token: String(token ?? '') }
  }
  if (auth.type === 'basic') {
    const basic = (auth.basic as Array<Record<string, unknown>> | undefined) ?? []
    return {
      type: 'basic',
      username: String(basic.find((item) => item.key === 'username')?.value ?? ''),
      password: String(basic.find((item) => item.key === 'password')?.value ?? ''),
    }
  }
  if (auth.type === 'apikey') {
    const apiKey = (auth.apikey as Array<Record<string, unknown>> | undefined) ?? []
    return {
      type: 'apiKey',
      key: String(apiKey.find((item) => item.key === 'key')?.value ?? ''),
      value: String(apiKey.find((item) => item.key === 'value')?.value ?? ''),
      addTo: String(apiKey.find((item) => item.key === 'in')?.value ?? 'header') === 'query' ? 'query' : 'header',
    }
  }
  return { type: 'none' }
}

const urlFromPostman = (url: unknown) => {
  if (typeof url === 'string') return url
  if (url && typeof url === 'object' && 'raw' in url) return String((url as { raw?: unknown }).raw ?? '')
  return ''
}

const bodyFromPostman = (body: Record<string, unknown> | undefined): HttpBody => {
  if (!body) return { type: 'none', rawType: 'json', raw: '', fields: [emptyRow()] }
  if (body.mode === 'raw') return { type: 'raw', rawType: 'text', raw: String(body.raw ?? ''), fields: [emptyRow()] }
  if (body.mode === 'urlencoded') return { type: 'x-www-form-urlencoded', fields: keyValueFromPostman(body.urlencoded as Array<Record<string, unknown>> | undefined) }
  if (body.mode === 'formdata') return { type: 'form-data', fields: keyValueFromPostman(body.formdata as Array<Record<string, unknown>> | undefined) }
  return { type: 'none', rawType: 'json', raw: '', fields: [emptyRow()] }
}

const requestFromPostmanItem = (item: Record<string, unknown>, collectionId: number, folderId?: number | null): HttpRequest | null => {
  const request = item.request as Record<string, unknown> | undefined
  if (!request) return null
  return {
    ...defaultRequest(collectionId),
    folderId: folderId ?? null,
    name: String(item.name ?? 'Imported Request'),
    description: typeof item.description === 'string' ? item.description : '',
    method: String(request.method ?? 'GET').toUpperCase() as HttpMethod,
    url: urlFromPostman(request.url),
    headers: keyValueFromPostman(request.header as Array<Record<string, unknown>> | undefined),
    body: bodyFromPostman(request.body as Record<string, unknown> | undefined),
    auth: authFromPostman(request.auth as Record<string, unknown> | undefined),
  }
}

function KeyValueEditor({
  rows,
  onChange,
  suggestions,
  description = false,
}: {
  rows: HttpKeyValue[]
  onChange: (rows: HttpKeyValue[]) => void
  suggestions?: string[]
  description?: boolean
}) {
  const update = (index: number, patch: Partial<HttpKeyValue>) => {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  return (
    <div className="min-h-0 overflow-auto">
      <datalist id="http-header-suggestions">
        {suggestions?.map((item) => <option key={item} value={item} />)}
      </datalist>
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
          <tr>
            <th className="w-9 border-b border-r border-zinc-800 px-2 py-2" />
            <th className="border-b border-r border-zinc-800 px-2 py-2 text-left font-medium">Key</th>
            <th className="border-b border-r border-zinc-800 px-2 py-2 text-left font-medium">Value</th>
            {description && <th className="border-b border-r border-zinc-800 px-2 py-2 text-left font-medium">Description</th>}
            <th className="w-9 border-b border-zinc-800 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? index}>
              <td className="border-b border-r border-zinc-900 px-2 py-1.5 text-center">
                <input type="checkbox" checked={row.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} />
              </td>
              <td className="border-b border-r border-zinc-900 px-2 py-1">
                <input
                  value={row.key}
                  list={suggestions ? 'http-header-suggestions' : undefined}
                  onChange={(event) => update(index, { key: event.target.value })}
                  className="w-full bg-transparent px-1 py-1 text-zinc-200 outline-none"
                />
              </td>
              <td className="border-b border-r border-zinc-900 px-2 py-1">
                <input
                  value={row.value}
                  onChange={(event) => update(index, { value: event.target.value })}
                  className="w-full bg-transparent px-1 py-1 text-zinc-200 outline-none"
                />
              </td>
              {description && (
                <td className="border-b border-r border-zinc-900 px-2 py-1">
                  <input
                    value={row.description ?? ''}
                    onChange={(event) => update(index, { description: event.target.value })}
                    className="w-full bg-transparent px-1 py-1 text-zinc-400 outline-none"
                  />
                </td>
              )}
              <td className="border-b border-zinc-900 px-2 py-1 text-center">
                <button type="button" onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => onChange([...rows, emptyRow()])} className="m-2 flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800">
        <Plus className="h-3.5 w-3.5" />
        Row
      </button>
    </div>
  )
}

export default function HttpPanel() {
  const [collections, setCollections] = useState<HttpCollection[]>([])
  const [folders, setFolders] = useState<HttpFolder[]>([])
  const [requests, setRequests] = useState<HttpRequest[]>([])
  const [environments, setEnvironments] = useState<HttpEnvironment[]>([])
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [activeRequestId, setActiveRequestId] = useState<number | null>(null)
  const [openTabs, setOpenTabs] = useState<HttpRequest[]>([])
  const [draft, setDraft] = useState<HttpRequest | null>(null)
  const [requestTab, setRequestTab] = useState<RequestTab>('params')
  const [responseTab, setResponseTab] = useState<ResponseTab>('body')
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('collections')
  const [response, setResponse] = useState<HttpResponse | null>(null)
  const [responseError, setResponseError] = useState<string | null>(null)
  const [rawResponse, setRawResponse] = useState(false)
  const [loading, setLoading] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [envMenuOpen, setEnvMenuOpen] = useState(false)
  const [editingEnvironment, setEditingEnvironment] = useState<HttpEnvironment | null>(null)
  const [newCollectionName, setNewCollectionName] = useState<string | null>(null)
  const [editingCollectionId, setEditingCollectionId] = useState<number | null>(null)
  const [editingCollectionName, setEditingCollectionName] = useState('')
  const [editingRequestId, setEditingRequestId] = useState<number | null>(null)
  const [editingRequestName, setEditingRequestName] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  const [moveTarget, setMoveTarget] = useState<HttpRequest | null>(null)
  const [copiedBody, setCopiedBody] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [curlText, setCurlText] = useState('')
  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureDraft, setCaptureDraft] = useState<HttpResponseCapture>({ id: uid(), jsonPath: '$.', variable: '', enabled: true })
  const [sidebarWidth, setSidebarWidth] = useState(320)
  const [requestPanePercent, setRequestPanePercent] = useState(50)
  const [theme, setTheme] = useState('one-dark-pro')
  const [redactHistoryBodies, setRedactHistoryBodies] = useState(false)

  const activeEnvironment = environments.find((environment) => environment.id === draft?.environmentId) ?? null
  const globalsEnvironment = environments.find((environment) => environment.name.toLowerCase() === 'globals') ?? null
  const variables = envVariables(environments, draft?.environmentId)
  const variableNames = [...variables.keys()].sort()
  const urlMissingVariables = draft ? missingVariables(draft.url, variables) : []
  const previewUrl = draft ? replaceVariables(draft.url, variables) : ''

  const loadAll = async () => {
    const [data, envs, nextHistory] = await Promise.all([
      window.api.http.list(),
      window.api.http.listEnvironments(),
      window.api.http.history(),
    ])
    setCollections(data.collections)
    setFolders(data.folders ?? [])
    setRequests(data.requests)
    setEnvironments(envs)
    setHistory(nextHistory)
    const nextActive = data.activeRequestId ?? data.requests[0]?.id ?? null
    const nextDraft = data.requests.find((request) => request.id === nextActive) ?? null
    setActiveRequestId(nextActive)
    setDraft(nextDraft)
    if (nextDraft?.collectionId) void window.api.environment.setHttpCollection(nextDraft.collectionId)
    if (nextDraft) setOpenTabs((prev) => prev.length ? prev.map((tab) => tab.id === nextDraft.id ? nextDraft : tab) : [nextDraft])
  }

  const loadLayout = async () => {
    const [layout, historySettings] = await Promise.all([
      window.api.http.getLayout(),
      window.api.http.getHistorySettings(),
    ])
    setSidebarWidth(layout.sidebarWidth)
    setRequestPanePercent(layout.requestPanePercent)
    setRedactHistoryBodies(historySettings.redactBodies)
  }

  useEffect(() => {
    void loadAll()
    void loadLayout()
  }, [])

  useEffect(() => {
    window.api.getEditorSettings().then((s) => setTheme(s.theme || 'one-dark-pro')).catch(() => {})
    const handler = (e: Event) => setTheme((e as CustomEvent<string>).detail)
    window.addEventListener('strata:theme-change', handler)
    return () => window.removeEventListener('strata:theme-change', handler)
  }, [])

  useEffect(() => {
    const close = () => {
      setContextMenu(null)
      setEnvMenuOpen(false)
    }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void send()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveDraft()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createRequest()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        closeActiveTab()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const requestsByCollection = useMemo(() => {
    return collections.map((collection) => ({
      collection,
      folders: folders.filter((folder) => folder.collectionId === collection.id && !folder.parentId),
      requests: requests.filter((request) => request.collectionId === collection.id && !request.folderId),
    }))
  }, [collections, folders, requests])

  const updateDraft = (patch: Partial<HttpRequest>) => {
    setDraft((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      setOpenTabs((tabs) => tabs.map((tab) => tab.id === prev.id ? next : tab))
      return next
    })
  }

  const saveDraft = async (nextDraft = draft) => {
    if (!nextDraft) return null
    let collectionId = nextDraft.collectionId || collections[0]?.id
    let name = nextDraft.name
    if (!nextDraft.id) {
      const promptedName = window.prompt('Request name', name || 'New Request')
      if (!promptedName) return null
      name = promptedName
      const collectionName = collections.find((collection) => collection.id === collectionId)?.name ?? ''
      const promptedCollection = window.prompt('Collection name', collectionName || 'New Collection')
      if (promptedCollection) {
        const existing = collections.find((collection) => collection.name.toLowerCase() === promptedCollection.toLowerCase())
        collectionId = existing?.id ?? await window.api.http.createCollection(promptedCollection)
      }
    }
    const requestToSave = { ...nextDraft, name, collectionId }
    const id = await window.api.http.saveRequest(requestToSave)
    const saved = { ...requestToSave, id }
    setDraft(saved)
    setActiveRequestId(id)
    setOpenTabs((tabs) => tabs.some((tab) => tab.id === id) ? tabs.map((tab) => tab.id === id ? saved : tab) : [...tabs, saved])
    await window.api.http.setActiveRequest(id)
    await loadAll()
    return saved
  }

  const createCollection = async (name = 'New Collection') => {
    const id = await window.api.http.createCollection(name)
    await loadAll()
    return id
  }

  const createRequest = async (collectionId?: number, folderId?: number | null) => {
    const targetCollectionId = collectionId ?? collections[0]?.id ?? await createCollection()
    const request = { ...defaultRequest(targetCollectionId), folderId: folderId ?? null }
    const id = await window.api.http.saveRequest(request)
    await loadAll()
    setActiveRequestId(id)
    const saved = { ...request, id }
    setDraft(saved)
    setOpenTabs((tabs) => [...tabs.filter((tab) => tab.id !== id), saved])
    setEditingRequestId(id)
    setEditingRequestName(saved.name)
    await window.api.http.setActiveRequest(id)
  }

  const openRequest = async (request: HttpRequest) => {
    setActiveRequestId(request.id ?? null)
    setDraft(request)
    setOpenTabs((tabs) => tabs.some((tab) => tab.id === request.id) ? tabs : [...tabs, request])
    setResponse(null)
    setResponseError(null)
    await window.api.http.setActiveRequest(request.id ?? null)
  }

  const closeActiveTab = () => {
    if (!draft) return
    const nextTabs = openTabs.filter((tab) => tab.id !== draft.id)
    const nextDraft = nextTabs[nextTabs.length - 1] ?? null
    setOpenTabs(nextTabs)
    setDraft(nextDraft)
    setActiveRequestId(nextDraft?.id ?? null)
    void window.api.http.setActiveRequest(nextDraft?.id ?? null)
  }

  const send = async () => {
    if (!draft) return
    setLoading(true)
    setResponseError(null)
    try {
      const id = await saveDraft(draft)
      if (!id) return
      const result = await window.api.http.send(id)
      setResponse(result)
      setHistory(await window.api.http.history())
      setEnvironments(await window.api.http.listEnvironments())
    } catch (error) {
      setResponse(null)
      setResponseError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const deleteRequest = async (id?: number) => {
    if (!id || !window.confirm('Delete request?')) return
    await window.api.http.deleteRequest(id)
    setDraft(null)
    setActiveRequestId(null)
    setOpenTabs((tabs) => tabs.filter((tab) => tab.id !== id))
    await loadAll()
  }

  const commitNewCollection = async () => {
    if (!newCollectionName?.trim()) {
      setNewCollectionName(null)
      return
    }
    await createCollection(newCollectionName.trim())
    setNewCollectionName(null)
  }

  const commitCollectionRename = async (collection: HttpCollection) => {
    const nextName = editingCollectionName.trim()
    setEditingCollectionId(null)
    if (nextName && nextName !== collection.name) {
      await window.api.http.renameCollection(collection.id, nextName)
      await loadAll()
    }
  }

  const commitRequestRename = async (request: HttpRequest) => {
    const nextName = editingRequestName.trim()
    setEditingRequestId(null)
    if (nextName && nextName !== request.name) {
      const nextRequest = { ...request, name: nextName }
      await window.api.http.saveRequest(nextRequest)
      if (draft?.id === request.id) setDraft(nextRequest)
      setOpenTabs((tabs) => tabs.map((tab) => tab.id === request.id ? nextRequest : tab))
      await loadAll()
    }
  }

  const createFolder = async (collectionId: number) => {
    const id = await window.api.http.createFolder(collectionId, 'New Folder', null)
    await loadAll()
    setEditingFolderId(id)
    setEditingFolderName('New Folder')
  }

  const commitFolderRename = async (folder: HttpFolder) => {
    const nextName = editingFolderName.trim()
    setEditingFolderId(null)
    if (nextName && nextName !== folder.name) {
      await window.api.http.renameFolder(folder.id, nextName)
      await loadAll()
    }
  }

  const duplicateCollection = async (id: number) => {
    await window.api.http.duplicateCollection(id)
    await loadAll()
  }

  const moveRequest = async (request: HttpRequest, collectionId: number, folderId: number | null) => {
    if (request.id) await window.api.http.moveRequest(request.id, collectionId, folderId)
    setMoveTarget(null)
    await loadAll()
  }

  const exportCollection = async (collection: HttpCollection) => {
    const collectionRequests = requests.filter((request) => request.collectionId === collection.id)
    const collectionFolders = folders.filter((folder) => folder.collectionId === collection.id && !folder.parentId)
    const postman = {
      info: {
        name: collection.name,
        _postman_id: `strata-${collection.id}`,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        ...collectionFolders.map((folder) => ({
          name: folder.name,
          item: collectionRequests.filter((request) => request.folderId === folder.id).map(requestToPostmanItem),
        })),
        ...collectionRequests.filter((request) => !request.folderId).map(requestToPostmanItem),
      ],
    }
    downloadJson(`${collection.name.replace(/[^\w.-]+/g, '_')}.postman_collection.json`, postman)
  }

  const requestCurl = (request: HttpRequest, urlValue = request.url) => {
    const parts = ['curl', '-X', request.method, shellQuote(urlValue)]
    request.headers.filter((header) => header.enabled && header.key).forEach((header) => {
      parts.push('-H', shellQuote(`${header.key}: ${replaceVariables(header.value, variables)}`))
    })
    const preview = authPreview(request.auth)
    if (preview.startsWith('Authorization:')) parts.push('-H', shellQuote(preview))
    if (request.body.type === 'raw' && request.body.raw) parts.push('--data', shellQuote(replaceVariables(request.body.raw, variables)))
    if (request.body.type === 'x-www-form-urlencoded') {
      request.body.fields?.filter((field) => field.enabled && field.key).forEach((field) => parts.push('--data-urlencode', shellQuote(`${field.key}=${replaceVariables(field.value, variables)}`)))
    }
    return parts.join(' ')
  }

  const copyCurl = async (request = draft) => {
    if (!request) return
    await navigator.clipboard.writeText(requestCurl(request, request.id === draft?.id ? previewUrl || request.url : request.url))
  }

  const copyResponseBody = async () => {
    if (!response) return
    await navigator.clipboard.writeText(prettyBody(response.body, rawResponse))
    setCopiedBody(true)
    window.setTimeout(() => setCopiedBody(false), 1500)
  }

  const importPostmanCollection = async (payload: Record<string, unknown>) => {
    const collectionName = String((payload.info as Record<string, unknown> | undefined)?.name ?? payload.name ?? 'Imported Collection')
    const collectionId = await window.api.http.createCollection(collectionName)
    const importItems = async (items: Array<Record<string, unknown>>, folderId: number | null = null) => {
      for (const item of items) {
        if (Array.isArray(item.item)) {
          const nextFolderId = await window.api.http.createFolder(collectionId, String(item.name ?? 'Folder'), folderId)
          await importItems(item.item as Array<Record<string, unknown>>, nextFolderId)
          continue
        }
        const request = requestFromPostmanItem(item, collectionId, folderId)
        if (request) await window.api.http.saveRequest(request)
      }
    }
    await importItems((payload.item as Array<Record<string, unknown>> | undefined) ?? [])
    await loadAll()
  }

  const importPostmanEnvironment = async (payload: Record<string, unknown>) => {
    const values = (payload.values as Array<Record<string, unknown>> | undefined) ?? (payload.variable as Array<Record<string, unknown>> | undefined) ?? []
    await window.api.http.saveEnvironment({
      name: String(payload.name ?? 'Imported Environment'),
      variables: values.map((item) => ({
        id: uid(),
        key: String(item.key ?? ''),
        value: String(item.value ?? ''),
        enabled: item.enabled !== false && item.disabled !== true,
        description: typeof item.description === 'string' ? item.description : '',
      })).filter((item) => item.key || item.value),
    })
    setEnvironments(await window.api.http.listEnvironments())
  }

  const importPayload = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (/^curl\s/i.test(trimmed)) {
      const collectionId = await window.api.http.createCollection('Imported cURL')
      const request = parseCurl(trimmed, collectionId)
      const id = await window.api.http.saveRequest(request)
      const saved = { ...request, id }
      setDraft(saved)
      setOpenTabs((tabs) => [...tabs, saved])
      await window.api.http.setActiveRequest(id)
      await loadAll()
      setImportOpen(false)
      setCurlText('')
      return
    }
    const payload = JSON.parse(trimmed) as Record<string, unknown>
    const schema = String((payload.info as Record<string, unknown> | undefined)?.schema ?? '')
    if (schema.includes('collection') || Array.isArray(payload.item)) await importPostmanCollection(payload)
    else if (Array.isArray(payload.values) || Array.isArray(payload.variable)) await importPostmanEnvironment(payload)
    else {
      const genericRequests = (Array.isArray(payload.requests) ? payload.requests : []) as Array<Record<string, unknown>>
      await importPostmanCollection({
        name: String(payload.name ?? 'Imported JSON'),
        item: genericRequests.map((request) => request.request ? request : ({
          name: request.name ?? request.url ?? 'Imported Request',
          description: request.description ?? '',
          request: {
            method: request.method ?? 'GET',
            url: request.url ?? '',
            header: request.headers ?? [],
            body: request.body,
            auth: request.auth,
          },
        })),
      })
    }
    setImportOpen(false)
    setCurlText('')
  }

  const importCurl = () => {
    void importPayload(curlText)
  }

  const importFile = async (file?: File) => {
    if (!file) return
    await importPayload(await file.text())
  }

  const startSidebarResize = (event: ReactMouseEvent) => {
    event.preventDefault()
    const onMove = (moveEvent: MouseEvent) => {
      setSidebarWidth(Math.min(400, Math.max(160, moveEvent.clientX)))
    }
    const onUp = (upEvent: MouseEvent) => {
      const width = Math.min(400, Math.max(160, upEvent.clientX))
      setSidebarWidth(width)
      void window.api.http.saveLayout({ sidebarWidth: width, requestPanePercent })
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const startPaneResize = (event: ReactMouseEvent) => {
    event.preventDefault()
    const section = (event.currentTarget.closest('[data-http-editor]') as HTMLElement | null)
    if (!section) return
    const top = section.getBoundingClientRect().top
    const height = section.getBoundingClientRect().height
    const onMove = (moveEvent: MouseEvent) => {
      const percent = Math.min(85, Math.max(30, ((moveEvent.clientY - top) / height) * 100))
      setRequestPanePercent(percent)
    }
    const onUp = (upEvent: MouseEvent) => {
      const percent = Math.min(85, Math.max(30, ((upEvent.clientY - top) / height) * 100))
      setRequestPanePercent(percent)
      void window.api.http.saveLayout({ sidebarWidth, requestPanePercent: percent })
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const loadHistoryItem = async (item: HistoryItem) => {
    const request = historyToRequest(item, collections[0]?.id ?? await createCollection())
    setDraft(request)
    setActiveRequestId(request.id ?? null)
    setOpenTabs((tabs) => [...tabs.filter((tab) => tab.id !== request.id), request])
    setResponse(item.response as unknown as HttpResponse)
    setResponseError(null)
  }

  const createEnvironment = () => {
    setEditingEnvironment({ name: 'New Environment', variables: [emptyRow()] })
    setEnvMenuOpen(false)
  }

  const editEnvironment = (environment: HttpEnvironment) => {
    setEditingEnvironment({ ...environment, variables: environment.variables.length ? environment.variables : [emptyRow()] })
    setEnvMenuOpen(false)
  }

  const saveEditingEnvironment = async () => {
    if (!editingEnvironment) return
    const id = await window.api.http.saveEnvironment({
      ...editingEnvironment,
      name: editingEnvironment.name.trim() || 'Environment',
    })
    const nextEnvironments = await window.api.http.listEnvironments()
    setEnvironments(nextEnvironments)
    setEditingEnvironment(null)
    if (!editingEnvironment.id) updateDraft({ environmentId: id })
  }

  const updateGlobalHistoryRedaction = async (redactBodies: boolean) => {
    setRedactHistoryBodies(redactBodies)
    await window.api.http.saveHistorySettings({ redactBodies })
  }

  const saveResponseCapture = () => {
    if (!draft || !captureDraft.jsonPath.trim() || !captureDraft.variable.trim()) return
    updateDraft({
      responseCaptures: [
        ...(draft.responseCaptures ?? []).filter((capture) => capture.id !== captureDraft.id),
        { ...captureDraft, id: captureDraft.id ?? uid(), enabled: true },
      ],
    })
    setCaptureOpen(false)
  }

  const deleteEnvironment = async (environment: HttpEnvironment) => {
    if (!environment.id || environment.name.toLowerCase() === 'globals') return
    if (!window.confirm(`Delete environment "${environment.name}"?`)) return
    await window.api.http.deleteEnvironment(environment.id)
    if (draft?.environmentId === environment.id) updateDraft({ environmentId: null })
    setEnvironments(await window.api.http.listEnvironments())
  }

  return (
    <div className="relative flex h-full w-full bg-zinc-950 text-zinc-100" style={{ background: 'var(--strata-bg)', color: 'var(--strata-text)' }}>
      <aside className="relative flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-900" style={{ width: sidebarWidth, background: 'var(--strata-sidebar)', borderColor: 'var(--strata-border)' }}>
        <div className="flex h-10 items-center gap-2 border-b border-zinc-800 px-3">
          <Zap className="h-4 w-4 text-zinc-400" />
          <span className="flex-1 text-xs font-medium uppercase tracking-wide text-zinc-400">HTTP</span>
          <button type="button" title="New collection" onClick={() => setNewCollectionName('')} className="rounded p-1 text-zinc-400 hover:bg-zinc-700">
            <FolderPlus className="h-4 w-4" />
          </button>
          <button type="button" title="New request" onClick={() => void createRequest()} className="rounded p-1 text-zinc-400 hover:bg-zinc-700">
            <FilePlus2 className="h-4 w-4" />
          </button>
          <button type="button" title="Import collection" onClick={() => setImportOpen(true)} className="rounded p-1 text-zinc-400 hover:bg-zinc-700">
            <Upload className="h-4 w-4" />
          </button>
        </div>
        <div className="flex border-b border-zinc-800 p-1 text-xs">
          {(['collections', 'history'] as const).map((mode) => (
            <button key={mode} type="button" onClick={() => setSidebarMode(mode)} className={`flex-1 rounded px-2 py-1 ${sidebarMode === mode ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}>
              {mode === 'collections' ? 'Collections' : 'History'}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {sidebarMode === 'collections' ? (
            <>
              {newCollectionName !== null && (
                <div className="px-3 py-1.5">
                  <input
                    autoFocus
                    value={newCollectionName}
                    onChange={(event) => setNewCollectionName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void commitNewCollection()
                      if (event.key === 'Escape') setNewCollectionName(null)
                    }}
                    placeholder="Collection name"
                    className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs outline-none"
                  />
                </div>
              )}
              {requestsByCollection.map(({ collection, folders: collectionFolders, requests: collectionRequests }) => (
            <div key={collection.id}>
              {editingCollectionId === collection.id ? (
                <input
                  autoFocus
                  value={editingCollectionName}
                  onChange={(event) => setEditingCollectionName(event.target.value)}
                  onBlur={() => void commitCollectionRename(collection)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void commitCollectionRename(collection)
                    if (event.key === 'Escape') setEditingCollectionId(null)
                  }}
                  className="mx-3 my-1 w-[calc(100%-1.5rem)] rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs outline-none"
                />
              ) : (
                <div
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setContextMenu({ kind: 'collection', x: event.clientX, y: event.clientY, collection })
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      setContextMenu({ kind: 'collection', x: event.clientX, y: event.clientY, collection })
                    }}
                    className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-200"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {collectionFolders.map((folder) => (
                <div key={folder.id}>
                  {editingFolderId === folder.id ? (
                    <input
                      autoFocus
                      value={editingFolderName}
                      onChange={(event) => setEditingFolderName(event.target.value)}
                      onBlur={() => void commitFolderRename(folder)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void commitFolderRename(folder)
                        if (event.key === 'Escape') setEditingFolderId(null)
                      }}
                      className="mx-5 my-1 w-[calc(100%-2.5rem)] rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs outline-none"
                    />
                  ) : (
                    <div
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setContextMenu({ kind: 'folder', x: event.clientX, y: event.clientY, folder })
                      }}
                      className="flex w-full items-center gap-2 px-5 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                    >
                      <Folder className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setContextMenu({ kind: 'folder', x: event.clientX, y: event.clientY, folder })
                        }}
                        className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-200"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {requests.filter((request) => request.folderId === folder.id).map((request) => (
                    <button
                      key={request.id}
                      type="button"
                      onClick={() => void openRequest(request)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setContextMenu({ kind: 'request', x: event.clientX, y: event.clientY, request })
                      }}
                      className={`flex w-full items-center gap-2 px-8 py-1.5 text-left text-xs hover:bg-zinc-800 ${activeRequestId === request.id ? 'bg-zinc-800' : ''}`}
                    >
                      <span className={`w-12 shrink-0 font-semibold ${methodClass[request.method]}`}>{request.method}</span>
                      {editingRequestId === request.id ? (
                        <input
                          autoFocus
                          value={editingRequestName}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => setEditingRequestName(event.target.value)}
                          onBlur={() => void commitRequestRename(request)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void commitRequestRename(request)
                            if (event.key === 'Escape') setEditingRequestId(null)
                          }}
                          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-zinc-200 outline-none"
                        />
                      ) : (
                        <span onDoubleClick={(event) => { event.stopPropagation(); setEditingRequestId(request.id ?? null); setEditingRequestName(request.name) }} className="min-w-0 flex-1 truncate text-zinc-300">{request.name}</span>
                      )}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setContextMenu({ kind: 'request', x: event.clientX, y: event.clientY, request })
                        }}
                        className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-200"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </button>
                  ))}
                </div>
              ))}
              {collectionRequests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => void openRequest(request)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setContextMenu({ kind: 'request', x: event.clientX, y: event.clientY, request })
                  }}
                  className={`flex w-full items-center gap-2 px-5 py-1.5 text-left text-xs hover:bg-zinc-800 ${activeRequestId === request.id ? 'bg-zinc-800' : ''}`}
                >
                  <span className={`w-12 shrink-0 font-semibold ${methodClass[request.method]}`}>{request.method}</span>
                  {editingRequestId === request.id ? (
                    <input
                      autoFocus
                      value={editingRequestName}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setEditingRequestName(event.target.value)}
                      onBlur={() => void commitRequestRename(request)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void commitRequestRename(request)
                        if (event.key === 'Escape') setEditingRequestId(null)
                      }}
                      className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-zinc-200 outline-none"
                    />
                  ) : (
                    <span onDoubleClick={(event) => { event.stopPropagation(); setEditingRequestId(request.id ?? null); setEditingRequestName(request.name) }} className="min-w-0 flex-1 truncate text-zinc-300">{request.name}</span>
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      setContextMenu({ kind: 'request', x: event.clientX, y: event.clientY, request })
                    }}
                    className="rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-200"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </button>
              ))}
            </div>
              ))}
            </>
          ) : history.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void loadHistoryItem(item)}
              onContextMenu={(event) => {
                event.preventDefault()
                setContextMenu({ kind: 'history', x: event.clientX, y: event.clientY, item })
              }}
              className="block w-full border-b border-zinc-800 px-3 py-2 text-left text-xs hover:bg-zinc-800"
            >
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-zinc-600" />
                <span className={methodClass[(item.request.method as HttpMethod) ?? 'GET']}>{String(item.request.method ?? 'GET')}</span>
                <span className={`ml-auto ${statusClass(Number(item.response.status))}`}>{String(item.response.status ?? '')}</span>
              </div>
              <div className="mt-1 truncate text-zinc-500">{String(item.request.resolvedUrl ?? item.request.url ?? '')}</div>
              <div className="mt-1 flex gap-2 text-[10px] text-zinc-600">
                <span>{Math.round(Number(item.response.duration ?? 0))}ms</span>
                <span>{relativeTime(item.executedAt)}</span>
              </div>
            </button>
          ))}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startSidebarResize}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-emerald-500/50"
        />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col" data-http-editor>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
          <select value={draft?.method ?? 'GET'} onChange={(event) => updateDraft({ method: event.target.value as HttpMethod })} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs outline-none">
            {methods.map((method) => <option key={method}>{method}</option>)}
          </select>
          <input value={draft?.url ?? ''} onChange={(event) => updateDraft({ url: event.target.value })} placeholder="https://api.example.com/{{resource}}" className={`min-w-0 flex-1 rounded border bg-zinc-950 px-3 py-1.5 text-sm outline-none ${urlMissingVariables.length ? 'border-red-700 text-red-200' : 'border-zinc-700'}`} />
          <button type="button" onClick={() => void send()} disabled={!draft || loading} className="flex items-center gap-1 rounded bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-600 disabled:opacity-40">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Send
          </button>
          <button type="button" title="Save request" onClick={() => void saveDraft()} disabled={!draft} className="rounded border border-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"><Save className="h-4 w-4" /></button>
          <button type="button" title="Copy as cURL" onClick={() => void copyCurl()} disabled={!draft} className="rounded border border-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"><Copy className="h-4 w-4" /></button>
          <button type="button" title="Import cURL" onClick={() => setImportOpen(true)} className="rounded border border-zinc-700 p-1.5 text-zinc-300 hover:bg-zinc-800"><Upload className="h-4 w-4" /></button>
          <div className="relative" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setEnvMenuOpen((open) => !open)}
              className="min-w-28 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-900"
            >
              {activeEnvironment?.name ?? 'No Env'}
            </button>
            {envMenuOpen && (
              <div className="absolute right-0 top-9 z-50 w-72 rounded border border-zinc-700 bg-zinc-900 py-1 text-xs shadow-2xl">
                <button
                  type="button"
                  onClick={() => { updateDraft({ environmentId: null }); setEnvMenuOpen(false) }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800"
                >
                  <span className="w-4 text-emerald-400">{!draft?.environmentId ? '✓' : ''}</span>
                  <span className="min-w-0 flex-1 truncate">No Env</span>
                </button>
                {environments.map((environment) => {
                  const isGlobals = environment.name.toLowerCase() === 'globals'
                  return (
                    <div key={environment.id ?? environment.name} className="flex items-center gap-1 px-1 hover:bg-zinc-800">
                      <button
                        type="button"
                        onClick={() => { if (!isGlobals) updateDraft({ environmentId: environment.id ?? null }); setEnvMenuOpen(false) }}
                        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                      >
                        <span className="w-4 text-emerald-400">{draft?.environmentId === environment.id || isGlobals ? '✓' : ''}</span>
                        <span className="min-w-0 flex-1 truncate">{environment.name}</span>
                        {isGlobals && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">global</span>}
                      </button>
                      <button type="button" onClick={() => editEnvironment(environment)} className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100">
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isGlobals}
                        onClick={() => void deleteEnvironment(environment)}
                        className="rounded p-1 text-zinc-500 hover:bg-red-950/60 hover:text-red-300 disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
                <div className="mt-1 border-t border-zinc-800 pt-1">
                  <button type="button" onClick={createEnvironment} className="flex w-full items-center gap-2 px-3 py-2 text-left text-emerald-300 hover:bg-zinc-800">
                    <Plus className="h-3.5 w-3.5" />
                    New environment
                  </button>
                </div>
              </div>
            )}
          </div>
          {activeEnvironment && <span className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-emerald-300">{activeEnvironment.name}</span>}
          {globalsEnvironment && <span className="rounded bg-zinc-900 px-2 py-1 text-[10px] text-zinc-500">Globals</span>}
        </div>
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-900 px-3 text-[11px] text-zinc-500">
          <span className="shrink-0 text-zinc-600">Preview</span>
          <span className="min-w-0 flex-1 truncate">{previewUrl || 'No URL'}</span>
          {urlMissingVariables.map((variable) => <span key={variable} className="rounded bg-red-950/60 px-1.5 py-0.5 text-red-300">{`{{${variable}}}`}</span>)}
        </div>
        {openTabs.length > 0 && (
          <div className="flex h-9 shrink-0 items-center overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-2 text-xs" style={{ background: 'var(--strata-tab-bar)', borderColor: 'var(--strata-border)' }}>
            {openTabs.map((tab) => (
              <button key={tab.id ?? tab.name} type="button" onClick={() => { setDraft(tab); setActiveRequestId(tab.id ?? null) }} className={`flex h-7 min-w-36 max-w-56 items-center gap-2 border-r border-zinc-800 px-3 ${draft?.id === tab.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`} style={draft?.id === tab.id ? { background: 'var(--strata-tab-active)', color: 'var(--strata-text)', borderColor: 'var(--strata-border)' } : { borderColor: 'var(--strata-border)' }}>
                <span className={`font-semibold ${methodClass[tab.method]}`}>{tab.method}</span>
                <span className="min-w-0 flex-1 truncate text-left">{tab.name}</span>
                <X className="h-3.5 w-3.5" onClick={(event) => { event.stopPropagation(); setOpenTabs((tabs) => tabs.filter((item) => item.id !== tab.id)); if (draft?.id === tab.id) closeActiveTab() }} />
              </button>
            ))}
          </div>
        )}

        <div className="flex min-h-20 flex-col border-b border-zinc-800" style={{ height: `${requestPanePercent}%` }}>
          <div className="flex h-9 shrink-0 border-b border-zinc-800 px-2 text-xs">
            {(['params', 'headers', 'body', 'auth', 'scripts'] as const).map((tab) => (
              <button key={tab} type="button" onClick={() => setRequestTab(tab)} className={`px-3 ${requestTab === tab ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}>{tab[0].toUpperCase() + tab.slice(1)}</button>
            ))}
            <div className="flex-1" />
            <label className="flex items-center gap-2 text-zinc-500">
              Timeout
              <input type="number" value={draft?.timeoutMs ?? 30000} onChange={(event) => updateDraft({ timeoutMs: Number(event.target.value) })} className="w-24 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 outline-none" />
            </label>
            <label className="flex items-center gap-1.5 text-zinc-500" title="Redact bodies and sensitive headers for this request history">
              <input
                type="checkbox"
                checked={Boolean(draft?.sanitizeHistory)}
                disabled={!draft}
                onChange={(event) => updateDraft({ sanitizeHistory: event.target.checked })}
              />
              Sanitize history
            </label>
            <label className="flex items-center gap-1.5 text-zinc-500" title="Always redact HTTP history bodies and sensitive headers">
              <input
                type="checkbox"
                checked={redactHistoryBodies}
                onChange={(event) => void updateGlobalHistoryRedaction(event.target.checked)}
              />
              Global redact
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
          {!draft ? (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Create or select a request</div>
          ) : requestTab === 'params' ? (
            <KeyValueEditor rows={draft.params} onChange={(params) => updateDraft({ params, url: syncUrlParams(draft.url, params) })} />
          ) : requestTab === 'headers' ? (
            <KeyValueEditor rows={draft.headers} onChange={(headers) => updateDraft({ headers })} suggestions={headerSuggestions} />
          ) : requestTab === 'body' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-9 items-center gap-2 border-b border-zinc-800 px-3 text-xs">
                <select value={draft.body.type} onChange={(event) => updateDraft({ body: { ...draft.body, type: event.target.value as HttpBody['type'] } })} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 outline-none">
                  <option value="none">none</option>
                  <option value="raw">raw</option>
                  <option value="form-data">form-data</option>
                  <option value="x-www-form-urlencoded">x-www-form-urlencoded</option>
                </select>
                {draft.body.type === 'raw' && (
                  <select value={draft.body.rawType ?? 'json'} onChange={(event) => updateDraft({ body: { ...draft.body, rawType: event.target.value as HttpBody['rawType'] } })} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 outline-none">
                    <option value="json">JSON</option>
                    <option value="xml">XML</option>
                    <option value="text">Text</option>
                  </select>
                )}
              </div>
              {draft.body.type === 'raw' ? (
                <Editor height="100%" language={draft.body.rawType === 'xml' ? 'xml' : draft.body.rawType === 'json' ? 'json' : 'text'} theme={theme} value={draft.body.raw ?? ''} onChange={(value) => updateDraft({ body: { ...draft.body, raw: value ?? '' } })} options={{ minimap: { enabled: false }, fontSize: 13 }} />
              ) : draft.body.type === 'form-data' || draft.body.type === 'x-www-form-urlencoded' ? (
                <KeyValueEditor rows={draft.body.fields ?? []} onChange={(fields) => updateDraft({ body: { ...draft.body, fields } })} />
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">No request body</div>
              )}
            </div>
          ) : requestTab === 'auth' ? (
            <div className="grid max-w-xl grid-cols-2 gap-3 p-3 text-xs">
              <label className="col-span-2 flex flex-col gap-1 text-zinc-400">Type
                <select value={draft.auth.type} onChange={(event) => updateDraft({ auth: defaultAuth(event.target.value as HttpAuth['type']) })} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none">
                  <option value="none">None</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="basic">Basic Auth</option>
                  <option value="apiKey">API Key</option>
                </select>
              </label>
              {draft.auth.type === 'bearer' && (
                <div className="col-span-2 flex gap-2">
                  <input placeholder="Token" value={draft.auth.token} onChange={(event) => updateDraft({ auth: { type: 'bearer', token: event.target.value } })} className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 outline-none" />
                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value) updateDraft({ auth: { type: 'bearer', token: `{{${event.target.value}}}` } })
                    }}
                    className="w-40 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-300 outline-none"
                  >
                    <option value="">Usa variabile</option>
                    {variableNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
              )}
              {draft.auth.type === 'basic' && (
                <>
                  <input placeholder="Username" value={draft.auth.username} onChange={(event) => updateDraft({ auth: { type: 'basic', username: event.target.value, password: draft.auth.type === 'basic' ? draft.auth.password : '' } })} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 outline-none" />
                  <input placeholder="Password" type="password" value={draft.auth.password} onChange={(event) => updateDraft({ auth: { type: 'basic', username: draft.auth.type === 'basic' ? draft.auth.username : '', password: event.target.value } })} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 outline-none" />
                </>
              )}
              {draft.auth.type === 'apiKey' && (
                <>
                  <input placeholder="Key" value={draft.auth.key} onChange={(event) => updateDraft({ auth: { type: 'apiKey', key: event.target.value, value: draft.auth.type === 'apiKey' ? draft.auth.value : '', addTo: draft.auth.type === 'apiKey' ? draft.auth.addTo : 'header' } })} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 outline-none" />
                  <input placeholder="Value" value={draft.auth.value} onChange={(event) => updateDraft({ auth: { type: 'apiKey', key: draft.auth.type === 'apiKey' ? draft.auth.key : '', value: event.target.value, addTo: draft.auth.type === 'apiKey' ? draft.auth.addTo : 'header' } })} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 outline-none" />
                  <select value={draft.auth.addTo} onChange={(event) => updateDraft({ auth: { type: 'apiKey', key: draft.auth.type === 'apiKey' ? draft.auth.key : '', value: draft.auth.type === 'apiKey' ? draft.auth.value : '', addTo: event.target.value as 'header' | 'query' } })} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 outline-none">
                    <option value="header">Header</option>
                    <option value="query">Query</option>
                  </select>
                </>
              )}
              {authPreview(draft.auth) && (
                <div className="col-span-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-zinc-500">
                  {authPreview(draft.auth)}
                </div>
              )}
            </div>
          ) : (
            <div className="grid h-full grid-cols-2 gap-3 p-3 text-xs">
              <div className="flex min-h-0 flex-col rounded border border-zinc-800">
                <div className="border-b border-zinc-800 px-3 py-2 text-zinc-400">Pre-request script</div>
                <Editor
                  height="100%"
                  language="javascript"
                  theme={theme}
                  value={draft.scripts?.preRequest ?? ''}
                  onChange={(value) => updateDraft({ scripts: { ...(draft.scripts ?? {}), preRequest: value ?? '' } })}
                  options={{ minimap: { enabled: false }, fontSize: 12 }}
                />
              </div>
              <div className="flex min-h-0 flex-col rounded border border-zinc-800">
                <div className="border-b border-zinc-800 px-3 py-2 text-zinc-400">Post-response script</div>
                <Editor
                  height="100%"
                  language="javascript"
                  theme={theme}
                  value={draft.scripts?.postResponse ?? ''}
                  onChange={(value) => updateDraft({ scripts: { ...(draft.scripts ?? {}), postResponse: value ?? '' } })}
                  options={{ minimap: { enabled: false }, fontSize: 12 }}
                />
              </div>
            </div>
          )}
          </div>
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          onMouseDown={startPaneResize}
          onDoubleClick={() => {
            const percent = requestPanePercent > 70 ? 50 : 85
            setRequestPanePercent(percent)
            void window.api.http.saveLayout({ sidebarWidth, requestPanePercent: percent })
          }}
          className="h-1 shrink-0 cursor-row-resize bg-zinc-800 hover:bg-emerald-500/50"
        />

        <div className="flex min-h-20 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-3 border-b border-zinc-800 px-3 text-xs">
            <span className={`font-semibold ${statusClass(response?.status)}`}>{response ? `${response.status} ${response.statusText}` : responseError ? 'Request failed' : 'No response'}</span>
            {response && <span className="text-zinc-500">{Math.round(response.duration)}ms</span>}
            {response && <span className="text-zinc-500">{formatSize(response.size)}</span>}
            <div className="flex-1" />
            {(['body', 'headers', 'timeline'] as const).map((tab) => (
              <button key={tab} type="button" onClick={() => setResponseTab(tab)} className={responseTab === tab ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}>{tab[0].toUpperCase() + tab.slice(1)}</button>
            ))}
            <button
              type="button"
              onClick={() => {
                setCaptureDraft({ id: uid(), jsonPath: '$.', variable: variableNames[0] ?? '', enabled: true })
                setCaptureOpen(true)
              }}
              disabled={!response || !draft}
              className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
            >
              Salva valore
            </button>
            <button type="button" onClick={() => void copyResponseBody()} className={`rounded p-1 hover:bg-zinc-800 ${copiedBody ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-100'}`}>
              {copiedBody ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <label className="flex items-center gap-1 text-zinc-500"><input type="checkbox" checked={rawResponse} onChange={(event) => setRawResponse(event.target.checked)} />Raw</label>
          </div>
          {!response ? (
            <div className={`flex flex-1 items-center justify-center text-sm ${responseError ? 'text-red-300' : 'text-zinc-500'}`}>{responseError ?? 'Send a request to inspect the response'}</div>
          ) : responseTab === 'body' ? (
            <Editor height="100%" language={bodyLanguage(response.body)} theme={theme} value={prettyBody(response.body, rawResponse)} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }} />
          ) : responseTab === 'headers' ? (
            <div className="overflow-auto p-3 text-xs">
              {Object.entries(response.headers).map(([key, value]) => (
                <div key={key} className="grid grid-cols-[220px_1fr] border-b border-zinc-900 py-1.5">
                  <span className="text-zinc-400">{key}</span>
                  <span className="text-zinc-500">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid max-w-lg grid-cols-2 gap-3 p-3 text-xs">
              {Object.entries(response.timeline).map(([key, value]) => (
                <div key={key} className="rounded border border-zinc-800 p-3">
                  <div className="text-zinc-500">{key.toUpperCase()}</div>
                  <div className="mt-1 text-lg text-zinc-100">{value}ms</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      {response && (
        <div className="fixed bottom-3 right-4 z-40 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs shadow-xl">
          <span className={statusClass(response.status)}>{response.status} {response.statusText}</span>
          <span className="ml-3 text-zinc-500">{formatSize(response.size)}</span>
          <span className="ml-3 text-zinc-500">{Math.round(response.duration)}ms</span>
        </div>
      )}

      {contextMenu && (
        <div className="fixed z-50 min-w-44 rounded border border-zinc-700 bg-zinc-900 py-1 text-xs shadow-2xl" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          {contextMenu.kind === 'collection' ? (
            <>
              <button type="button" onClick={() => { setContextMenu(null); void createRequest(contextMenu.collection.id) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Nuova request</button>
              <button type="button" onClick={() => { const id = contextMenu.collection.id; setContextMenu(null); void createFolder(id) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Nuova cartella</button>
              <button type="button" onClick={() => { const collection = contextMenu.collection; setContextMenu(null); setEditingCollectionId(collection.id); setEditingCollectionName(collection.name) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Rinomina</button>
              <button type="button" onClick={() => { const id = contextMenu.collection.id; setContextMenu(null); void duplicateCollection(id) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Duplica</button>
              <button type="button" onClick={() => { const collection = contextMenu.collection; setContextMenu(null); void exportCollection(collection) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Esporta JSON</button>
              <button type="button" onClick={() => { const id = contextMenu.collection.id; setContextMenu(null); if (window.confirm('Delete collection?')) void window.api.http.deleteCollection(id).then(loadAll) }} className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-red-950/50">Elimina</button>
            </>
          ) : contextMenu.kind === 'folder' ? (
            <>
              <button type="button" onClick={() => { const folder = contextMenu.folder; setContextMenu(null); void createRequest(folder.collectionId, folder.id) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Nuova request</button>
              <button type="button" onClick={() => { const folder = contextMenu.folder; setContextMenu(null); setEditingFolderId(folder.id); setEditingFolderName(folder.name) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Rinomina</button>
              <button type="button" onClick={() => { const id = contextMenu.folder.id; setContextMenu(null); void window.api.http.duplicateFolder(id).then(loadAll) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Duplica</button>
              <button type="button" onClick={() => { const id = contextMenu.folder.id; setContextMenu(null); if (window.confirm('Delete folder and its requests?')) void window.api.http.deleteFolder(id).then(loadAll) }} className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-red-950/50">Elimina</button>
            </>
          ) : contextMenu.kind === 'request' ? (
            <>
              <button type="button" onClick={() => { const request = contextMenu.request; setContextMenu(null); void openRequest(request) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Apri</button>
              <button type="button" onClick={() => { const request = contextMenu.request; setContextMenu(null); setEditingRequestId(request.id ?? null); setEditingRequestName(request.name) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Rinomina</button>
              <button type="button" onClick={() => { const id = contextMenu.request.id; setContextMenu(null); if (id) void window.api.http.duplicateRequest(id).then(loadAll) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Duplica</button>
              <button type="button" onClick={() => { const request = contextMenu.request; setContextMenu(null); setMoveTarget(request) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Sposta in</button>
              <button type="button" onClick={() => { const request = contextMenu.request; setContextMenu(null); void copyCurl(request) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Copy as cURL</button>
              <button type="button" onClick={() => { const id = contextMenu.request.id; setContextMenu(null); void deleteRequest(id) }} className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-red-950/50">Elimina</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => { const item = contextMenu.item; setContextMenu(null); const request = historyToRequest(item, collections[0]?.id ?? 0); void saveDraft(request) }} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800">Salva in collection</button>
              <button type="button" onClick={() => { const id = contextMenu.item.id; setContextMenu(null); void window.api.http.deleteHistory(id).then(async () => setHistory(await window.api.http.history())) }} className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-red-950/50">Elimina</button>
            </>
          )}
        </div>
      )}

      {moveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="flex max-h-[560px] w-[420px] flex-col rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex h-11 items-center border-b border-zinc-800 px-4">
              <span className="flex-1 text-sm font-medium">Sposta in</span>
              <button type="button" onClick={() => setMoveTarget(null)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2 text-xs">
              {collections.map((collection) => (
                <div key={collection.id} className="mb-1">
                  <button
                    type="button"
                    onClick={() => void moveRequest(moveTarget, collection.id, null)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-zinc-300 hover:bg-zinc-800"
                  >
                    <Folder className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                  </button>
                  {folders.filter((folder) => folder.collectionId === collection.id && !folder.parentId).map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => void moveRequest(moveTarget, collection.id, folder.id)}
                      className="ml-4 flex w-[calc(100%-1rem)] items-center gap-2 rounded px-2 py-1.5 text-left text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      <Folder className="h-3.5 w-3.5 text-zinc-600" />
                      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {captureOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="w-[460px] rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex h-11 items-center border-b border-zinc-800 px-4">
              <span className="flex-1 text-sm font-medium">Salva valore response</span>
              <button type="button" onClick={() => setCaptureOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 p-4 text-xs">
              <label className="flex flex-col gap-1 text-zinc-400">
                JSONPath
                <input
                  value={captureDraft.jsonPath}
                  onChange={(event) => setCaptureDraft((capture) => ({ ...capture, jsonPath: event.target.value }))}
                  placeholder="$.data.token"
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-zinc-400">
                Variabile environment
                <input
                  list="http-variable-suggestions"
                  value={captureDraft.variable}
                  onChange={(event) => setCaptureDraft((capture) => ({ ...capture, variable: event.target.value }))}
                  placeholder="token"
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none"
                />
                <datalist id="http-variable-suggestions">
                  {variableNames.map((name) => <option key={name} value={name} />)}
                </datalist>
              </label>
              <div className="rounded border border-zinc-800 bg-zinc-950 px-2 py-2 text-zinc-500">
                Verrà aggiornata automaticamente dopo ogni Send di questa request.
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCaptureOpen(false)} className="rounded border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800">Cancel</button>
                <button type="button" onClick={saveResponseCapture} className="rounded bg-emerald-700 px-3 py-1.5 text-white hover:bg-emerald-600">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="flex h-[420px] w-[680px] flex-col rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex h-11 items-center border-b border-zinc-800 px-4">
              <span className="flex-1 text-sm font-medium">Import Postman / cURL</span>
              <button type="button" onClick={() => setImportOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <label className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
                <span>Postman collection/environment JSON</span>
                <input
                  type="file"
                  accept=".json,.postman_collection.json,.postman_environment.json,application/json"
                  onChange={(event) => void importFile(event.target.files?.[0])}
                  className="max-w-72 text-xs"
                />
              </label>
              <textarea
                autoFocus
                value={curlText}
                onChange={(event) => setCurlText(event.target.value)}
                placeholder={"Paste a cURL command or Postman JSON here...\n\ncurl -X POST 'https://api.example.com/users' -H 'Content-Type: application/json' -u user:pass -d '{\"name\":\"Ada\"}'"}
                className="min-h-0 flex-1 resize-none rounded border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 outline-none"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setImportOpen(false)} className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">Cancel</button>
                <button type="button" onClick={importCurl} disabled={!curlText.trim()} className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-600 disabled:opacity-40">Importa</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingEnvironment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="flex h-[620px] w-[760px] flex-col rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex h-11 items-center border-b border-zinc-800 px-4">
              <span className="flex-1 text-sm font-medium">Edit Environment</span>
              <button type="button" onClick={() => setEditingEnvironment(null)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                Name
                <input
                  value={editingEnvironment.name}
                  disabled={editingEnvironment.name.toLowerCase() === 'globals'}
                  onChange={(event) => setEditingEnvironment((environment) => environment ? { ...environment, name: event.target.value } : environment)}
                  className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none disabled:opacity-60"
                />
              </label>
              <div className="min-h-0 flex-1 rounded border border-zinc-800">
                <KeyValueEditor
                  rows={editingEnvironment.variables}
                  description
                  onChange={(variables) => setEditingEnvironment((environment) => environment ? { ...environment, variables } : environment)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditingEnvironment(null)} className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">Cancel</button>
                <button type="button" onClick={() => void saveEditingEnvironment()} className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-600">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
