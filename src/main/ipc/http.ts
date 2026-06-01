import { ipcMain } from 'electron'
import { performance } from 'perf_hooks'
import vm from 'vm'
import { getDb } from '../storage/db'

type KeyValue = { id?: string; key: string; value: string; enabled: boolean; description?: string }
type BodyConfig = { type: 'none' | 'raw' | 'form-data' | 'x-www-form-urlencoded'; rawType?: string; raw?: string; fields?: KeyValue[] }
type ScriptConfig = { preRequest?: string; postResponse?: string }
type ResponseCapture = { id?: string; jsonPath: string; variable: string; enabled: boolean }
type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apiKey'; key: string; value: string; addTo: 'header' | 'query' }
type HttpRequestInput = {
  id?: number
  collectionId: number
  folderId?: number | null
  name: string
  method: string
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  body: BodyConfig
  auth: AuthConfig
  timeoutMs: number
  environmentId?: number | null
  description?: string
  scripts?: ScriptConfig
  responseCaptures?: ResponseCapture[]
}
type EnvironmentInput = { id?: number; name: string; variables: KeyValue[] }

const now = () => new Date().toISOString()
const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const requestFromRow = (row: Record<string, unknown>) => ({
  id: Number(row.id),
  collectionId: Number(row.collection_id),
  folderId: row.folder_id === null || row.folder_id === undefined ? null : Number(row.folder_id),
  name: String(row.name),
  method: String(row.method),
  url: String(row.url),
  params: parseJson<KeyValue[]>(String(row.params ?? '[]'), []),
  headers: parseJson<KeyValue[]>(String(row.headers ?? '[]'), []),
  body: parseJson<BodyConfig>(String(row.body ?? '{}'), { type: 'none' }),
  auth: parseJson<AuthConfig>(String(row.auth ?? '{}'), { type: 'none' }),
  timeoutMs: Number(row.timeout_ms ?? 30000),
  environmentId: row.environment_id === null || row.environment_id === undefined ? null : Number(row.environment_id),
  description: String(row.description ?? ''),
  scripts: parseJson<ScriptConfig>(String(row.scripts ?? '{}'), {}),
  responseCaptures: parseJson<ResponseCapture[]>(String(row.response_captures ?? '[]'), []),
  updatedAt: String(row.updated_at),
})

const environmentFromRow = (row: Record<string, unknown>) => ({
  id: Number(row.id),
  name: String(row.name),
  variables: parseJson<KeyValue[]>(String(row.variables ?? '[]'), []),
  updatedAt: String(row.updated_at),
})

const folderFromRow = (row: Record<string, unknown>) => ({
  id: Number(row.id),
  collectionId: Number(row.collection_id),
  name: String(row.name),
  parentId: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
  updatedAt: String(row.updated_at),
})

const replaceVariables = (value: string, variables: Map<string, string>) =>
  value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => variables.get(key) ?? '')

const ensureGlobalsEnvironment = () => {
  const existing = getDb().prepare("SELECT id FROM http_environments WHERE lower(name) = 'globals'").get() as { id: number } | undefined
  if (existing) return existing.id
  const result = getDb().prepare('INSERT INTO http_environments (name, variables, updated_at) VALUES (?, ?, ?)')
    .run('Globals', '[]', now())
  return Number(result.lastInsertRowid)
}

const targetEnvironmentId = (environmentId?: number | null) => environmentId || ensureGlobalsEnvironment()

