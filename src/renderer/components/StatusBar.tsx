import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Cloud, GitBranch, Plus, RefreshCw } from 'lucide-react'
import { DARK_THEMES, LIGHT_THEMES, applyThemeCSSVars, getTheme } from '../themes'

interface Props {
  workspacePath: string | null
  onBranchChange?: (branch: string) => void
}

export default function StatusBar({ workspacePath, onBranchChange }: Props) {
  const [branch, setBranch] = useState('')
  const [ahead, setAhead] = useState(0)
  const [behind, setBehind] = useState(0)
  const [showBranchDropdown, setShowBranchDropdown] = useState(false)
  const [branches, setBranches] = useState<GitBranchItem[]>([])
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [theme, setTheme] = useState('one-dark-pro')
  const [showThemeDropdown, setShowThemeDropdown] = useState(false)
  const [autoSave, setAutoSave] = useState(true)
  const branchDropdownRef = useRef<HTMLDivElement>(null)
  const themeDropdownRef = useRef<HTMLDivElement>(null)
  const newBranchRef = useRef<HTMLInputElement>(null)

  const fetchBranch = async () => {
    if (!workspacePath) { setBranch(''); setAhead(0); setBehind(0); return }
    try {
      const status = await window.api.git.status(workspacePath)
      setBranch(status.current)
      setAhead(status.ahead)
      setBehind(status.behind)
    } catch {
      setBranch('')
    }
  }

  const fetchSettings = async () => {
    try {
      const s = await window.api.getEditorSettings()
      const t = s.theme || 'one-dark-pro'
      setTheme(t)
      applyThemeCSSVars(t)
      setAutoSave(s.autoSave ?? true)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchBranch()
    fetchSettings()
  }, [workspacePath])

  // Poll every 30s
  useEffect(() => {
    const id = setInterval(fetchBranch, 30_000)
    return () => clearInterval(id)
  }, [workspacePath])

  // Listen for theme changes from IDEPanel's own bottom-bar select
  useEffect(() => {
    const handler = (e: Event) => {
      const themeId = (e as CustomEvent<string>).detail
      setTheme(themeId)
    }
    window.addEventListener('strata:theme-change', handler)
    return () => window.removeEventListener('strata:theme-change', handler)
  }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setShowBranchDropdown(false)
        setShowNewBranch(false)
        setNewBranchName('')
      }
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target as Node)) {
        setShowThemeDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (showNewBranch) newBranchRef.current?.focus()
  }, [showNewBranch])

  const openBranchDropdown = async () => {
    if (!workspacePath) return
    setShowBranchDropdown((prev) => !prev)
    if (!showBranchDropdown) {
      try {
        const list = await window.api.git.getBranches(workspacePath)
        setBranches(list)
      } catch { /* ignore */ }
    }
  }

  const handleCheckout = async (b: string) => {
    if (!workspacePath) return
    try {
      await window.api.git.checkoutBranch(workspacePath, b)
      setBranch(b)
      onBranchChange?.(b)
    } catch { /* ignore */ }
    setShowBranchDropdown(false)
  }

  const handleCreateBranch = async () => {
    if (!workspacePath || !newBranchName.trim()) return
    try {
      await window.api.git.createBranch(workspacePath, newBranchName.trim())
      setBranch(newBranchName.trim())
      onBranchChange?.(newBranchName.trim())
    } catch { /* ignore */ }
    setShowBranchDropdown(false)
    setShowNewBranch(false)
    setNewBranchName('')
  }

  const handleSync = async () => {
    if (!workspacePath || syncing) return
    setSyncing(true)
    try {
      if (behind > 0) await window.api.git.pull(workspacePath)
      if (ahead > 0) await window.api.git.push(workspacePath)
      await fetchBranch()
    } catch { /* ignore */ }
    setSyncing(false)
  }

  const handleThemeChange = async (themeId: string) => {
    setTheme(themeId)
    applyThemeCSSVars(themeId)
    setShowThemeDropdown(false)
    try {
      await window.api.saveEditorSetting('theme', themeId)
    } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('strata:theme-change', { detail: themeId }))
  }

  const localBranches = branches.filter((b) => !b.remote)
  const remoteBranches = branches.filter((b) => b.remote)
  const currentTheme = getTheme(theme)

  return (
    <div
      className="flex items-center h-[22px] min-h-[22px] border-t text-[11px] select-none shrink-0 overflow-hidden"
      style={{
        background: 'var(--strata-status-bar, #21252b)',
        borderColor: 'var(--strata-border, #181a1f)',
        color: 'var(--strata-text, #abb2bf)',
        fontFamily: 'var(--vscode-font-family, ui-monospace, monospace)',
      }}
    >
      {/* Branch section */}
      {workspacePath && branch && (
        <div className="relative flex items-center h-full" ref={branchDropdownRef}>
          <button
            className="flex items-center gap-1 px-2 h-full hover:bg-white/10 transition-colors"
            onClick={openBranchDropdown}
            title="Cambia branch"
          >
            <GitBranch size={12} className="shrink-0" />
            <span className="max-w-[200px] truncate">{branch}</span>
          </button>

          {/* Sync button */}
          {(ahead > 0 || behind > 0) && (
            <button
              className="flex items-center gap-0.5 px-1.5 h-full hover:bg-white/10 transition-colors"
              onClick={handleSync}
              title={`Sync: ↑${ahead} ↓${behind}`}
            >
              {syncing ? (
                <RefreshCw size={11} className="animate-spin" />
              ) : (
                <>
                  {ahead > 0 && (
                    <span className="flex items-center gap-0.5">
                      <ArrowUp size={11} />
                      {ahead}
                    </span>
                  )}
                  {behind > 0 && (
                    <span className="flex items-center gap-0.5">
                      <ArrowDown size={11} />
                      {behind}
                    </span>
                  )}
                </>
              )}
            </button>
          )}

          {/* Branch dropdown */}
          {showBranchDropdown && (
            <div
              className="absolute bottom-full left-0 mb-[1px] border shadow-xl w-72 max-h-80 overflow-y-auto z-50 rounded-sm"
              style={{ background: 'var(--strata-sidebar, #21252b)', borderColor: 'var(--strata-border, #181a1f)' }}
            >
              {showNewBranch ? (
                <div className="p-2 flex items-center gap-1 border-b border-zinc-700">
                  <input
                    ref={newBranchRef}
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreateBranch()
                      if (e.key === 'Escape') { setShowNewBranch(false); setNewBranchName('') }
                    }}
                    className="flex-1 bg-zinc-900 text-zinc-200 text-xs px-2 py-1 rounded border border-zinc-600 outline-none focus:border-blue-500"
                    placeholder="Nome del branch..."
                  />
                  <button
                    onClick={() => void handleCreateBranch()}
                    className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded"
                  >Crea</button>
                </div>
              ) : (
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-white/10 border-b border-zinc-700"
                  style={{ color: 'var(--strata-text)' }}
                  onClick={() => setShowNewBranch(true)}
                >
                  <Plus size={12} />
                  <span>Nuovo branch...</span>
                </button>
              )}

              {localBranches.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider">Locali</div>
                  {localBranches.map((b) => (
                    <button
                      key={b.name}
                      className={`flex items-center gap-2 w-full px-3 py-1.5 hover:bg-white/10 text-left ${b.current ? 'text-blue-400' : ''}`}
                      style={b.current ? {} : { color: 'var(--strata-text)' }}
                      onClick={() => void handleCheckout(b.name)}
                    >
                      <GitBranch size={12} className="shrink-0" />
                      <span className="truncate">{b.name}</span>
                      {b.current && <span className="ml-auto text-[10px] text-zinc-500">attuale</span>}
                    </button>
                  ))}
                </>
              )}

              {remoteBranches.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider border-t border-zinc-700">Remoti</div>
                  {remoteBranches.map((b) => (
                    <button
                      key={b.name}
                      className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-white/10 text-zinc-400 text-left"
                      onClick={() => void handleCheckout(b.name)}
                    >
                      <Cloud size={12} className="shrink-0" />
                      <span className="truncate">{b.name}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* TS Errors/Warnings */}
      <div className="flex items-center gap-2 px-2 h-full hover:bg-white/10 cursor-default transition-colors">
        <span className="flex items-center gap-0.5" title="Errori TypeScript">
          <span className="text-red-400">⊗</span>
          <span>0</span>
        </span>
        <span className="flex items-center gap-0.5" title="Warning TypeScript">
          <span className="text-yellow-400">⚠</span>
          <span>0</span>
        </span>
      </div>

      <div className="flex-1" />

      {/* Theme picker */}
      <div className="relative h-full" ref={themeDropdownRef}>
        <button
          onClick={() => setShowThemeDropdown((v) => !v)}
          className="px-3 h-full flex items-center gap-1 hover:bg-white/10 transition-colors"
          title="Cambia tema"
        >
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ background: currentTheme.ui.accent }}
          />
          {currentTheme.label}
        </button>

        {showThemeDropdown && (
          <div
            className="absolute bottom-full right-0 mb-[1px] border shadow-xl z-50 rounded-sm overflow-hidden"
            style={{
              background: 'var(--strata-sidebar, #21252b)',
              borderColor: 'var(--strata-border, #181a1f)',
              width: '200px',
            }}
          >
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider opacity-50">Dark</div>
            {DARK_THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => void handleThemeChange(t.id)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[11px] hover:bg-white/10 transition-colors"
                style={{
                  color: theme === t.id ? t.ui.accent : 'var(--strata-text)',
                  fontWeight: theme === t.id ? 600 : 400,
                }}
              >
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-white/10" style={{ background: t.ui.accent }} />
                {t.label}
                {theme === t.id && <span className="ml-auto text-[10px]">✓</span>}
              </button>
            ))}
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider opacity-50 border-t" style={{ borderColor: 'var(--strata-border)' }}>Light</div>
            {LIGHT_THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => void handleThemeChange(t.id)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[11px] hover:bg-white/10 transition-colors"
                style={{
                  color: theme === t.id ? t.ui.accent : 'var(--strata-text)',
                  fontWeight: theme === t.id ? 600 : 400,
                }}
              >
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-black/10" style={{ background: t.ui.accent }} />
                {t.label}
                {theme === t.id && <span className="ml-auto text-[10px]">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Auto-save */}
      <div className="px-3 h-full flex items-center hover:bg-white/10 cursor-default transition-colors" title="Auto-save">
        {autoSave ? 'Auto Save' : 'Manual Save'}
      </div>
    </div>
  )
}
