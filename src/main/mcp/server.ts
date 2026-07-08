import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { ipcMain } from 'electron'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { getAIEnvironment, getMainWebContents } from '../environment'
import { executeDatabaseQuery, getDatabaseSchema, isConnectionReadOnly } from '../ipc/database'
import { getHttpRequest, saveHttpRequest, sendHttpRequest } from '../ipc/http'

type HeaderInput = Record<string, string> | { key: string; value: string; enabled?: boolean }[] | undefined

let httpServer: Server | null = null
let currentPort: number | null = null
const headersSchema = z.union([
  z.record(z.string(), z.string()),
  z.array(z.object({ key: z.string(), value: z.string(), enabled: z.boolean().optional() }))
]).optional()

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
})

const logTool = (tool: string) => {
  console.log(`[MCP] tool=${tool} called`)
}

const mutatingSqlKeywords = new Set(['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'REPLACE'])

const isMutatingSql = (sql: string) => {
  const match = sql.trim().match(/^([a-z]+)/i)
  return match ? mutatingSqlKeywords.has(match[1].toUpperCase()) : false
}

const requestMutatingQueryConfirmation = (sql: string): Promise<boolean> => {
  const webContents = getMainWebContents()
  if (!webContents) return Promise.resolve(false)

  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('db:confirm-mutating-query:response', onResponse)
      resolve(false)
    }, 60_000)

    const onResponse = (_event: Electron.IpcMainEvent, payload: { requestId: string; approved: boolean }) => {
      if (payload.requestId !== requestId) return
      clearTimeout(timeout)
      ipcMain.removeListener('db:confirm-mutating-query:response', onResponse)
      resolve(Boolean(payload.approved))
    }

    ipcMain.on('db:confirm-mutating-query:response', onResponse)
    webContents.send('db:confirm-mutating-query', { requestId, sql })
  })
}

const activeDbConnectionId = () => {
  const value = getAIEnvironment().activeDbConnectionId
  return value ? Number(value) : null
}

const activeHttpCollectionId = () => {
  const value = getAIEnvironment().activeHttpCollectionId
  return value ? Number(value) : null
}

const normalizeHeaders = (headers: HeaderInput) => {
  if (!headers) return []
  if (Array.isArray(headers)) {
    return headers.map((header) => ({
      key: header.key,
      value: header.value,
      enabled: header.enabled ?? true
    }))
  }
  return Object.entries(headers).map(([key, value]) => ({ key, value, enabled: true }))
}