const updateEnvironmentVariable = (environmentId: number | null | undefined, key: string, value: string) => {
  const id = targetEnvironmentId(environmentId)
  const row = getDb().prepare('SELECT variables FROM http_environments WHERE id = ?').get(id) as { variables: string } | undefined
  const variables = parseJson<KeyValue[]>(row?.variables, [])
  const existing = variables.find((item) => item.key === key)
  if (existing) {
    existing.value = value
    existing.enabled = true
  } else {
    variables.push({ key, value, enabled: true })
  }
  getDb().prepare('UPDATE http_environments SET variables = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(variables), now(), id)
}

const getEnvironmentVariables = (environmentId?: number | null) => {
  const variables = new Map<string, string>()
  const globalsId = ensureGlobalsEnvironment()
  const rows = [
    getDb().prepare('SELECT variables FROM http_environments WHERE id = ?').get(globalsId),
    environmentId && environmentId !== globalsId
      ? getDb().prepare('SELECT variables FROM http_environments WHERE id = ?').get(environmentId)
      : null,
  ].filter(Boolean) as { variables: string }[]
  rows.forEach((row) => {
    parseJson<KeyValue[]>(row.variables, [])
      .filter((item) => item.enabled && item.key)
      .forEach((item) => variables.set(item.key, item.value))
  })
  return variables
}

const runScript = (script: string | undefined, input: HttpRequestInput, variables: Map<string, string>, response?: { status: number; body: string }) => {
  if (!script?.trim()) return
  const pm = {
    environment: {
      get: (key: string) => variables.get(key),
      set: (key: string, value: unknown) => {
        const nextValue = String(value)
        variables.set(key, nextValue)
        updateEnvironmentVariable(input.environmentId, key, nextValue)
      },
    },
    response: response ? {
      status: response.status,
      json: () => JSON.parse(response.body),
    } : undefined,
  }
  vm.runInNewContext(script, { pm, console }, { timeout: 1000 })
}

const jsonPathValue = (body: string, pathValue: string) => {
  const data = JSON.parse(body)
  const parts = pathValue.replace(/^\$\./, '').split('.').filter(Boolean)
  return parts.reduce<unknown>((value, part) => {
    if (value === null || value === undefined) return undefined
    const match = part.match(/^(.+)\[(\d+)\]$/)
    if (match) return (value as Record<string, unknown>)[match[1]] instanceof Array ? ((value as Record<string, unknown>)[match[1]] as unknown[])[Number(match[2])] : undefined
    return (value as Record<string, unknown>)[part]
  }, data)
}

const applyAuth = (auth: AuthConfig, headers: Map<string, string>, url: URL) => {
  if (auth.type === 'bearer' && auth.token) headers.set('Authorization', `Bearer ${auth.token}`)
  if (auth.type === 'basic') {
    const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64')
    headers.set('Authorization', `Basic ${encoded}`)
  }
  if (auth.type === 'apiKey' && auth.key) {
    if (auth.addTo === 'query') url.searchParams.set(auth.key, auth.value)
    else headers.set(auth.key, auth.value)
  }
}

const buildRequest = (input: HttpRequestInput, variables: Map<string, string>) => {
  const resolvedUrl = replaceVariables(input.url, variables)
  const url = new URL(resolvedUrl)

  input.params
    .filter((param) => param.enabled && param.key)
    .forEach((param) => url.searchParams.set(replaceVariables(param.key, variables), replaceVariables(param.value, variables)))

  const headers = new Map<string, string>()
  input.headers
    .filter((header) => header.enabled && header.key)
    .forEach((header) => headers.set(replaceVariables(header.key, variables), replaceVariables(header.value, variables)))

  applyAuth(input.auth, headers, url)

  let body: BodyInit | undefined
  if (!['GET', 'HEAD'].includes(input.method.toUpperCase())) {
    if (input.body.type === 'raw') {
      body = replaceVariables(input.body.raw ?? '', variables)
    } else if (input.body.type === 'x-www-form-urlencoded') {
      const form = new URLSearchParams()
      input.body.fields?.filter((field) => field.enabled && field.key).forEach((field) => {
        form.set(replaceVariables(field.key, variables), replaceVariables(field.value, variables))
      })
      body = form
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/x-www-form-urlencoded')
    } else if (input.body.type === 'form-data') {
      const form = new FormData()
      input.body.fields?.filter((field) => field.enabled && field.key).forEach((field) => {
        form.set(replaceVariables(field.key, variables), replaceVariables(field.value, variables))
      })
      body = form
    }
  }

  return { url, headers, body }
}

const bodySize = (text: string) => Buffer.byteLength(text, 'utf8')

export function registerHttpIpc(): void {
  ipcMain.handle('http:list', () => {
    ensureGlobalsEnvironment()
    const collections = getDb().prepare('SELECT id, name FROM http_collections ORDER BY name').all() as Record<string, unknown>[]
    const folders = getDb().prepare('SELECT * FROM http_folders ORDER BY name').all() as Record<string, unknown>[]
    const requests = getDb().prepare('SELECT * FROM http_requests ORDER BY name').all() as Record<string, unknown>[]
    return {
      collections: collections.map((row) => ({ id: Number(row.id), name: String(row.name) })),
      folders: folders.map(folderFromRow),
      requests: requests.map(requestFromRow),
      activeRequestId: Number((getDb().prepare("SELECT value FROM http_settings WHERE key = 'activeRequestId'").get() as { value?: string } | undefined)?.value ?? 0) || null,
    }
  })

  ipcMain.handle('http:createCollection', (_event, name: string) => {
    const result = getDb().prepare('INSERT INTO http_collections (name) VALUES (?)').run(name.trim() || 'New Collection')
    return Number(result.lastInsertRowid)
  })

  ipcMain.handle('http:renameCollection', (_event, id: number, name: string) => {
    getDb().prepare('UPDATE http_collections SET name = ? WHERE id = ?').run(name.trim() || 'Collection', id)
    return true
  })

  ipcMain.handle('http:deleteCollection', (_event, id: number) => {
    getDb().prepare('DELETE FROM http_requests WHERE collection_id = ?').run(id)
    getDb().prepare('DELETE FROM http_folders WHERE collection_id = ?').run(id)
    getDb().prepare('DELETE FROM http_collections WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('http:duplicateCollection', (_event, id: number) => {
    const collection = getDb().prepare('SELECT * FROM http_collections WHERE id = ?').get(id) as { name: string } | undefined
    if (!collection) throw new Error('Collection not found.')
    const result = getDb().prepare('INSERT INTO http_collections (name) VALUES (?)').run(`${collection.name} Copy`)
    const nextCollectionId = Number(result.lastInsertRowid)
    const folderMap = new Map<number, number>()
    const folders = getDb().prepare('SELECT * FROM http_folders WHERE collection_id = ? ORDER BY parent_id').all(id) as Record<string, unknown>[]
    folders.forEach((row) => {
      const folder = folderFromRow(row)
      const parentId = folder.parentId ? folderMap.get(folder.parentId) ?? null : null
      const folderResult = getDb().prepare('INSERT INTO http_folders (collection_id, name, parent_id, updated_at) VALUES (?, ?, ?, ?)')
        .run(nextCollectionId, folder.name, parentId, now())
      folderMap.set(folder.id, Number(folderResult.lastInsertRowid))
    })
    const rows = getDb().prepare('SELECT * FROM http_requests WHERE collection_id = ?').all(id) as Record<string, unknown>[]
    rows.forEach((row) => {
      const request = requestFromRow(row)
      getDb().prepare(`
        INSERT INTO http_requests (collection_id, folder_id, name, method, url, params, headers, body, auth, timeout_ms, environment_id, description, scripts, response_captures, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nextCollectionId,
        request.folderId ? folderMap.get(request.folderId) ?? null : null,
        request.name,
        request.method,
        request.url,
        JSON.stringify(request.params),
        JSON.stringify(request.headers),
        JSON.stringify(request.body),
        JSON.stringify(request.auth),
        request.timeoutMs,
        request.environmentId,
        request.description ?? '',
        JSON.stringify(request.scripts ?? {}),
        JSON.stringify(request.responseCaptures ?? []),
        now(),
      )
    })
    return nextCollectionId
  })

  ipcMain.handle('http:createFolder', (_event, collectionId: number, name: string, parentId?: number | null) => {
    const result = getDb().prepare('INSERT INTO http_folders (collection_id, name, parent_id, updated_at) VALUES (?, ?, ?, ?)')
      .run(collectionId, name.trim() || 'New Folder', parentId ?? null, now())
    return Number(result.lastInsertRowid)
  })

  ipcMain.handle('http:renameFolder', (_event, id: number, name: string) => {
    getDb().prepare('UPDATE http_folders SET name = ?, updated_at = ? WHERE id = ?').run(name.trim() || 'Folder', now(), id)
    return true
  })

  ipcMain.handle('http:deleteFolder', (_event, id: number) => {
    getDb().prepare('DELETE FROM http_requests WHERE folder_id = ?').run(id)
    getDb().prepare('DELETE FROM http_folders WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('http:duplicateFolder', (_event, id: number) => {
    const row = getDb().prepare('SELECT * FROM http_folders WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new Error('Folder not found.')
    const folder = folderFromRow(row)
    const result = getDb().prepare('INSERT INTO http_folders (collection_id, name, parent_id, updated_at) VALUES (?, ?, ?, ?)')
      .run(folder.collectionId, `${folder.name} Copy`, folder.parentId, now())
    const nextFolderId = Number(result.lastInsertRowid)
    const rows = getDb().prepare('SELECT * FROM http_requests WHERE folder_id = ?').all(id) as Record<string, unknown>[]
    rows.forEach((requestRow) => {
      const request = requestFromRow(requestRow)
      getDb().prepare(`
        INSERT INTO http_requests (collection_id, folder_id, name, method, url, params, headers, body, auth, timeout_ms, environment_id, description, scripts, response_captures, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        folder.collectionId,
        nextFolderId,
        request.name,
        request.method,
        request.url,
        JSON.stringify(request.params),
        JSON.stringify(request.headers),
        JSON.stringify(request.body),
        JSON.stringify(request.auth),
        request.timeoutMs,
        request.environmentId,
        request.description ?? '',
        JSON.stringify(request.scripts ?? {}),
        JSON.stringify(request.responseCaptures ?? []),
        now(),
      )
    })
    return nextFolderId
  })

  ipcMain.handle('http:saveRequest', (_event, input: HttpRequestInput) => {
    const payload = [
      input.collectionId,
      input.folderId ?? null,
      input.name.trim() || 'New Request',
      input.method,
      input.url,
      JSON.stringify(input.params ?? []),
      JSON.stringify(input.headers ?? []),
      JSON.stringify(input.body ?? { type: 'none' }),
      JSON.stringify(input.auth ?? { type: 'none' }),
      Math.max(1000, Number(input.timeoutMs) || 30000),
      input.environmentId ?? null,
      input.description ?? '',
      JSON.stringify(input.scripts ?? {}),
      JSON.stringify(input.responseCaptures ?? []),
      now(),
    ]

    if (input.id) {
      getDb().prepare(`
        UPDATE http_requests
        SET collection_id = ?, folder_id = ?, name = ?, method = ?, url = ?, params = ?, headers = ?, body = ?, auth = ?, timeout_ms = ?, environment_id = ?, description = ?, scripts = ?, response_captures = ?, updated_at = ?
        WHERE id = ?
      `).run(...payload, input.id)
      return input.id
    }

    const result = getDb().prepare(`
      INSERT INTO http_requests (collection_id, folder_id, name, method, url, params, headers, body, auth, timeout_ms, environment_id, description, scripts, response_captures, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...payload)
    return Number(result.lastInsertRowid)
  })

  ipcMain.handle('http:deleteRequest', (_event, id: number) => {
    getDb().prepare('DELETE FROM http_requests WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('http:moveRequest', (_event, id: number, collectionId: number, folderId?: number | null) => {
    getDb().prepare('UPDATE http_requests SET collection_id = ?, folder_id = ?, updated_at = ? WHERE id = ?').run(collectionId, folderId ?? null, now(), id)
    return true
  })

  ipcMain.handle('http:duplicateRequest', (_event, id: number) => {
    const row = getDb().prepare('SELECT * FROM http_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new Error('Request not found.')
    const request = requestFromRow(row)
    const result = getDb().prepare(`
      INSERT INTO http_requests (collection_id, folder_id, name, method, url, params, headers, body, auth, timeout_ms, environment_id, description, scripts, response_captures, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      request.collectionId,
      request.folderId ?? null,
      `${request.name} Copy`,
      request.method,
      request.url,
      JSON.stringify(request.params),
      JSON.stringify(request.headers),
      JSON.stringify(request.body),
      JSON.stringify(request.auth),
      request.timeoutMs,
      request.environmentId,
      request.description ?? '',
      JSON.stringify(request.scripts ?? {}),
      JSON.stringify(request.responseCaptures ?? []),
      now(),
    )
    return Number(result.lastInsertRowid)
  })

  ipcMain.handle('http:setActiveRequest', (_event, id: number | null) => {
    getDb().prepare('INSERT OR REPLACE INTO http_settings (key, value) VALUES (?, ?)').run('activeRequestId', id ? String(id) : '')
    return true
  })

  ipcMain.handle('http:getLayout', () => {
    const sidebarWidth = Number((getDb().prepare("SELECT value FROM http_settings WHERE key = 'sidebarWidth'").get() as { value?: string } | undefined)?.value ?? 320)
    const requestPanePercent = Number((getDb().prepare("SELECT value FROM http_settings WHERE key = 'requestPanePercent'").get() as { value?: string } | undefined)?.value ?? 50)
    return {
      sidebarWidth: Math.min(400, Math.max(160, sidebarWidth || 320)),
      requestPanePercent: Math.min(85, Math.max(30, requestPanePercent || 50)),
    }
  })

  ipcMain.handle('http:saveLayout', (_event, layout: { sidebarWidth: number; requestPanePercent: number }) => {
    getDb().prepare('INSERT OR REPLACE INTO http_settings (key, value) VALUES (?, ?)').run('sidebarWidth', String(Math.min(400, Math.max(160, Number(layout.sidebarWidth) || 320))))
    getDb().prepare('INSERT OR REPLACE INTO http_settings (key, value) VALUES (?, ?)').run('requestPanePercent', String(Math.min(85, Math.max(30, Number(layout.requestPanePercent) || 50))))
    return true
  })

  ipcMain.handle('http:listEnvironments', () => {
    ensureGlobalsEnvironment()
    return (getDb().prepare('SELECT * FROM http_environments ORDER BY name').all() as Record<string, unknown>[]).map(environmentFromRow)
  })

  ipcMain.handle('http:saveEnvironment', (_event, input: EnvironmentInput) => {
    if (input.id) {
      getDb().prepare('UPDATE http_environments SET name = ?, variables = ?, updated_at = ? WHERE id = ?')
        .run(input.name.trim() || 'Environment', JSON.stringify(input.variables ?? []), now(), input.id)
      return input.id
    }
    const result = getDb().prepare('INSERT INTO http_environments (name, variables, updated_at) VALUES (?, ?, ?)')
      .run(input.name.trim() || 'Environment', JSON.stringify(input.variables ?? []), now())
    return Number(result.lastInsertRowid)
  })

  ipcMain.handle('http:deleteEnvironment', (_event, id: number) => {
    const row = getDb().prepare('SELECT name FROM http_environments WHERE id = ?').get(id) as { name: string } | undefined
    if (row?.name.toLowerCase() === 'globals') throw new Error('Globals environment cannot be deleted.')
    getDb().prepare('DELETE FROM http_environments WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('http:history', () => {
    return (getDb().prepare('SELECT * FROM http_history ORDER BY executed_at DESC LIMIT 100').all() as Record<string, unknown>[])
      .map((row) => ({
        id: Number(row.id),
        request: parseJson(String(row.request), {}),
        response: parseJson(String(row.response), {}),
        executedAt: String(row.executed_at),
      }))
  })

  ipcMain.handle('http:deleteHistory', (_event, id: number) => {
    getDb().prepare('DELETE FROM http_history WHERE id = ?').run(id)
    return true
  })

  ipcMain.handle('http:send', async (_event, input: HttpRequestInput) => {
    const startedAt = performance.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(input.timeoutMs) || 30000))
    const variables = getEnvironmentVariables(input.environmentId)
    runScript(input.scripts?.preRequest, input, variables)
    const { url, headers, body } = buildRequest(input, variables)
    const requestHeaders = Object.fromEntries(headers)

    try {
      const response = await fetch(url, {
        method: input.method,
        headers: requestHeaders,
        body,
        signal: controller.signal,
      })
      const text = await response.text()
      const duration = performance.now() - startedAt
      const responseHeaders = Object.fromEntries(response.headers.entries())
      const result = {
        status: response.status,
        statusText: response.statusText,
        duration,
        size: bodySize(text),
        body: text,
        headers: responseHeaders,
        timeline: {
          dns: 0,
          tcp: 0,
          ttfb: Math.round(duration * 0.7),
          download: Math.max(0, Math.round(duration * 0.3)),
        },
        url: url.toString(),
      }

      try {
        input.responseCaptures?.filter((capture) => capture.enabled && capture.variable && capture.jsonPath).forEach((capture) => {
          const value = jsonPathValue(text, capture.jsonPath)
          if (value !== undefined) {
            const nextValue = typeof value === 'string' ? value : JSON.stringify(value)
            variables.set(capture.variable, nextValue)
            updateEnvironmentVariable(input.environmentId, capture.variable, nextValue)
          }
        })
      } catch (error) {
        console.warn('http response capture skipped:', error)
      }
      runScript(input.scripts?.postResponse, input, variables, { status: response.status, body: text })

      getDb().prepare('INSERT INTO http_history (collection_id, request, response, executed_at) VALUES (?, ?, ?, ?)')
        .run(input.collectionId, JSON.stringify({ ...input, resolvedUrl: url.toString() }), JSON.stringify(result), now())
      getDb().prepare('DELETE FROM http_history WHERE id NOT IN (SELECT id FROM http_history ORDER BY executed_at DESC LIMIT 100)').run()
      return result
    } finally {
      clearTimeout(timeout)
    }
  })
}
