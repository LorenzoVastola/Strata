import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight,
  GitBranch, Minus, Plus, RefreshCw, RotateCcw,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiffOpenRequest = {
  path: string
  title: string
  language: string
  original: string
  modified: string
  filePath?: string
}

interface Props {
  workspacePath: string
  onOpenDiff: (req: DiffOpenRequest) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', html: 'html', css: 'css', scss: 'scss', less: 'less',
    md: 'markdown', py: 'python', rs: 'rust', go: 'go', java: 'java',
    cpp: 'cpp', c: 'c', cs: 'csharp', sh: 'shell', bash: 'shell',
    yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql', rb: 'ruby',
    php: 'php', swift: 'swift', kt: 'kotlin', dart: 'dart',
    vue: 'html', svelte: 'html', toml: 'ini',
  }
  return map[ext] ?? 'plaintext'
}

function statusLabel(s: string) {
  if (s === 'M') return 'M'
  if (s === 'A') return 'A'
  if (s === 'D') return 'D'
  if (s === 'R') return 'R'
  if (s === 'U') return 'U'
  if (s === '?') return 'U'
  return s
}

function statusColor(s: string) {
  if (s === 'A') return 'text-green-400'
  if (s === 'D') return 'text-red-400'
  if (s === 'R') return 'text-purple-400'
  if (s === 'U' || s === '?') return 'text-teal-400'
  return 'text-amber-400'
}

function relativeDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = Date.now()
  const diff = Math.floor((now - d.getTime()) / 1000)
  if (diff < 60) return `${diff}s fa`
  if (diff < 3600) return `${Math.floor(diff / 60)}m fa`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`
  if (diff < 604800) return `${Math.floor(diff / 86400)}g fa`
  return d.toLocaleDateString()
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function GitPanel({ workspacePath, onOpenDiff }: Props) {
  // Status
  const [staged, setStaged] = useState<GitFileItem[]>([])
  const [unstaged, setUnstaged] = useState<GitFileItem[]>([])
  const [ahead, setAhead] = useState(0)
  const [behind, setBehind] = useState(0)

  // Branch
  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState<GitBranchItem[]>([])
  const [branchOpen, setBranchOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [showNewBranch, setShowNewBranch] = useState(false)

  // Commit
  const [commitMessage, setCommitMessage] = useState('')

  // History
  const [log, setLog] = useState<GitCommit[]>([])
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[]>([])
  const [loadingCommitFiles, setLoadingCommitFiles] = useState(false)

  // Sidebar resize
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const sidebarPreviewRef = useRef<number | null>(null)
  const [sidebarPreviewWidth, setSidebarPreviewWidth] = useState<number | null>(null)

  // ── Data loading ──────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (!workspacePath) return
    try {
      const status = await window.api.git.status(workspacePath)
      setStaged(status.staged)
      setUnstaged(status.unstaged)
      setAhead(status.ahead)
      setBehind(status.behind)
      setBranch(status.current)
    } catch (err) {
      console.error('git status failed', err)
    }
    try {
      const branchList = await window.api.git.getBranches(workspacePath)
      setBranches(branchList)
    } catch {
      // Ignore branch refresh failures; status errors are already surfaced above.
    }
    try {
      const commits = await window.api.git.getLog(workspacePath)
      setLog(commits)
    } catch {
      // Ignore history refresh failures; the panel can still show current status.
    }
  }, [workspacePath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleStage = async (filePath: string) => {
    await window.api.git.stage(workspacePath, filePath)
    void refresh()
  }

  const handleUnstage = async (filePath: string) => {
    await window.api.git.unstage(workspacePath, filePath)
    void refresh()
  }

  const handleStageAll = async () => {
    await window.api.git.stageAll(workspacePath)
    void refresh()
  }

  const handleDiscard = async (filePath: string, isUntracked: boolean) => {
    await window.api.git.discardFile(workspacePath, filePath, isUntracked)
    void refresh()
  }

  const handleCommit = async () => {
    const msg = commitMessage.trim()
    if (!msg || staged.length === 0) return
    await window.api.git.commit(workspacePath, msg)
    setCommitMessage('')
    void refresh()
  }

  const handlePull = async () => {
    await window.api.git.pull(workspacePath)
    void refresh()
  }

  const handlePush = async () => {
    await window.api.git.push(workspacePath)
    void refresh()
  }

  const handleCheckout = async (branchName: string) => {
    await window.api.git.checkoutBranch(workspacePath, branchName)
    setBranchOpen(false)
    void refresh()
  }

  const handleCreateBranch = async () => {
    const name = newBranchName.trim()
    if (!name) return
    await window.api.git.createBranch(workspacePath, name)
    setNewBranchName('')
    setShowNewBranch(false)
    void refresh()
  }

  // ── Diff open helpers ─────────────────────────────────────────────────────

  const openFileDiff = async (file: GitFileItem, isStaged: boolean) => {
    try {
      const diff = await window.api.git.getDiff(workspacePath, file.path, isStaged)
      const fileName = file.path.split(/[\\/]/).pop() ?? file.path
      onOpenDiff({
        path: `git-diff:${isStaged ? 'staged' : 'unstaged'}:${file.path}`,
        title: `${fileName} ← ${isStaged ? 'staged' : 'modified'}`,
        language: getLanguage(file.path),
        original: diff.original,
        modified: diff.modified,
        filePath: file.path,
      })
    } catch (err) {
      console.error('getDiff failed', err)
    }
  }

  const openCommitFileDiff = async (commit: GitCommit, file: GitCommitFile) => {
    try {
      const diff = await window.api.git.getCommitFileDiff(workspacePath, commit.hash, file.path)
      const fileName = file.path.split(/[\\/]/).pop() ?? file.path
      onOpenDiff({
        path: `git-diff:commit:${commit.shortHash}:${file.path}`,
        title: `${fileName} @ ${commit.shortHash}`,
        language: getLanguage(file.path),
        original: diff.original,
        modified: diff.modified,
        filePath: file.path,
      })
    } catch (err) {
      console.error('getCommitFileDiff failed', err)
    }
  }

  const toggleCommit = async (commit: GitCommit) => {
    if (expandedCommit === commit.hash) {
      setExpandedCommit(null)
      setCommitFiles([])
      return
    }
    setExpandedCommit(commit.hash)
    setCommitFiles([])
    setLoadingCommitFiles(true)
    try {
      const files = await window.api.git.getCommitFiles(workspacePath, commit.hash)
      setCommitFiles(files)
    } catch {
      setCommitFiles([])
    } finally {
      setLoadingCommitFiles(false)
    }
  }

  // ── Sidebar resize ────────────────────────────────────────────────────────

  const resizeSidebar = (startX: number) => {
    const startWidth = sidebarWidth
    const onMove = (e: MouseEvent) => {
      const next = Math.max(180, Math.min(520, startWidth + e.clientX - startX))
      setSidebarPreviewWidth(next)
      sidebarPreviewRef.current = next
    }
    const onUp = () => {
      if (sidebarPreviewRef.current !== null) setSidebarWidth(sidebarPreviewRef.current)
      setSidebarPreviewWidth(null)
      sidebarPreviewRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex h-full" style={{ width: sidebarWidth }}>
      {/* preview line */}
      {sidebarPreviewWidth !== null && (
        <div
          className="pointer-events-none absolute bottom-0 top-0 z-50 w-px bg-sky-500"
          style={{ left: sidebarPreviewWidth }}
        />
      )}

      {/* sidebar */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-r border-zinc-800 bg-zinc-900" style={{ background: 'var(--strata-sidebar)', borderColor: 'var(--strata-border)', color: 'var(--strata-text)' }}>

        {/* ── Branch row ── */}
        <div className="relative flex shrink-0 items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <button
            type="button"
            onClick={() => setBranchOpen((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1 truncate rounded px-1 py-0.5 text-xs text-zinc-200 hover:bg-zinc-700"
          >
            <span className="truncate">{branch || '—'}</span>
            <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
          </button>
          {(ahead > 0 || behind > 0) && (
            <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-zinc-400">
              {behind > 0 && <><ArrowDown className="h-3 w-3" />{behind}</>}
              {ahead > 0 && <><ArrowUp className="h-3 w-3" />{ahead}</>}
            </span>
          )}
          <button type="button" onClick={() => void handlePull()} title="Pull" className="rounded p-0.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => void handlePush()} title="Push" className="rounded p-0.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => void refresh()} title="Aggiorna" className="rounded p-0.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>

          {/* branch dropdown */}
          {branchOpen && (
            <div className="absolute left-0 top-full z-50 w-full overflow-hidden rounded-b border border-zinc-700 bg-zinc-900 shadow-xl">
              <div className="max-h-48 overflow-y-auto">
                {branches.map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() => void handleCheckout(b.name)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${b.current ? 'text-sky-400' : b.remote ? 'text-zinc-500' : 'text-zinc-200'}`}
                  >
                    <GitBranch className="h-3 w-3 shrink-0" />
                    <span className="truncate">{b.name}</span>
                    {b.current && <span className="ml-auto shrink-0 text-[10px] text-sky-500">✓</span>}
                  </button>
                ))}
              </div>
              <div className="border-t border-zinc-800 p-1.5">
                {showNewBranch ? (
                  <div className="flex gap-1">
                    <input
                      autoFocus
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateBranch(); if (e.key === 'Escape') setShowNewBranch(false) }}
                      placeholder="nome-branch"
                      className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none"
                    />
                    <button type="button" onClick={() => void handleCreateBranch()} className="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500">Crea</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowNewBranch(true)} className="flex w-full items-center gap-1 px-1 py-0.5 text-xs text-zinc-400 hover:text-zinc-100">
                    <Plus className="h-3 w-3" /> Nuovo branch
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Commit input ── */}
        <div className="shrink-0 border-b border-zinc-800 p-2">
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Messaggio commit…"
            rows={2}
            className="w-full resize-none rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-sky-600"
          />
          <button
            type="button"
            disabled={!commitMessage.trim() || staged.length === 0}
            onClick={() => void handleCommit()}
            className="mt-1 w-full rounded bg-sky-700 py-1 text-xs text-white transition hover:bg-sky-600 disabled:opacity-40"
          >
            Commit ({staged.length})
          </button>
        </div>

        {/* ── Staged ── */}
        <div className="shrink-0 border-b border-zinc-800">
          <div className="flex items-center gap-1 px-2 py-1">
            <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Staged ({staged.length})</span>
          </div>
          {staged.length > 0 && (
            <div className="max-h-[150px] overflow-y-auto">
              {staged.map((file) => (
                <div key={file.path} className="group flex items-center gap-1 px-2 py-0.5 hover:bg-zinc-800">
                  <span className={`w-3.5 shrink-0 text-[10px] font-bold ${statusColor(file.status)}`}>{statusLabel(file.status)}</span>
                  <button
                    type="button"
                    onClick={() => void openFileDiff(file, true)}
                    className="min-w-0 flex-1 truncate text-left text-xs text-zinc-300 hover:text-zinc-100"
                  >
                    {file.path.split(/[\\/]/).pop()}
                  </button>
                  <button
                    type="button"
                    title="Rimuovi dallo stage"
                    onClick={() => void handleUnstage(file.path)}
                    className="shrink-0 rounded p-0.5 text-zinc-500 opacity-0 transition hover:bg-zinc-700 hover:text-zinc-100 group-hover:opacity-100"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Changes ── */}
        <div className="shrink-0 border-b border-zinc-800">
          <div className="flex items-center gap-1 px-2 py-1">
            <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Modifiche ({unstaged.length})</span>
            {unstaged.length > 0 && (
              <button type="button" title="Aggiungi tutto" onClick={() => void handleStageAll()} className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100">
                <Plus className="h-3 w-3" />
              </button>
            )}
          </div>
          {unstaged.length > 0 && (
            <div className="max-h-[200px] overflow-y-auto">
              {unstaged.map((file) => (
                <div key={file.path} className="group flex items-center gap-1 px-2 py-0.5 hover:bg-zinc-800">
                  <span className={`w-3.5 shrink-0 text-[10px] font-bold ${statusColor(file.status)}`}>{statusLabel(file.status)}</span>
                  <button
                    type="button"
                    onClick={() => void openFileDiff(file, false)}
                    className="min-w-0 flex-1 truncate text-left text-xs text-zinc-300 hover:text-zinc-100"
                  >
                    {file.path.split(/[\\/]/).pop()}
                  </button>
                  <button
                    type="button"
                    title="Stage"
                    onClick={() => void handleStage(file.path)}
                    className="shrink-0 rounded p-0.5 text-zinc-500 opacity-0 transition hover:bg-zinc-700 hover:text-zinc-100 group-hover:opacity-100"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    title="Scarta modifiche"
                    onClick={() => void handleDiscard(file.path, file.status === 'U')}
                    className="shrink-0 rounded p-0.5 text-zinc-500 opacity-0 transition hover:bg-zinc-700 hover:text-red-400 group-hover:opacity-100"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── History ── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 px-2 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Cronologia</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {log.map((commit) => {
              const isExpanded = expandedCommit === commit.hash
              return (
                <div key={commit.hash}>
                  <button
                    type="button"
                    onClick={() => void toggleCommit(commit)}
                    className="group flex w-full items-start gap-1.5 px-2 py-1.5 text-left hover:bg-zinc-800"
                  >
                    {isExpanded
                      ? <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" />
                      : <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" />
                    }
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] text-sky-500">{commit.shortHash}</span>
                        {commit.refs && (
                          <span className="max-w-[80px] truncate rounded bg-zinc-700 px-1 py-0.5 text-[9px] text-zinc-300">{commit.refs.replace('HEAD -> ', '')}</span>
                        )}
                        <span className="ml-auto shrink-0 text-[10px] text-zinc-500">{relativeDate(commit.date)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-zinc-300">{commit.message}</div>
                      <div className="text-[10px] text-zinc-500">{commit.author}</div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-b border-zinc-800 bg-zinc-950 pb-1">
                      {loadingCommitFiles ? (
                        <p className="px-8 py-1 text-[10px] text-zinc-500">Caricamento…</p>
                      ) : (
                        commitFiles.map((f) => (
                          <button
                            key={f.path}
                            type="button"
                            onClick={() => void openCommitFileDiff(commit, f)}
                            className="flex w-full items-center gap-1.5 px-8 py-0.5 text-left hover:bg-zinc-800"
                          >
                            <span className={`w-3 shrink-0 text-[10px] font-bold ${statusColor(f.status)}`}>{f.status}</span>
                            <span className="truncate text-[11px] text-zinc-400 hover:text-zinc-200">{f.path.split(/[\\/]/).pop()}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* resize handle */}
      <button
        type="button"
        aria-label="Ridimensiona git sidebar"
        onMouseDown={(e) => resizeSidebar(e.clientX)}
        className={`w-1 shrink-0 cursor-col-resize ${sidebarPreviewWidth !== null ? 'bg-sky-500' : 'bg-zinc-800 hover:bg-sky-600'}`}
      />
    </div>
  )
}