const makeRequest = (input: {
  collectionId: number
  name?: string
  method: string
  url: string
  headers?: HeaderInput
  body?: string
  requestId?: number
}) => ({
  id: input.requestId,
  collectionId: input.collectionId,
  folderId: null,
  name: input.name?.trim() || `${input.method.toUpperCase()} ${input.url}`,
  method: input.method.toUpperCase(),
  url: input.url,
  params: [],
  headers: normalizeHeaders(input.headers),
  body: input.body ? { type: 'raw' as const, rawType: 'text', raw: input.body } : { type: 'none' as const },
  auth: { type: 'none' as const },
  timeoutMs: 30000,
  environmentId: null,
  description: '',
  scripts: {},
  responseCaptures: []
})

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'strata-local', version: '1.0.0' })

  server.registerTool('strata_db_schema', {
    description: 'Ritorna lo schema del database attualmente connesso in Strata: tabelle, colonne, chiavi primarie e foreign key. Usalo prima di scrivere query o codice che tocca il DB.',
    inputSchema: {}
  }, async () => {
    logTool('strata_db_schema')
    const connectionId = activeDbConnectionId()
    if (!connectionId) return textResult('Nessun database settato nell\'environment.')
    return textResult(await getDatabaseSchema(connectionId))
  })

  server.registerTool('strata_db_query', {
    description: 'Esegue una query SQL sul database attualmente flaggato nell\'environment di Strata. Usa questo tool solo dopo avere controllato lo schema. Il risultato viene limitato a 100 righe.',
    inputSchema: {
      sql: z.string().describe('Query SQL da eseguire sul database flaggato')
    }
  }, async ({ sql }) => {
    logTool('strata_db_query')
    const connectionId = activeDbConnectionId()
    if (!connectionId) return textResult('Nessun database settato nell\'environment.')
    if (isMutatingSql(sql)) {
      if (isConnectionReadOnly(connectionId)) return textResult({ error: 'Connection is in read-only mode' })
      const approved = await requestMutatingQueryConfirmation(sql)
      if (!approved) return textResult({ error: 'Query cancelled by user' })
    }
    const result = await executeDatabaseQuery(connectionId, sql)
    return textResult({ ...result, rows: result.rows.slice(0, 100), rowCount: Math.min(result.rowCount, 100) })
  })

  server.registerTool('strata_http_save_request', {
    description: 'Salva o aggiorna una request HTTP nella collection attualmente flaggata in Strata. L\'AI passa metodo, URL, header, body e nome; la collection viene letta dall\'environment.',
    inputSchema: {
      method: z.string(),
      url: z.string(),
      name: z.string(),
      headers: headersSchema,
      body: z.string().optional()
    }
  }, async ({ method, url, name, headers, body }) => {
    logTool('strata_http_save_request')
    const collectionId = activeHttpCollectionId()
    if (!collectionId) return textResult('Nessuna collection HTTP settata nell\'environment.')
    const id = saveHttpRequest(makeRequest({ collectionId, method, url, name, headers: headers as HeaderInput, body }))
    return textResult({ id })
  })

  server.registerTool('strata_http_send', {
    description: 'Esegue una request HTTP da Strata. Puoi passare requestId di una request salvata oppure method+url+headers+body inline. Ritorna status, headers e body della response.',
    inputSchema: {
      requestId: z.number().optional(),
      method: z.string().optional(),
      url: z.string().optional(),
      headers: headersSchema,
      body: z.string().optional()
    }
  }, async ({ requestId, method, url, headers, body }) => {
    logTool('strata_http_send')
    const collectionId = activeHttpCollectionId()
    if (!collectionId) return textResult('Nessuna collection HTTP settata nell\'environment.')
    const request = requestId
      ? getHttpRequest(requestId)
      : makeRequest({ collectionId, method: method ?? 'GET', url: url ?? '', headers: headers as HeaderInput, body })
    if (!request.url) return textResult('URL HTTP mancante.')
    const response = await sendHttpRequest({ ...request, collectionId: request.collectionId || collectionId })
    return textResult({ status: response.status, statusText: response.statusText, headers: response.headers, body: response.body, url: response.url })
  })

  server.registerTool('strata_editor_insert', {
    description: 'Inserisce codice nella posizione del cursore del file attualmente aperto nell\'editor Strata. Usalo quando l\'utente chiede di applicare o inserire codice nel file aperto.',
    inputSchema: {
      code: z.string().describe('Codice da inserire nella posizione corrente del cursore editor')
    }
  }, async ({ code }) => {
    logTool('strata_editor_insert')
    const webContents = getMainWebContents()
    if (!webContents) return textResult('Editor non disponibile: finestra Strata non pronta.')
    webContents.send('editor:insertCode', { code })
    return textResult({ inserted: true })
  })

  return server
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : undefined
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url?.split('?')[0] !== '/mcp') {
    res.writeHead(404).end('Not found')
    return
  }

  const server = createMcpServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  const body = req.method === 'POST' ? await readJsonBody(req) : undefined
  await transport.handleRequest(req, res, body)
  res.on('close', () => {
    void server.close()
  })
}

export async function startMcpServer(): Promise<number> {
  if (httpServer && currentPort) return currentPort

  for (let port = 7842; port < 7862; port += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = createServer((req, res) => {
          void handleMcpRequest(req, res).catch((error) => {
            console.error('[MCP] request failed', error)
            if (!res.headersSent) res.writeHead(500)
            res.end(error instanceof Error ? error.message : String(error))
          })
        })
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject)
          httpServer = server
          currentPort = port
          resolve()
        })
      })
      console.log(`[MCP] listening on http://127.0.0.1:${port}/mcp`)
      return port
    } catch {
      continue
    }
  }

  throw new Error('Unable to bind MCP server on ports 7842-7861.')
}

export function stopMcpServer(): void {
  httpServer?.close()
  httpServer = null
  currentPort = null
}

export function getMcpServerUrl(): string {
  return `http://127.0.0.1:${currentPort ?? 7842}/mcp`
}
