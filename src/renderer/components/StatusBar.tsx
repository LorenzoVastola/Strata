import { useEffect, useRef, useState } from 'react'
import { GitBranch, Plus, Cloud, RefreshCw, ArrowUp, ArrowDown } from 'lucide-react'

interface Props {
  workspacePath: string | null
  onBranchChange?: (branch: string) => void
}

export default function StatusBar({ workspacePath, onBranchChange }: Props) {
  const [branch, setBranch] = useState('')
  const [ahead, setAhead] = useState(0)
  const [behind, setBehind] = useState(0)
  const [showDropdown, setShowDropdown] = useState(false)
  const [branches, setBranches] = useState<GitBranchItem[]>([])
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [theme, setTheme] = useState('vs-dark')
  const [autoSave, setAutoSave] = useState(true)
  const dropdownRef = useRef<HTMLDivElement>(null)
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
      setTheme(s.theme ?? 'vs-dark')
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

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
        setShowNewBranch(false)
        setNewBranchName('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (showNewBranch) newBranchRef.current?.focus()
  }, [showNewBranch])

  const openDropdown = async () => {
    if (!workspacePath) return
    setShowDropdown(prev => !prev)
    if (!showDropdown) {
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
    setShowDropdown(false)
  }

  const handleCreateBranch = async () => {
    if (!workspacePath || !newBranchName.trim()) return
    try {
      await window.api.git.createBranch(workspacePath, newBranchName.trim())
      setBranch(newBranchName.trim())
      onBranchChange?.(newBranchName.trim())
    } catch { /* ignore */ }
    setShowDropdown(false)
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

  const localBranches = branches.filter(b => !b.remote)
  const remoteBranches = branches.filter(b => b.remote)

  return (
    <div
      className="flex items-center h-[22px] min-h-[22px] bg-[#1e1e1e] border-t border-zinc-800 text-[11px] text-zinc-400 select-none shrink-0 overflow-hidden"
      style={{ fontFamily: 'var(--vscode-font-family, ui-monospace, monospace)' }}
    >
      {/* Branch section */}
      {workspacePath && branch && (
        <div className="relative flex items-center h-full" ref={dropdownRef}>
          <button
            className="flex items-center gap-1 px-2 h-full hover:bg-white/10 transition-colors"
            onClick={openDropdown}
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
          {showDropdown && (
            <div className="absolute bottom-full left-0 mb-[1px] bg-[#252526] border border-zinc-600 shadow-xl w-72 max-h-80 overflow-y-auto z-50 rounded-sm">
              {showNewBranch ? (
                <div className="p-2 flex items-center gap-1 border-b border-zinc-700">
                  <input
                    ref={newBranchRef}
                    value={newBranchName}
                    onChange={e => setNewBranchName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateBranch()
                      if (e.key === 'Escape') { setShowNewBranch(false); setNewBranchName('') }
                    }}
                    className="flex-1 bg-zinc-900 text-zinc-200 text-xs px-2 py-1 rounded border border-zinc-600 outline-none focus:border-blue-500"
                    placeholder="Nome del branch..."
                  />
                  <button
                    onClick={handleCreateBranch}
                    className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded"
                  >Crea</button>
                </div>
              ) : (
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-zinc-700 text-zinc-300 border-b border-zinc-700"
                  onClick={() => setShowNewBranch(true)}
                >
                  <Plus size={12} />
                  <span>Nuovo branch...</span>
                </button>
              )}

              {localBranches.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider">Locali</div>
                  {localBranches.map(b => (
                    <button
                      key={b.name}
                      className={`flex items-center gap-2 w-full px-3 py-1.5 hover:bg-zinc-700 text-left ${b.current ? 'text-blue-400' : 'text-zinc-300'}`}
                      onClick={() => handleCheckout(b.name)}
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
                  {remoteBranches.map(b => (
                    <button
                      key={b.name}
                      className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-zinc-700 text-zinc-400 text-left"
                      onClick={() => handleCheckout(b.name)}
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
        <span className="flex items-center gap-0.5 text-zinc-400" title="Errori TypeScript">
          <span className="text-red-400">⊗</span>
          <span>0</span>
        </span>
        <span className="flex items-center gap-0.5 text-zinc-400" title="Warning TypeScript">
          <span className="text-yellow-400">⚠</span>
          <span>0</span>
        </span>
      </div>

      <div className="flex-1" />

      {/* Theme */}
      <div className="px-3 h-full flex items-center hover:bg-white/10 cursor-default transition-colors" title="Tema">
        {theme === 'vs-dark' ? 'Dark+' : theme === 'vs-light' ? 'Light' : theme}
      </div>

      {/* Auto-save */}
      <div className="px-3 h-full flex items-center hover:bg-white/10 cursor-default transition-colors" title="Auto-save">
        {autoSave ? 'Auto Save' : 'Manual Save'}
      </div>
    </div>
  )
}
