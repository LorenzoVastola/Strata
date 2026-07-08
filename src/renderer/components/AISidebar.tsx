import { AlertTriangle, Bot, Check, Clock3, Copy, Eraser, File, Folder, Loader2, Plus, Send, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'

type TextMessage = { id: string; role: 'user' | 'assistant'; content: string; agent?: 'claude' | 'codex'; createdAt?: string }
type PermissionMessage = { id: string; role: 'permission'; sessionId: string; requestId: string; text: string; diffs: AiPermissionDiff[]; answered?: 'approved' | 'rejected' }
type ChatMessage = TextMessage | PermissionMessage
type RuntimeSession = AiSessionSummary & { messages: ChatMessage[]; readOnly?: boolean; loading?: boolean; loadingStartedAt?: number; status?: AiSessionStatus }
type AiContext = Record<string, unknown>
type WarmStatus = 'warming' | 'ready' | 'failed'
type ContextAttachment = { path: string; relativePath: string; kind: 'file' | 'folder' }

type Props = {
  open: boolean
  width: number
  onWidthChange: (width: number) => void
  onClose: () => void
  workspacePath: string | null
  buildContext: () => Promise<AiContext>
  insertCode: (code: string) => void
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const newTitle = (message: string) => message.trim().replace(/\s+/g, ' ').split(' ').slice(0, 5).join(' ') || 'Nuova sessione'
const providerLabels: Record<'claude' | 'codex', string> = { claude: 'Claude', codex: 'Codex' }
const installLinks: Record<'claude' | 'codex', string> = {
  claude: 'https://docs.anthropic.com/en/docs/claude-code/setup',
  codex: 'https://help.openai.com/en/articles/11096431'
}

const commandPrompt = (value: string) => {
  if (value.startsWith('/explain')) return 'Explain the selected code or active file.'
  if (value.startsWith('/fix')) return 'Analyze Monaco/editor errors and propose fixes for the active file.'
  if (value.startsWith('/test')) return 'Generate unit tests for the active function or file.'
  if (value.startsWith('/commit')) return 'Suggest a concise commit message based on modified files.'
  if (value.startsWith('/query')) return 'Generate a SQL query based on the connected database schema.'
  if (value.startsWith('/request')) return 'Generate an HTTP request based on the current project context.'
  return value
}

const systemPrompt = (attachments: ContextAttachment[]) => `You are an AI assistant integrated in Strata, a developer IDE.
You have access to the current context of the developer's workspace.
Always respond in the same language the user writes in.
When writing code, use the same language/framework as the active file.
${attachments.length > 0
  ? `The user selected explicit file or folder context with @. That content is included below by the main process.`
  : 'No explicit file or folder context was selected; use the working directory as repository context.'}`

const relativeTime = (value: string) => {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'ora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min fa`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ore fa`
  const days = Math.floor(hours / 24)
  return `${days} giorni fa`
}

const parseBlocks = (content: string) => {
  const blocks: { type: 'text' | 'code'; value: string; language?: string }[] = []
  const regex = /```(\w+)?\n([\s\S]*?)```/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(content))) {
    if (match.index > last) blocks.push({ type: 'text', value: content.slice(last, match.index) })
    blocks.push({ type: 'code', language: match[1], value: match[2] })
    last = regex.lastIndex
  }
  if (last < content.length) blocks.push({ type: 'text', value: content.slice(last) })
  return blocks
}

const normalizePath = (value: string) => value.replace(/\\/g, '/')

const relativePathFromWorkspace = (workspacePath: string, targetPath: string) => {
  const root = normalizePath(workspacePath).replace(/\/$/, '')
  const target = normalizePath(targetPath)
  return target.startsWith(`${root}/`) ? target.slice(root.length + 1) : target
}

const getMentionQuery = (value: string, cursor: number) => {
  const beforeCursor = value.slice(0, cursor)
  const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/)
  return match ? match[1] : null
}

