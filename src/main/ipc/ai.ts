import { ipcMain, type WebContents } from 'electron'
import { execSync, spawn, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getDb } from '../storage/db'
import { ensureMcpConfigFiles } from '../mcp/config'

const PROVIDERS = ['claude', 'codex'] as const
type Provider = typeof PROVIDERS[number]
type AgentMode = Provider | 'auto'
type AiProcess = ReturnType<typeof spawn>

type AiMessageInput = { role: 'user' | 'assistant'; content: string }
type AiContextAttachment = { path: string; relativePath: string; kind: 'file' | 'folder' }
type AiSendPayload = {
  sessionId: string
  requestId: string
  workspacePath: string
  system: string
  messages: AiMessageInput[]
  agentMode: AgentMode
  explicitContext?: AiContextAttachment[]
}
type AiSessionStatus = 'active' | 'terminated' | 'processing'
type AiSessionRow = {
  id: string
  title: string
  agent: Provider
  workspace_path: string
  created_at: string
  updated_at: string
  files: string | null
}

type GitignorePattern = {
  pattern: string
  negated: boolean
  directoryOnly: boolean
  anchored: boolean
}

const activeProcesses = new Map<string, AiProcess>()
const activeWatchers = new Map<string, fs.FSWatcher>()
const explicitlyStoppedSessions = new Set<string>()
const MAX_EXPLICIT_CONTEXT_CHARS = 200_000
const ALWAYS_IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'dist-electron', 'release'])
const CLAUDE_ALLOWED_STRATA_TOOLS = [
  'mcp__strata__strata_db_schema',
  'mcp__strata__strata_db_query',
  'mcp__strata__strata_http_save_request',
  'mcp__strata__strata_http_send',
  'mcp__strata__strata_editor_insert'
]

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const now = () => new Date().toISOString()

function getShellPath(): string {
  return process.env.PATH || ''
}

function resolveProviderCommand(cmd: Provider, envPath: string): string {
  if (process.platform !== 'win32') return cmd

  try {
    const result = execSync(`where ${cmd}`, {
      encoding: 'utf8',
      env: { ...process.env, PATH: envPath }
    }).trim()
    return result.split(/\r?\n/)[0] || cmd
  } catch {
    return cmd
  }
}

function normalizeAgent(mode: AgentMode | string): Provider {
  return mode === 'codex' ? 'codex' : 'claude'
}

function getStatelessInvocation(agent: Provider): { args: string[]; useStdin: boolean } {
  const mcpConfig = ensureMcpConfigFiles()
  if (agent === 'claude') {
    return {
      args: [
        '--mcp-config',
        mcpConfig.claude,
        '--strict-mcp-config',
        '--allowedTools',
        CLAUDE_ALLOWED_STRATA_TOOLS.join(','),
        '--print'
      ],
      useStdin: true
    }
  }
  // TODO: Codex exec does not expose a clean MCP tool allowlist flag in the local help output.
  return {
    args: ['-c', `mcp_servers.strata.url="${mcpConfig.url}"`, 'exec', '-'],
    useStdin: true
  }
}

function titleFromMessage(message: string): string {
  const words = message.trim().replace(/\s+/g, ' ').split(' ').slice(0, 5).join(' ')
  return words || 'Nuova sessione'
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function gitignorePatternToRegex(pattern: GitignorePattern): RegExp {
  const normalized = normalizeRelativePath(pattern.pattern).replace(/\/$/, '')
  const parts = normalized.split('/').map((part) => {
    if (part === '**') return '.*'
    return escapeRegex(part).replace(/\\\*/g, '[^/]*')
  })
  const body = parts.join('/')
  const prefix = pattern.anchored ? '^' : '(^|.*/)'
  const suffix = pattern.directoryOnly ? '(/.*)?$' : '(/.*)?$'
  return new RegExp(`${prefix}${body}${suffix}`)
}

function loadGitignorePatterns(workspacePath: string): GitignorePattern[] {
  const gitignorePath = path.join(workspacePath, '.gitignore')
  if (!fs.existsSync(gitignorePath)) return []

  return fs.readFileSync(gitignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const negated = line.startsWith('!')
      const pattern = negated ? line.slice(1) : line
      return {
        pattern,
        negated,
        directoryOnly: pattern.endsWith('/'),
        anchored: pattern.startsWith('/'),
      }
    })
}

