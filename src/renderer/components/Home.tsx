import { Copy, Database, FolderOpen, GitBranch, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'

type RecentWorkspace = {
  id: number
  path: string
  name: string
  last_opened: string
}

type RecentDbConnection = {
  id: number
  name: string
  driver: DbDriver
  host: string
  port: number
  status?: 'connected' | 'disconnected' | 'error'
  lastUsedAt?: string
}

type HomeProps = {
  onOpenWorkspace: (path: string, name: string) => void
  onOpenDbConnection: (id: number) => void
  onNewDbConnection: () => void
}

function formatLastOpened(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function formatRelativeDate(iso?: string): string {
  if (!iso) return 'mai usata'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'mai usata'
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'ora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min fa`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ore fa`
  const days = Math.floor(hours / 24)
  return `${days} giorni fa`
}

function formatDbType(type: RecentDbConnection['driver']): string {
  const labels: Record<RecentDbConnection['driver'], string> = {
    mysql: 'MySQL',
    postgres: 'PostgreSQL',
  }
  return labels[type]
}

async function fetchRecentDbConnections(): Promise<RecentDbConnection[]> {
  const connections = await window.api.database.listConnections()
  return connections.map((connection) => ({
    id: connection.id,
    name: connection.name,
    driver: connection.driver,
    host: connection.host,
    port: connection.port,
    status: connection.status,
    lastUsedAt: connection.lastUsedAt,
  }))
}

export default function Home({ onOpenWorkspace, onOpenDbConnection, onNewDbConnection }: HomeProps) {
  const [recent, setRecent] = useState<RecentWorkspace[]>([])
  const [recentDb, setRecentDb] = useState<RecentDbConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [openingFolder, setOpeningFolder] = useState(false)
  const [showGitModal, setShowGitModal] = useState(false)
  const [gitUrl, setGitUrl] = useState('')
  const [gitUrlError, setGitUrlError] = useState<string | null>(null)
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')

  useEffect(() => {
    Promise.all([window.api.getRecentWorkspaces(), fetchRecentDbConnections()])
      .then(([workspaces, dbConnections]) => {
        setRecent(workspaces)
        setRecentDb(dbConnections)
      })
      .catch((err) => console.error('Failed to load home data:', err))
      .finally(() => setLoading(false))
  }, [])

  const handleOpenFolder = async () => {
    setOpeningFolder(true)
    try {
      const result = await window.api.openFolder()
      if (result) onOpenWorkspace(result.path, result.name)
    } catch (err) {
      console.error('Failed to open folder:', err)
    } finally {
      setOpeningFolder(false)
    }
  }

  const openProjectModal = () => {
    setProjectName('')
    setProjectPath('')
    setShowProjectModal(true)
  }

  const closeProjectModal = () => {
    setShowProjectModal(false)
    setProjectName('')
    setProjectPath('')
  }

  const handleBrowseProjectPath = async () => {
    try {
      const result = await window.api.openFolder()
      if (result) setProjectPath(result.path)
    } catch (err) {
      console.error('Failed to browse project path:', err)
    }
  }

  const handleCreateProject = async () => {
    const name = projectName.trim()
    const path = projectPath.trim()
    if (!name || !path) return

    closeProjectModal()

    const createFolder = (
      window.api as { createFolder?: (path: string, name: string) => Promise<unknown> }
    ).createFolder

    if (typeof createFolder === 'function') {
      try {
        await createFolder(path, name)
      } catch (err) {
        console.error('Failed to create project folder:', err)
      }
    }
  }

  const isValidGitUrl = (url: string) => {
    const trimmed = url.trim()
    return trimmed.startsWith('https://') || trimmed.startsWith('git@')
  }

  const closeGitModal = () => {
    setShowGitModal(false)
    setGitUrl('')
    setGitUrlError(null)
  }

  const openGitModal = () => {
    setGitUrl('')
    setGitUrlError(null)
    setShowGitModal(true)
  }

  const handleGitClone = async () => {
    const trimmed = gitUrl.trim()
    if (!trimmed) return

    if (!isValidGitUrl(trimmed)) {
      setGitUrlError('Inserisci un URL HTTPS o SSH valido')
      return
    }

    closeGitModal()
    try {
      await window.api.openFolder()
    } catch (err) {
      console.error('Failed to choose clone destination:', err)
    }
  }

  useEffect(() => {
    if (!showGitModal && !showProjectModal) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showProjectModal) closeProjectModal()
      if (showGitModal) closeGitModal()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showGitModal, showProjectModal])

  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-zinc-950 px-8 py-12 text-zinc-100">
      <div className="w-full max-w-3xl">
        <h1 className="mb-12 text-center text-5xl font-light tracking-tight text-zinc-100">
          Strata
        </h1>

        <section className="mb-14">
          <h2 className="mb-5 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Inizia
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <button
              type="button"
              onClick={handleOpenFolder}
              disabled={openingFolder}
              className="flex flex-col items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 text-left transition hover:border-zinc-600 hover:bg-zinc-900 disabled:opacity-50"
            >
              <FolderOpen className="h-6 w-6 text-blue-400" />
              <span className="text-sm font-medium text-zinc-100">Apri cartella</span>
              <span className="text-xs leading-relaxed text-zinc-500">
                Apri una cartella esistente sul disco
              </span>
            </button>

            <button
              type="button"
              onClick={openProjectModal}
              className="flex flex-col items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 text-left transition hover:border-zinc-600 hover:bg-zinc-900"
            >
              <Copy className="h-6 w-6 text-emerald-400" />
              <span className="text-sm font-medium text-zinc-100">Nuovo progetto</span>
              <span className="text-xs leading-relaxed text-zinc-500">
                Crea un nuovo workspace vuoto
              </span>
            </button>

            <button
              type="button"
              onClick={openGitModal}
              className="flex flex-col items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 text-left transition hover:border-zinc-600 hover:bg-zinc-900"
            >
              <GitBranch className="h-6 w-6 text-violet-400" />
              <span className="text-sm font-medium text-zinc-100">Clona da Git</span>
              <span className="text-xs leading-relaxed text-zinc-500">
                Clona un repository remoto
              </span>
            </button>
          </div>
        </section>

        <section className="mb-14">
          <h2 className="mb-5 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Recenti
          </h2>

          {loading ? (
            <p className="text-sm text-zinc-500">Caricamento...</p>
          ) : recent.length === 0 ? (
            <p className="text-sm text-zinc-500">Nessun progetto recente</p>
          ) : (
            <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/40">
              {recent.map((ws) => (
                <li key={ws.id}>
                  <button
                    type="button"
                    onClick={() => onOpenWorkspace(ws.path, ws.name)}
                    className="flex w-full flex-col gap-0.5 px-4 py-3 text-left transition hover:bg-zinc-800/80"
                  >
                    <span className="text-sm font-medium text-zinc-200">{ws.name}</span>
                    <span className="truncate text-xs text-zinc-500">{ws.path}</span>
                    <span className="text-xs text-zinc-600">
                      {formatLastOpened(ws.last_opened)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-5 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Connessioni recenti
          </h2>

          {loading ? (
            <p className="text-sm text-zinc-500">Caricamento...</p>
          ) : recentDb.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
              <p className="mb-3 text-sm text-zinc-500">Nessuna connessione salvata</p>
              <button
                type="button"
                onClick={onNewDbConnection}
                className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500"
              >
                <Plus className="h-4 w-4" />
                Nuova connessione
              </button>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {recentDb.map((conn) => (
                <li key={conn.id}>
                  <button
                    type="button"
                    onClick={() => onOpenDbConnection(conn.id)}
                    className="flex w-full items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-left transition hover:border-zinc-600 hover:bg-zinc-900"
                  >
                    <span className="relative rounded-md bg-zinc-950 p-2">
                      <Database className="h-5 w-5 text-sky-400" />
                      <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-zinc-900 ${conn.status === 'connected' ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-200">{conn.name}</span>
                      <span className="mt-1 block text-xs text-zinc-500">
                        {formatDbType(conn.driver)} · {conn.host}:{conn.port}
                      </span>
                      <span className="mt-1 block text-xs text-zinc-600">
                        Ultimo utilizzo {formatRelativeDate(conn.lastUsedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {showProjectModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={closeProjectModal}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="project-modal-title"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 id="project-modal-title" className="text-sm font-medium text-zinc-100">
                Nuovo progetto
              </h3>
              <button
                type="button"
                onClick={closeProjectModal}
                className="rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs text-zinc-500">Nome progetto</span>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Il mio progetto"
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </label>

            <div className="mb-4">
              <span className="mb-1.5 block text-xs text-zinc-500">Cartella di destinazione</span>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1 truncate rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
                  {projectPath || (
                    <span className="text-zinc-600">Nessuna cartella selezionata</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleBrowseProjectPath}
                  className="shrink-0 rounded-md border border-zinc-600 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800"
                >
                  Sfoglia
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeProjectModal}
                className="rounded-md px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleCreateProject}
                disabled={!projectName.trim() || !projectPath.trim()}
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Crea
              </button>
            </div>
          </div>
        </div>
      )}

      {showGitModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={closeGitModal}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="git-modal-title"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 id="git-modal-title" className="text-sm font-medium text-zinc-100">
                Clona da Git
              </h3>
              <button
                type="button"
                onClick={closeGitModal}
                className="rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                aria-label="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs text-zinc-500">SSH o URL repository</span>
              <input
                type="text"
                value={gitUrl}
                onChange={(e) => {
                  const value = e.target.value
                  setGitUrl(value)
                  if (gitUrlError && isValidGitUrl(value)) setGitUrlError(null)
                }}
                placeholder="git@github.com:user/repo.git"
                className={`w-full rounded-md border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none ${
                  gitUrlError
                    ? 'border-red-600 focus:border-red-500'
                    : 'border-zinc-700 focus:border-zinc-500'
                }`}
              />
              {gitUrlError && (
                <p className="mt-1.5 text-xs text-red-400">{gitUrlError}</p>
              )}
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeGitModal}
                className="rounded-md px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleGitClone}
                disabled={!gitUrl.trim()}
                className="rounded-md bg-violet-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clona
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