const removeMentionToken = (value: string, cursor: number) => {
  const beforeCursor = value.slice(0, cursor)
  const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/)
  if (!match || match.index === undefined) return value
  const prefix = value.slice(0, match.index)
  const suffix = value.slice(cursor)
  return `${prefix}${prefix && suffix ? ' ' : ''}${suffix}`.replace(/\s{2,}/g, ' ')
}

function AgentMark({ agent }: { agent: 'claude' | 'codex' }) {
  return <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">{agent === 'claude' ? 'Claude' : 'Codex'}</span>
}

function ThinkingIndicator({ agent }: { agent: 'claude' | 'codex' }) {
  return (
    <div className="inline-flex items-center gap-2 text-zinc-300">
      <span>{agent === 'codex' ? 'Codex' : 'Claude'} sta lavorando...</span>
      <span className="inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:300ms]" />
      </span>
    </div>
  )
}

function MessageBubble({ message, insertCode, isStreaming, isPending }: { message: TextMessage; insertCode: (code: string) => void; isStreaming?: boolean; isPending?: boolean }) {
  const [copied, setCopied] = useState('')
  return (
    <div className={`strata-ai-message flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] rounded-md px-3 py-2 text-sm ${message.role === 'user' ? 'bg-emerald-700 text-white' : 'bg-zinc-800 text-zinc-100'}`}>
        {isPending ? (
          <ThinkingIndicator agent={message.agent ?? 'claude'} />
        ) : (
          <>
            {parseBlocks(message.content).map((block, index) => block.type === 'text' ? (
              <div key={index} className="whitespace-pre-wrap leading-relaxed">{block.value}</div>
            ) : (
              <div key={index} className="my-2 overflow-hidden rounded border border-zinc-700 bg-zinc-950">
                <div className="flex items-center border-b border-zinc-800 px-2 py-1 text-[11px] text-zinc-500">
                  <span className="flex-1">{block.language ?? 'code'}</span>
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(block.value); setCopied(block.value); window.setTimeout(() => setCopied(''), 1500) }} className="rounded p-1 hover:bg-zinc-800">
                    {copied === block.value ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" onClick={() => insertCode(block.value)} className="ml-1 rounded px-2 py-1 hover:bg-zinc-800">Inserisci</button>
                </div>
                <pre className="max-h-80 overflow-auto p-3 text-xs text-zinc-200"><code>{block.value}</code></pre>
              </div>
            ))}
            {isStreaming && message.content && <span className="ml-0.5 animate-pulse text-emerald-300">{'\u258b'}</span>}
          </>
        )}
      </div>
    </div>
  )
}