function isExcludedPath(relativePath: string, gitignorePatterns: GitignorePattern[]): boolean {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized) return false
  if (normalized.split('/').some((part) => ALWAYS_IGNORED_DIRS.has(part))) return true

  let ignored = false
  for (const pattern of gitignorePatterns) {
    if (gitignorePatternToRegex(pattern).test(normalized)) ignored = !pattern.negated
  }
  return ignored
}

function appendWithCap(parts: string[], text: string, usedChars: number): { usedChars: number; truncated: boolean } {
  const remaining = MAX_EXPLICIT_CONTEXT_CHARS - usedChars
  if (remaining <= 0) return { usedChars, truncated: true }
  if (text.length <= remaining) {
    parts.push(text)
    return { usedChars: usedChars + text.length, truncated: false }
  }
  parts.push(text.slice(0, remaining))
  return { usedChars: MAX_EXPLICIT_CONTEXT_CHARS, truncated: true }
}

function collectExplicitContext(workspacePath: string, explicitContext: AiContextAttachment[] = []): { text: string; warning: string | null } {
  if (explicitContext.length === 0) return { text: '', warning: null }

  const gitignorePatterns = loadGitignorePatterns(workspacePath)
  const parts: string[] = ['Explicit context selected by the user:\n']
  const visited = new Set<string>()
  let usedChars = parts[0].length
  let truncated = false
  let skipped = 0

  const appendFile = (filePath: string) => {
    try {
      const resolved = path.resolve(filePath)
      const relativePath = normalizeRelativePath(path.relative(workspacePath, resolved))
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return
      if (visited.has(resolved) || isExcludedPath(relativePath, gitignorePatterns)) {
        skipped += 1
        return
      }

      visited.add(resolved)
      const stat = fs.statSync(resolved)
      if (!stat.isFile()) return

      const header = `\n--- ${relativePath} ---\n`
      const content = fs.readFileSync(resolved, 'utf8')
      const result = appendWithCap(parts, `${header}${content}\n`, usedChars)
      usedChars = result.usedChars
      truncated = truncated || result.truncated
    } catch {
      skipped += 1
    }
  }

  const visit = (targetPath: string) => {
    try {
      const resolved = path.resolve(targetPath)
      const relativePath = normalizeRelativePath(path.relative(workspacePath, resolved))
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return
      if (isExcludedPath(relativePath, gitignorePatterns)) {
        skipped += 1
        return
      }

      const stat = fs.statSync(resolved)
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
          if (truncated) return
          visit(path.join(resolved, entry.name))
        }
        return
      }

      appendFile(resolved)
    } catch {
      skipped += 1
    }
  }

  for (const item of explicitContext) {
    if (truncated) break
    visit(item.path)
  }

  const warnings: string[] = []
  if (truncated) warnings.push(`Explicit context truncated at ${MAX_EXPLICIT_CONTEXT_CHARS.toLocaleString('en-US')} characters.`)
  if (skipped > 0) warnings.push(`${skipped} ignored path(s) were excluded by protected directories or .gitignore.`)

  return {
    text: parts.join(''),
    warning: warnings.length > 0 ? warnings.join(' ') : null,
  }
}

function buildPrompt(system: string, messages: AiMessageInput[], workspacePath: string, explicitContext: AiContextAttachment[] = []): string {
  const collectedContext = collectExplicitContext(workspacePath, explicitContext)
  const lines: string[] = [system, '\n---\n']
  if (collectedContext.text) {
    lines.push(collectedContext.text)
    if (collectedContext.warning) lines.push(`\nWarning: ${collectedContext.warning}\n`)
    lines.push('\n---\n')
  }
  for (const msg of messages) {
    lines.push(`${msg.role === 'user' ? 'User' : 'Assistant'}:\n${msg.content}\n`)
  }
  return lines.join('\n')
}

function ensureSession(sessionId: string, workspacePath: string, agent: Provider, firstMessage: string): void {
  const timestamp = now()
  getDb().prepare(`
    INSERT INTO ai_sessions (id, title, agent, workspace_path, created_at, updated_at, read_only)
    VALUES (?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `).run(sessionId, titleFromMessage(firstMessage), agent, workspacePath, timestamp, timestamp)
}