function PermissionBox({ message, onRespond }: { message: PermissionMessage; onRespond: (messageId: string, sessionId: string, approved: boolean) => void }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-md border border-yellow-700/60 bg-yellow-950/20 p-3 text-sm text-zinc-100">
        <div className="mb-2 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-400" />
          <div className="whitespace-pre-wrap leading-relaxed">{message.text}</div>
        </div>
        {message.diffs.length > 0 && (
          <div className="mb-3 space-y-2">
            {message.diffs.map((diff) => (
              <div key={diff.file} className="overflow-hidden rounded border border-zinc-700 bg-zinc-950">
                <div className="border-b border-zinc-800 px-2 py-1 text-[11px] text-zinc-400">{diff.file}</div>
                <div className="max-h-40 overflow-auto px-2 py-1 font-mono text-[11px]">
                  {diff.removals.map((line, index) => <div key={`r-${index}`} className="whitespace-pre-wrap text-red-300">{line}</div>)}
                  {diff.additions.map((line, index) => <div key={`a-${index}`} className="whitespace-pre-wrap text-emerald-300">{line}</div>)}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" disabled={Boolean(message.answered)} onClick={() => onRespond(message.id, message.sessionId, true)} className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"><Check className="h-3.5 w-3.5" />Approva</button>
          <button type="button" disabled={Boolean(message.answered)} onClick={() => onRespond(message.id, message.sessionId, false)} className="inline-flex items-center gap-1 rounded bg-red-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"><X className="h-3.5 w-3.5" />Rifiuta</button>
          {message.answered && <span className="self-center text-xs text-zinc-400">{message.answered === 'approved' ? 'Approvato' : 'Rifiutato'}</span>}
        </div>
      </div>
    </div>
  )
}

function SessionStatusIndicator({ session }: { session: RuntimeSession }) {
  const status = session.status ?? (session.readOnly ? 'terminated' : session.loading ? 'processing' : 'active')
  if (status === 'processing') return <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
  const color = status === 'waiting-permission'
    ? 'bg-yellow-400'
    : status === 'terminated'
      ? 'bg-zinc-500'
      : 'bg-emerald-500'
  return <span className={`h-2 w-2 flex-shrink-0 rounded-full ${color}`} />
}

export default function AISidebar({ open, width, onWidthChange, onClose, workspacePath, buildContext, insertCode }: Props) {
  const [sessions, setSessions] = useState<RuntimeSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [recentSessions, setRecentSessions] = useState<AiSessionSummary[]>([])
  const [showRecent, setShowRecent] = useState(false)
  const [agentMode, setAgentMode] = useState<AiAgent>('auto')
  const [input, setInput] = useState('')
  const [badges, setBadges] = useState<string[]>([])
  const [contextOptions, setContextOptions] = useState<ContextAttachment[]>([])
  const [selectedContext, setSelectedContext] = useState<ContextAttachment[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [warmStatus, setWarmStatus] = useState<Record<'claude' | 'codex', WarmStatus>>({ claude: 'warming', codex: 'warming' })
  const [visibleReadyWarm, setVisibleReadyWarm] = useState<Partial<Record<'claude' | 'codex', boolean>>>({})
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const stickToBottomRef = useRef(true)
  const warmReadyTimers = useRef<Partial<Record<'claude' | 'codex', number>>>({})

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null
  const activeMessages = useMemo(() => activeSession?.messages ?? [], [activeSession])
  const textMessages = useMemo(() => activeMessages.filter((message): message is TextMessage => message.role === 'user' || message.role === 'assistant'), [activeMessages])

  const refreshRecent = useCallback(async () => {
    const items = await window.api.ai.listSessions()
    setRecentSessions(items)
  }, [])

  const createSession = useCallback(() => {
    if (!workspacePath) return null
    const id = uid()
    const timestamp = new Date().toISOString()
    const session: RuntimeSession = {
      id,
      title: `Sessione ${sessions.length + 1}`,
      agent: agentMode === 'auto' ? 'claude' : agentMode,
      workspacePath,
      createdAt: timestamp,
      updatedAt: timestamp,
      files: [],
      messages: [],
      status: 'active'
    }
    setSessions((prev) => [...prev, session])
    setActiveSessionId(id)
    void window.api.ai.startSession({ sessionId: id, workspacePath, agentMode })
    return id
  }, [agentMode, sessions.length, workspacePath])

  useEffect(() => {
    if (!open) return
    void refreshRecent()
    void buildContext().then((context) => setBadges(extractBadges(context)))
  }, [open, buildContext, refreshRecent])

  useEffect(() => {
    if (!open || !workspacePath) {
      setContextOptions([])
      setSelectedContext([])
      return
    }

    let cancelled = false
    const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'dist-electron', 'release', 'out', '.next', '.vite'])

    const loadOptions = async () => {
      const options = new Map<string, ContextAttachment>()
      const visit = async (dirPath: string) => {
        const entries = await window.api.readDir(dirPath)
        for (const entry of entries) {
          const relativePath = relativePathFromWorkspace(workspacePath, entry.path)
          if (entry.isDirectory) {
            if (ignoredDirs.has(entry.name)) continue
            options.set(entry.path, { path: entry.path, relativePath, kind: 'folder' })
            await visit(entry.path)
          } else {
            options.set(entry.path, { path: entry.path, relativePath, kind: 'file' })
          }
        }
      }

      try {
        await visit(workspacePath)
        if (!cancelled) {
          setContextOptions([...options.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath)))
        }
      } catch {
        if (!cancelled) setContextOptions([])
      }
    }

    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [open, workspacePath])

  useEffect(() => {
    const setProviderStatus = (provider: 'claude' | 'codex', status: WarmStatus) => {
      if (warmReadyTimers.current[provider]) {
        window.clearTimeout(warmReadyTimers.current[provider])
        delete warmReadyTimers.current[provider]
      }
      setWarmStatus((prev) => ({ ...prev, [provider]: status }))
      setVisibleReadyWarm((prev) => ({ ...prev, [provider]: status === 'ready' }))
      if (status === 'ready') {
        warmReadyTimers.current[provider] = window.setTimeout(() => {
          setVisibleReadyWarm((prev) => ({ ...prev, [provider]: false }))
          delete warmReadyTimers.current[provider]
        }, 2000)
      }
    }

    void window.api.ai.getWarmStatus().then((status) => {
      setWarmStatus(status)
      for (const provider of ['claude', 'codex'] as const) {
        if (status[provider] === 'ready') {
          setVisibleReadyWarm((prev) => ({ ...prev, [provider]: true }))
          warmReadyTimers.current[provider] = window.setTimeout(() => {
            setVisibleReadyWarm((prev) => ({ ...prev, [provider]: false }))
            delete warmReadyTimers.current[provider]
          }, 2000)
        }
      }
    })

    const offStarting = window.api.ai.onWarmStarting(({ provider }) => setProviderStatus(provider, 'warming'))
    const offReady = window.api.ai.onWarmReady(({ provider }) => setProviderStatus(provider, 'ready'))
    const offFailed = window.api.ai.onWarmFailed(({ provider }) => setProviderStatus(provider, 'failed'))

    return () => {
      offStarting()
      offReady()
      offFailed()
      for (const timer of Object.values(warmReadyTimers.current)) {
        if (timer) window.clearTimeout(timer)
      }
      warmReadyTimers.current = {}
    }
  }, [])

  useEffect(() => {
    const offChunk = window.api.ai.onChunk(({ sessionId, chunk }) => {
      setSessions((prev) => prev.map((session) => session.id === sessionId ? {
        ...session,
        messages: session.messages.map((message) => message.id === sessionId && message.role === 'assistant'
          ? { ...message, content: message.content + chunk }
          : message)
      } : session))
    })
    const offPermission = window.api.ai.onPermission(({ sessionId, requestId, text, diffs }) => {
      setSessions((prev) => prev.map((session) => session.id === sessionId ? {
        ...session,
        status: 'waiting-permission',
        messages: [...session.messages, { id: uid(), role: 'permission', sessionId, requestId, text, diffs }]
      } : session))
    })
    const offSessionStatus = window.api.ai.onSessionStatus(({ sessionId, status }) => {
      setSessions((prev) => prev.map((session) => session.id === sessionId ? {
        ...session,
        status,
        loading: status === 'processing',
        loadingStartedAt: status === 'processing' ? (session.loadingStartedAt ?? Date.now()) : undefined
      } : session))
    })
    const offDone = window.api.ai.onDone(({ sessionId }) => {
      setSessions((prev) => prev.map((session) => session.id === sessionId ? { ...session, loading: false, loadingStartedAt: undefined, status: 'active', updatedAt: new Date().toISOString() } : session))
      void refreshRecent()
    })
    const offError = window.api.ai.onError(({ sessionId, error }) => {
      setSessions((prev) => prev.map((session) => session.id === sessionId ? {
        ...session,
        loading: false,
        loadingStartedAt: undefined,
        status: 'terminated',
        messages: session.messages.map((message) => message.id === sessionId && message.role === 'assistant' ? { ...message, content: `${message.content}\n\nErrore: ${error}` } : message)
      } : session))
    })
    return () => { offChunk(); offPermission(); offSessionStatus(); offDone(); offError() }
  }, [refreshRecent])

  useEffect(() => {
    if (!stickToBottomRef.current) return
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [activeMessages])

  useEffect(() => {
    stickToBottomRef.current = true
    window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    })
  }, [activeSessionId])

  const requiredWarmProviders = useMemo(() => agentMode === 'auto' ? (['claude', 'codex'] as const) : ([agentMode] as const), [agentMode])
  const blockingWarmProvider = requiredWarmProviders.find((provider) => warmStatus[provider] !== 'ready')
  const warmBannerProvider = (requiredWarmProviders.find((provider) => warmStatus[provider] === 'warming')
    ?? requiredWarmProviders.find((provider) => warmStatus[provider] === 'failed')
    ?? requiredWarmProviders.find((provider) => warmStatus[provider] === 'ready' && visibleReadyWarm[provider])) as 'claude' | 'codex' | undefined
  const warmBannerStatus = warmBannerProvider ? warmStatus[warmBannerProvider] : null
  const warmBlocking = Boolean(blockingWarmProvider)
  const hasActiveRuntimeSession = Boolean(activeSession && !activeSession.readOnly && activeSession.status !== 'terminated')

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || !workspacePath || activeSession?.loading || activeSession?.readOnly || (!hasActiveRuntimeSession && warmBlocking)) return

    const sessionId = activeSessionId ?? createSession()
    if (!sessionId) return

    let explicitContext: ContextAttachment[] = selectedContext
    const userContent = commandPrompt(text)
    const userMessage: TextMessage = { id: uid(), role: 'user', content: text }
    const assistantAgent = activeSession?.agent === 'codex' ? 'codex' : 'claude'
    const assistantMessage: TextMessage = { id: sessionId, role: 'assistant', content: '', agent: assistantAgent }
    const title = textMessages.length === 0 ? newTitle(text) : activeSession?.title ?? newTitle(text)

    stickToBottomRef.current = true
    setInput('')
    setMentionQuery(null)
    setSessions((prev) => prev.map((session) => session.id === sessionId ? {
      ...session,
      title,
      loading: true,
      loadingStartedAt: Date.now(),
      status: 'processing',
      messages: [...session.messages, userMessage, assistantMessage]
    } : session))

    const context = await buildContext()
    setBadges(extractBadges(context))

    let history: { role: AiMessageRole; content: string }[] = [...textMessages, { ...userMessage, content: userContent }].map(({ role, content }) => ({ role, content }))
    try {
      await window.api.ai.send({
        sessionId,
        requestId: sessionId,
        workspacePath,
        system: systemPrompt(explicitContext),
        messages: history,
        agentMode,
        explicitContext
      })
    } catch (error) {
      setSessions((prev) => prev.map((session) => session.id === sessionId ? {
        ...session,
        loading: false,
        loadingStartedAt: undefined,
        status: 'terminated',
        messages: session.messages.map((message) => message.id === sessionId && message.role === 'assistant' ? { ...message, content: `${message.content}\n\n${error instanceof Error ? error.message : String(error)}` } : message)
      } : session))
    } finally {
      history = []
      explicitContext = []
      setSessions((prev) => prev.map((session) => session.id === sessionId ? {
        ...session,
        loading: false,
        loadingStartedAt: undefined
      } : session))
    }
  }, [activeSession, activeSessionId, agentMode, buildContext, createSession, hasActiveRuntimeSession, input, selectedContext, textMessages, warmBlocking, workspacePath])

  const closeSession = async (sessionId: string) => {
    await window.api.ai.killSession(sessionId)
    setSessions((prev) => prev.filter((session) => session.id !== sessionId))
    if (activeSessionId === sessionId) {
      const next = sessions.find((session) => session.id !== sessionId)
      setActiveSessionId(next?.id ?? null)
    }
  }

  const openSavedSession = async (sessionId: string) => {
    const saved = await window.api.ai.getSession(sessionId)
    if (!saved) return
    const session: RuntimeSession = {
      ...saved,
      messages: saved.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        agent: message.agent,
        createdAt: message.createdAt
      })),
      readOnly: true,
      status: 'terminated'
    }
    setSessions((prev) => [...prev.filter((item) => item.id !== session.id), session])
    setActiveSessionId(session.id)
    setShowRecent(false)
  }

  const deleteSavedSession = async (event: ReactMouseEvent, sessionId: string) => {
    event.preventDefault()
    await window.api.ai.deleteSession(sessionId)
    setSessions((prev) => prev.filter((session) => session.id !== sessionId))
    await refreshRecent()
  }

  const respondPermission = async (messageId: string, sessionId: string, approved: boolean) => {
    setSessions((prev) => prev.map((session) => session.id === sessionId ? {
      ...session,
      status: 'processing',
      messages: session.messages.map((message) => message.id === messageId && message.role === 'permission' ? { ...message, answered: approved ? 'approved' : 'rejected' } : message)
    } : session))
    await window.api.ai.respondPermission({ sessionId, approved })
  }

  const startResize = (event: ReactMouseEvent) => {
    event.preventDefault()
    const onMove = (moveEvent: MouseEvent) => onWidthChange(Math.min(720, Math.max(320, window.innerWidth - moveEvent.clientX)))
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const mentionResults = useMemo(() => {
    if (mentionQuery === null) return []
    const query = mentionQuery.toLowerCase()
    return contextOptions
      .filter((item) => !selectedContext.some((selected) => selected.path === item.path))
      .filter((item) => item.relativePath.toLowerCase().includes(query))
      .slice(0, 8)
  }, [contextOptions, mentionQuery, selectedContext])

  const updateMentionQuery = (value: string, cursor: number) => {
    setMentionQuery(getMentionQuery(value, cursor))
    setMentionIndex(0)
  }

  const selectContextAttachment = (attachment: ContextAttachment) => {
    setSelectedContext((prev) => prev.some((item) => item.path === attachment.path) ? prev : [...prev, attachment])
    const textarea = inputRef.current
    const cursor = textarea?.selectionStart ?? input.length
    const nextInput = removeMentionToken(input, cursor)
    setInput(nextInput)
    setMentionQuery(null)
    window.requestAnimationFrame(() => textarea?.focus())
  }

  const removeContextAttachment = (path: string) => {
    setSelectedContext((prev) => prev.filter((item) => item.path !== path))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionResults.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionIndex((prev) => Math.min(prev + 1, mentionResults.length - 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex((prev) => Math.max(prev - 1, 0))
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        selectContextAttachment(mentionResults[mentionIndex])
        return
      }
      if (event.key === 'Escape') {
        setMentionQuery(null)
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const onScrollMessages = () => {
    const element = scrollRef.current
    if (!element) return
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    stickToBottomRef.current = distanceFromBottom < 64
  }

  const filesPreview = useMemo(() => activeSession?.files.slice(0, 3) ?? [], [activeSession])
  console.log('[send-gate]', {
    noText: !input.trim(),
    noWorkspace: !workspacePath,
    loading: activeSession?.loading,
    readOnly: activeSession?.readOnly,
    hasActiveRuntimeSession,
    warmBlocking,
  })
  const inputDisabled = Boolean(activeSession?.readOnly || activeSession?.loading || (!hasActiveRuntimeSession && warmBlocking))
  const inputPlaceholder = activeSession?.readOnly
    ? 'Sessione recente in sola lettura'
    : !hasActiveRuntimeSession && warmBlocking
      ? 'Attendere inizializzazione...'
      : 'Ask anything...'

  if (!open) return null

  return (
    <aside className="absolute right-0 top-0 z-40 flex h-full flex-col border-l border-zinc-800 bg-zinc-900 shadow-2xl" style={{ width, background: 'var(--strata-sidebar)', borderColor: 'var(--strata-border)' }}>
      <style>{`
        @keyframes strata-ai-message-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .strata-ai-message {
          animation: strata-ai-message-in 150ms ease-out both;
        }
      `}</style>
      <div onMouseDown={startResize} className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-emerald-500/60" />

      <div className="relative flex h-12 items-center gap-2 border-b border-zinc-800 px-2" style={{ borderColor: 'var(--strata-border)' }}>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {sessions.map((session) => (
            <button key={session.id} type="button" onClick={() => setActiveSessionId(session.id)} className={`group inline-flex max-w-40 flex-shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs ${session.id === activeSessionId ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}`}>
              <SessionStatusIndicator session={session} />
              <span className="truncate">{session.title}</span>
              <span onClick={(event) => { event.stopPropagation(); void closeSession(session.id) }} className="rounded p-0.5 opacity-60 hover:bg-zinc-700 group-hover:opacity-100"><X className="h-3 w-3" /></span>
            </button>
          ))}
        </div>
        <button type="button" title="Nuova sessione" onClick={() => createSession()} className="rounded p-1.5 text-zinc-300 hover:bg-zinc-800"><Plus className="h-4 w-4" /></button>
        <button type="button" title="Sessioni recenti" onClick={() => { setShowRecent((value) => !value); void refreshRecent() }} className="rounded p-1.5 text-zinc-300 hover:bg-zinc-800"><Clock3 className="h-4 w-4" /></button>
        <button type="button" title="Pulisci sessione" onClick={() => activeSessionId && setSessions((prev) => prev.map((session) => session.id === activeSessionId ? { ...session, messages: [] } : session))} className="rounded p-1.5 text-zinc-300 hover:bg-zinc-800"><Eraser className="h-4 w-4" /></button>
        <button type="button" onClick={onClose} className="rounded p-1.5 text-zinc-300 hover:bg-zinc-800"><X className="h-4 w-4" /></button>
      </div>

      {showRecent && (
        <div className="absolute right-0 top-12 z-50 h-[calc(100%-3rem)] w-full max-w-sm border-l border-zinc-800 bg-zinc-900 shadow-2xl">
          <div className="flex h-10 items-center justify-between border-b border-zinc-800 px-3">
            <span className="text-sm font-medium text-zinc-100">Sessioni recenti</span>
            <button type="button" onClick={() => setShowRecent(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800"><X className="h-4 w-4" /></button>
          </div>
          <div className="h-[calc(100%-2.5rem)] overflow-auto p-2">
            {recentSessions.map((session) => (
              <button key={session.id} type="button" onClick={() => void openSavedSession(session.id)} onContextMenu={(event) => void deleteSavedSession(event, session.id)} className="mb-1 block w-full rounded-md px-3 py-2 text-left hover:bg-zinc-800">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">{session.title}</span>
                  <AgentMark agent={session.agent} />
                </div>
                <div className="mt-1 text-xs text-zinc-500">{relativeTime(session.updatedAt)}</div>
                {session.files.length > 0 && (
                  <div className="mt-1 text-[11px] text-zinc-400">
                    {session.files.slice(0, 3).join(', ')}
                    {session.files.length > 3 ? ` e altri ${session.files.length - 3}` : ''}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={scrollRef} onScroll={onScrollMessages} className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {!activeSession
          ? <div className="mt-8 text-center text-sm text-zinc-500">Crea una sessione o scrivi un messaggio per iniziare.</div>
          : activeMessages.length === 0
            ? <div className="mt-8 text-center text-sm text-zinc-500">{activeSession.readOnly ? 'Sessione salvata senza messaggi.' : 'Chiedi qualcosa sul workspace corrente.'}</div>
            : activeMessages.map((message) => message.role === 'permission'
              ? <PermissionBox key={message.id} message={message} onRespond={respondPermission} />
              : <MessageBubble
                  key={message.id}
                  message={message}
                  insertCode={insertCode}
                  isPending={message.role === 'assistant' && Boolean(activeSession.loading) && !message.content}
                  isStreaming={message.role === 'assistant' && Boolean(activeSession.loading) && Boolean(message.content)}
                />)
        }
      </div>

      <div className="border-t border-zinc-800 p-3" style={{ borderColor: 'var(--strata-border)' }}>
        {(badges.length > 0 || filesPreview.length > 0 || selectedContext.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1">
            {selectedContext.map((item) => (
              <button
                key={item.path}
                type="button"
                title={item.relativePath}
                onClick={() => removeContextAttachment(item.path)}
                className="inline-flex max-w-full items-center gap-1 rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-900"
              >
                {item.kind === 'folder' ? <Folder className="h-3 w-3 shrink-0" /> : <File className="h-3 w-3 shrink-0" />}
                <span className="truncate">{item.relativePath}</span>
                <X className="h-3 w-3 shrink-0" />
              </button>
            ))}
            {[...badges, ...filesPreview].slice(0, 5).map((badge) => <span key={badge} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{badge}</span>)}
          </div>
        )}
        <div className="mb-2 grid grid-cols-3 rounded-md bg-zinc-950 p-1">
          {(['auto', 'claude', 'codex'] as AiAgent[]).map((mode) => (
            <button key={mode} type="button" onClick={() => setAgentMode(mode)} className={`rounded px-2 py-1.5 text-xs font-medium capitalize ${agentMode === mode ? 'bg-emerald-700 text-white' : 'text-zinc-400 hover:text-zinc-100'}`}>{mode}</button>
          ))}
        </div>
        {warmBannerProvider && warmBannerStatus !== null && (
          <div className={`mb-2 flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs ${
            warmBannerStatus === 'ready'
              ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300'
              : warmBannerStatus === 'failed'
                ? 'border-yellow-700/60 bg-yellow-950/20 text-yellow-200'
                : 'border-zinc-700 bg-zinc-950 text-zinc-300'
          }`}>
            {warmBannerStatus === 'warming' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {warmBannerStatus === 'ready' && <Check className="h-3.5 w-3.5" />}
            {warmBannerStatus === 'failed' && <AlertTriangle className="h-3.5 w-3.5" />}
            <span className="min-w-0 flex-1 truncate">
              {warmBannerStatus === 'warming' && `Inizializzazione ${providerLabels[warmBannerProvider]}...`}
              {warmBannerStatus === 'ready' && `${providerLabels[warmBannerProvider]} pronto`}
              {warmBannerStatus === 'failed' && `${providerLabels[warmBannerProvider]} non trovato`}
            </span>
            {warmBannerStatus === 'failed' && (
              <a href={installLinks[warmBannerProvider]} target="_blank" rel="noreferrer" className="flex-shrink-0 text-yellow-100 underline underline-offset-2">
                installa
              </a>
            )}
          </div>
        )}
        <div className="relative flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => {
              setInput(event.target.value)
              updateMentionQuery(event.target.value, event.target.selectionStart)
            }}
            onClick={(event) => updateMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
            onKeyUp={(event) => updateMentionQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            rows={3}
            disabled={inputDisabled}
            placeholder={inputPlaceholder}
            className="min-h-16 flex-1 resize-none rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-600 disabled:opacity-60"
          />
          <button type="button" onClick={() => void send()} disabled={!input.trim() || inputDisabled} className="self-end rounded bg-emerald-700 p-2 text-white hover:bg-emerald-600 disabled:opacity-40">
            {activeSession?.loading ? <Bot className="h-4 w-4 animate-pulse" /> : <Send className="h-4 w-4" />}
          </button>
          {mentionQuery !== null && !inputDisabled && (
            <div className="absolute bottom-full left-0 z-50 mb-2 max-h-64 w-[calc(100%-3rem)] overflow-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
              {mentionResults.length > 0 ? mentionResults.map((item, index) => (
                <button
                  key={item.path}
                  type="button"
                  title={item.path}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    selectContextAttachment(item)
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
                    index === mentionIndex ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                  }`}
                >
                  {item.kind === 'folder' ? <Folder className="h-3.5 w-3.5 shrink-0 text-sky-300" /> : <File className="h-3.5 w-3.5 shrink-0 text-zinc-400" />}
                  <span className="min-w-0 flex-1 truncate">{item.relativePath}</span>
                </button>
              )) : (
                <div className="px-3 py-2 text-xs text-zinc-500">No matching files or folders</div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

function extractBadges(context: AiContext) {
  const badges: string[] = []
  const activeFile = (context.activeFile ?? null) as { path?: string } | null
  const db = (context.activeDatabase ?? null) as { name?: string } | null
  const request = (context.activeRequest ?? null) as { method?: string; url?: string } | null
  if (activeFile?.path) badges.push(activeFile.path.split(/[\\/]/).pop() ?? activeFile.path)
  if (db?.name) badges.push(db.name)
  if (request?.method && request?.url) badges.push(`${request.method} ${request.url.replace(/^https?:\/\/[^/]+/, '')}`)
  return badges.slice(0, 5)
}