function saveMessage(sessionId: string, role: 'user' | 'assistant', content: string, agent: Provider): void {
  getDb().prepare(`
    INSERT INTO ai_messages (id, session_id, role, content, agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uid(), sessionId, role, content, agent, now())
  getDb().prepare('UPDATE ai_sessions SET updated_at = ? WHERE id = ?').run(now(), sessionId)
}

function saveTouchedFile(sessionId: string, workspacePath: string, filePath: string): void {
  try {
    if (!filePath) return
    const session = getDb().prepare('SELECT id FROM ai_sessions WHERE id = ?').get(sessionId)
    if (!session) return
    const relative = path.relative(workspacePath, path.resolve(workspacePath, filePath))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return
    getDb().prepare(`
      INSERT INTO ai_session_files (session_id, file_path, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id, file_path) DO UPDATE SET updated_at = excluded.updated_at
    `).run(sessionId, relative, now())
  } catch (error) {
    console.warn('ai touched file tracking skipped:', error)
  }
}

function startFileWatcher(sessionId: string, workspacePath: string): void {
  try {
    activeWatchers.get(sessionId)?.close()
  } catch {
    // Ignore watcher cleanup races.
  }
  try {
    const watcher = fs.watch(workspacePath, { recursive: true }, (_eventType, filename) => {
      if (filename) saveTouchedFile(sessionId, workspacePath, filename.toString())
    })
    activeWatchers.set(sessionId, watcher)
  } catch {
    activeWatchers.delete(sessionId)
  }
}

function closeWatcher(sessionId: string): void {
  try {
    activeWatchers.get(sessionId)?.close()
  } catch {
    // Ignore watcher cleanup races.
  }
  activeWatchers.delete(sessionId)
}

function killProcessTree(proc: AiProcess): void {
  if (proc.killed || proc.exitCode !== null) return

  try {
    if (process.platform === 'win32' && proc.pid) {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
      return
    }
    proc.kill()
  } catch {
    // The child may have exited between the liveness check and kill.
  }
}

function releaseProcessHandles(proc: AiProcess): void {
  proc.stdin?.removeAllListeners()
  proc.stdout?.removeAllListeners()
  proc.stderr?.removeAllListeners()
  proc.removeAllListeners()
}

function stopSessionRuntime(sessionId: string): void {
  closeWatcher(sessionId)
  const proc = activeProcesses.get(sessionId)
  if (proc) {
    explicitlyStoppedSessions.add(sessionId)
    killProcessTree(proc)
  }
  activeProcesses.delete(sessionId)
}

function rowToSession(row: AiSessionRow) {
  return {
    id: row.id,
    title: row.title,
    agent: row.agent,
    workspacePath: row.workspace_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    files: row.files ? row.files.split('\n').filter(Boolean) : []
  }
}

export function registerAiIpc(webContents: WebContents): void {
  const sendSessionStatus = (sessionId: string, status: AiSessionStatus) => {
    webContents.send('ai:sessionStatus', { sessionId, status })
  }

  ipcMain.handle('ai:verifyProvider', async (_event, provider: string) => {
    const cmd = provider === 'claude' ? 'claude' : provider === 'codex' ? 'codex' : null
    if (!cmd) return false

    try {
      const shellPath = getShellPath()
      const command = resolveProviderCommand(cmd, shellPath)
      const result = spawnSync(command, ['--version'], {
        env: { ...process.env, PATH: shellPath },
        shell: true,
        stdio: 'pipe',
        timeout: 5000
      })
      return result.status === 0
    } catch {
      return false
    }
  })

  ipcMain.handle('ai:getWarmStatus', () => ({ claude: 'ready', codex: 'ready' }))

  ipcMain.handle('ai:listSessions', () => {
    const rows = getDb().prepare(`
      SELECT s.id, s.title, s.agent, s.workspace_path, s.created_at, s.updated_at,
        GROUP_CONCAT(f.file_path, char(10)) AS files
      FROM ai_sessions s
      LEFT JOIN ai_session_files f ON f.session_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
      LIMIT 20
    `).all() as AiSessionRow[]
    return rows.map(rowToSession)
  })

  ipcMain.handle('ai:getSession', (_event, sessionId: string) => {
    const session = getDb().prepare(`
      SELECT s.id, s.title, s.agent, s.workspace_path, s.created_at, s.updated_at,
        GROUP_CONCAT(f.file_path, char(10)) AS files
      FROM ai_sessions s
      LEFT JOIN ai_session_files f ON f.session_id = s.id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(sessionId) as AiSessionRow | undefined
    if (!session) return null
    const messages = getDb().prepare(`
      SELECT id, role, content, agent, created_at AS createdAt
      FROM ai_messages
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(sessionId)
    return { ...rowToSession(session), messages, readOnly: true }
  })

  ipcMain.handle('ai:deleteSession', (_event, sessionId: string) => {
    stopSessionRuntime(sessionId)
    sendSessionStatus(sessionId, 'terminated')
    getDb().prepare('DELETE FROM ai_sessions WHERE id = ?').run(sessionId)
    return true
  })

  ipcMain.handle('ai:killSession', (_event, sessionId: string) => {
    stopSessionRuntime(sessionId)
    sendSessionStatus(sessionId, 'terminated')
    return true
  })

  ipcMain.handle('ai:startSession', (_event, payload: { sessionId: string; workspacePath: string; agentMode: AgentMode }) => {
    const agent = normalizeAgent(payload.agentMode)
    ensureSession(payload.sessionId, payload.workspacePath, agent, 'Nuova sessione')
    sendSessionStatus(payload.sessionId, 'active')
    return true
  })

  ipcMain.handle('ai:send', async (_event, payload: AiSendPayload) => {
    const {
      sessionId,
      requestId,
      workspacePath,
      system,
      messages,
      agentMode,
      explicitContext,
    } = payload
    const userMessage = [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''
    const agent = normalizeAgent(agentMode)
    ensureSession(sessionId, workspacePath, agent, userMessage)
    saveMessage(sessionId, 'user', userMessage, agent)
    for (const item of explicitContext ?? []) {
      saveTouchedFile(sessionId, workspacePath, item.path)
    }
    startFileWatcher(sessionId, workspacePath)

    const shellPath = getShellPath()
    const command = resolveProviderCommand(agent, shellPath)
    let fullPrompt = buildPrompt(system, messages, workspacePath, explicitContext)
    const invocation = getStatelessInvocation(agent)

    return new Promise<void>((resolve, reject) => {
      let assistantOutput = ''
      let stderrOutput = ''
      let settled = false
      const proc = spawn(command, invocation.args, {
        cwd: workspacePath,
        shell: true,
        env: { ...process.env, PATH: shellPath },
        stdio: ['pipe', 'pipe', 'pipe']
      })

      activeProcesses.set(sessionId, proc)
      sendSessionStatus(sessionId, 'processing')

      const cleanup = (kill: boolean) => {
        if (kill) killProcessTree(proc)
        activeProcesses.delete(sessionId)
        closeWatcher(sessionId)
        releaseProcessHandles(proc)
        fullPrompt = ''
        assistantOutput = ''
        stderrOutput = ''
      }

      const finishSuccess = () => {
        if (settled) return
        settled = true
        if (assistantOutput.trim()) saveMessage(sessionId, 'assistant', assistantOutput, agent)
        cleanup(false)
        sendSessionStatus(sessionId, 'active')
        webContents.send('ai:done', { sessionId, requestId })
        resolve()
      }

      const finishError = (error: string) => {
        if (settled) return
        settled = true
        cleanup(true)
        sendSessionStatus(sessionId, 'terminated')
        webContents.send('ai:error', { sessionId, requestId, error })
        reject(new Error(error))
      }

      proc.stdout?.on('data', (chunk) => {
        const text = chunk.toString()
        assistantOutput += text
        webContents.send('ai:chunk', { sessionId, requestId, chunk: text })
      })

      proc.stderr?.on('data', (chunk) => {
        stderrOutput += chunk.toString()
      })

      proc.on('error', (error) => {
        finishError(`Failed to spawn ${agent}: ${error.message}`)
      })

      proc.on('close', (code) => {
        if (explicitlyStoppedSessions.delete(sessionId)) {
          finishError('Sessione terminata')
          return
        }
        if (code === 0 || code === null) {
          finishSuccess()
          return
        }
        finishError(stderrOutput.trim() || `${agent} exited with code ${code}`)
      })

      if (invocation.useStdin) {
        proc.stdin?.write(fullPrompt)
        proc.stdin?.end()
        fullPrompt = ''
      }
    })
  })
}
