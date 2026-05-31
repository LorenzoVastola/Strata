import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { getFileIconMeta, getFolderIconMeta } from '../utils/fileIcons'

type DirEntry = { name: string; path: string; isDirectory: boolean }
type CreateCommand = { id: number; type: 'file' | 'folder' }

type FileExplorerProps = {
  workspacePath: string
  onFileSelect: (path: string) => void
  revealPath?: string | null
  createCommand?: CreateCommand | null
}

type EditingNode = {
  path: string
  parentPath: string
  originalName: string
  draftName: string
  isDirectory: boolean
  isNew: boolean
}

type ContextMenuState = {
  x: number
  y: number
  entry: DirEntry
}

type DeletePrompt = {
  entry: DirEntry
  skipNext: boolean
}

const normalizePath = (filePath: string) => filePath.replace(/\\/g, '/')
const dirname = (filePath: string) => filePath.replace(/[\\/][^\\/]+$/, '')

const getRelativePath = (workspacePath: string, filePath: string) => {
  const root = normalizePath(workspacePath).replace(/\/$/, '')
  const target = normalizePath(filePath)
  return target.startsWith(`${root}/`) ? target.slice(root.length + 1) : target
}

export default function FileExplorer({
  workspacePath,
  onFileSelect,
  revealPath,
  createCommand,
}: FileExplorerProps) {
  const [childrenByPath, setChildrenByPath] = useState<Record<string, DirEntry[]>>({})
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [selectedFolder, setSelectedFolder] = useState(workspacePath)
  const [editingNode, setEditingNode] = useState<EditingNode | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [deletePrompt, setDeletePrompt] = useState<DeletePrompt | null>(null)
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false)
  const lastCreateCommandId = useRef<number | null>(null)

  const loadDir = useCallback(async (dirPath: string) => {
    const normalizedDirPath = normalizePath(dirPath)
    setLoadingPaths((prev) => new Set(prev).add(normalizedDirPath))
    try {
      const entries = await window.api.readDir(dirPath)
      const sorted = [...entries].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setChildrenByPath((prev) => ({ ...prev, [normalizedDirPath]: sorted }))
    } catch (err) {
      console.error('Failed to read directory:', dirPath, err)
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev)
        next.delete(normalizedDirPath)
        return next
      })
    }
  }, [])

  const refreshParent = useCallback(
    async (parentPath: string) => {
      await loadDir(parentPath)
      setExpandedDirs((prev) => new Set(prev).add(normalizePath(parentPath)))
    },
    [loadDir],
  )

  const createUniqueName = useCallback(
    (parentPath: string, baseName: string) => {
      const siblings = childrenByPath[normalizePath(parentPath)] ?? []
      const names = new Set(siblings.map((entry) => entry.name))
      if (!names.has(baseName)) return baseName

      const extensionIndex = baseName.lastIndexOf('.')
      const stem = extensionIndex > 0 ? baseName.slice(0, extensionIndex) : baseName
      const extension = extensionIndex > 0 ? baseName.slice(extensionIndex) : ''

      let index = 1
      while (names.has(`${stem}-${index}${extension}`)) index += 1
      return `${stem}-${index}${extension}`
    },
    [childrenByPath],
  )

  const beginCreate = useCallback(
    async (parentPath: string, type: 'file' | 'folder') => {
      const normalizedParent = normalizePath(parentPath)
      const fallbackName = type === 'file' ? 'untitled.txt' : 'new-folder'
      const name = createUniqueName(normalizedParent, fallbackName)

      try {
        const created =
          type === 'file'
            ? await window.api.createFile(normalizedParent, name)
            : await window.api.createFolder(normalizedParent, name)

        await refreshParent(normalizedParent)
        setSelectedFolder(type === 'folder' ? created.path : normalizedParent)
        setEditingNode({
          path: created.path,
          parentPath: normalizedParent,
          originalName: created.name,
          draftName: created.name,
          isDirectory: type === 'folder',
          isNew: true,
        })
      } catch (err) {
        console.error('Failed to create node:', err)
      }
    },
    [createUniqueName, refreshParent],
  )

  useEffect(() => {
    setChildrenByPath({})
    setExpandedDirs(new Set())
    setSelectedFolder(workspacePath)
    setEditingNode(null)
    void loadDir(workspacePath)
  }, [workspacePath, loadDir])

  useEffect(() => {
    if (!createCommand || createCommand.id === lastCreateCommandId.current) return
    lastCreateCommandId.current = createCommand.id
    void beginCreate(selectedFolder, createCommand.type)
  }, [beginCreate, createCommand, selectedFolder])

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null)
    window.addEventListener('click', closeContextMenu)
    return () => window.removeEventListener('click', closeContextMenu)
  }, [])

  useEffect(() => {
    if (!revealPath) return

    const normalizedWorkspace = normalizePath(workspacePath)
    const normalizedRevealPath = normalizePath(revealPath)
    if (!normalizedRevealPath.startsWith(normalizedWorkspace)) return

    const revealDirs: string[] = []
    let cursor = normalizedRevealPath

    while (cursor !== normalizedWorkspace) {
      revealDirs.unshift(cursor)
      const parent = dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }

    void Promise.all(revealDirs.map((dirPath) => loadDir(dirPath))).then(() => {
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        revealDirs.forEach((dirPath) => next.add(normalizePath(dirPath)))
        return next
      })
    })
  }, [loadDir, revealPath, workspacePath])

  const toggleDir = async (dirPath: string) => {
    const normalizedDirPath = normalizePath(dirPath)
    setSelectedFolder(normalizedDirPath)

    if (expandedDirs.has(normalizedDirPath)) {
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        next.delete(normalizedDirPath)
        return next
      })
      return
    }

    if (!childrenByPath[normalizedDirPath]) await loadDir(normalizedDirPath)
    setExpandedDirs((prev) => new Set(prev).add(normalizedDirPath))
  }

  const cancelEdit = async () => {
    if (!editingNode) return

    if (editingNode.isNew) {
      await window.api.deletePath(editingNode.path)
      await refreshParent(editingNode.parentPath)
    }

    setEditingNode(null)
  }

  const confirmEdit = async () => {
    if (!editingNode) return

    const nextName = editingNode.draftName.trim()
    if (!nextName) {
      await cancelEdit()
      return
    }

    if (nextName === editingNode.originalName) {
      setEditingNode(null)
      return
    }

    try {
      const renamed = await window.api.renamePath(editingNode.path, nextName)
      await refreshParent(editingNode.parentPath)
      if (renamed.isDirectory) {
        setSelectedFolder(renamed.path)
        setExpandedDirs((prev) => {
          const next = new Set(prev)
          next.delete(normalizePath(editingNode.path))
          next.add(normalizePath(renamed.path))
          return next
        })
      }
      setEditingNode(null)
    } catch (err) {
      console.error('Failed to rename node:', err)
    }
  }

  const deleteEntry = async (entry: DirEntry) => {
    try {
      await window.api.deletePath(entry.path)
      await refreshParent(dirname(entry.path))
      if (selectedFolder === normalizePath(entry.path)) setSelectedFolder(dirname(entry.path))
    } catch (err) {
      console.error('Failed to delete node:', err)
    }
  }

  const requestDelete = (entry: DirEntry) => {
    if (skipDeleteConfirm) {
      void deleteEntry(entry)
      return
    }

    setDeletePrompt({ entry, skipNext: false })
  }

  const startRename = (entry: DirEntry) => {
    setEditingNode({
      path: entry.path,
      parentPath: dirname(entry.path),
      originalName: entry.name,
      draftName: entry.name,
      isDirectory: entry.isDirectory,
      isNew: false,
    })
  }

  const renderNodeName = (entry: DirEntry) => {
    if (editingNode?.path !== entry.path) return <span className="truncate">{entry.name}</span>

    return (
      <input
        autoFocus
        value={editingNode.draftName}
        onChange={(event) =>
          setEditingNode((prev) => (prev ? { ...prev, draftName: event.target.value } : prev))
        }
        onBlur={() => void confirmEdit()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void confirmEdit()
          if (event.key === 'Escape') void cancelEdit()
        }}
        className="min-w-0 flex-1 rounded border border-sky-500 bg-zinc-950 px-1 py-0 text-xs text-zinc-100 outline-none"
      />
    )
  }

  const openContextMenu = (event: MouseEvent, entry: DirEntry) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, entry })
    if (entry.isDirectory) setSelectedFolder(normalizePath(entry.path))
    else setSelectedFolder(dirname(entry.path))
  }

  const renderEntries = (dirPath: string, depth: number) => {
    const entries = childrenByPath[normalizePath(dirPath)]
    if (!entries) return null

    return entries.map((entry) => {
      const paddingLeft = 8 + depth * 12
      const guideLeft = 8 + depth * 12 + 7

      if (entry.isDirectory) {
        const normalizedEntryPath = normalizePath(entry.path)
        const isExpanded = expandedDirs.has(normalizedEntryPath)
        const isLoading = loadingPaths.has(normalizedEntryPath)
        const isSelected = selectedFolder === normalizedEntryPath
        const { Icon, colorClass } = getFolderIconMeta(isExpanded)

        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() => void toggleDir(entry.path)}
              onContextMenu={(event) => openContextMenu(event, entry)}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800 ${
                isSelected ? 'bg-zinc-800' : ''
              }`}
              style={{ paddingLeft }}
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${colorClass}`} />
              {renderNodeName(entry)}
              {isLoading && <span className="text-zinc-500">...</span>}
            </button>
            {isExpanded && (
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-0 top-0 w-px bg-[#ffffff15]"
                  style={{ left: guideLeft }}
                />
                {renderEntries(entry.path, depth + 1)}
              </div>
            )}
          </div>
        )
      }

      const { Icon, colorClass } = getFileIconMeta(entry.name)

      return (
        <button
          key={entry.path}
          type="button"
          onClick={() => {
            setSelectedFolder(dirname(entry.path))
            onFileSelect(entry.path)
          }}
          onContextMenu={(event) => openContextMenu(event, entry)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          style={{ paddingLeft }}
        >
          <Icon className={`h-3.5 w-3.5 shrink-0 ${colorClass}`} />
          {renderNodeName(entry)}
        </button>
      )
    })
  }

  const contextTargetFolder = contextMenu?.entry.isDirectory
    ? normalizePath(contextMenu.entry.path)
    : contextMenu
      ? dirname(contextMenu.entry.path)
      : workspacePath

  return (
    <div className="relative h-full overflow-y-auto bg-zinc-900 py-2">
      {loadingPaths.has(normalizePath(workspacePath)) && !childrenByPath[normalizePath(workspacePath)] ? (
        <p className="px-3 text-xs text-zinc-500">Caricamento...</p>
      ) : (
        renderEntries(workspacePath, 0)
      )}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-48 rounded-md border border-zinc-700 bg-zinc-900 py-1 text-xs text-zinc-200 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setContextMenu(null)
              void beginCreate(contextTargetFolder, 'file')
            }}
            className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800"
          >
            Nuovo file
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null)
              void beginCreate(contextTargetFolder, 'folder')
            }}
            className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800"
          >
            Nuova cartella
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null)
              startRename(contextMenu.entry)
            }}
            className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800"
          >
            Rinomina
          </button>
          <button
            type="button"
            onClick={() => {
              const { entry } = contextMenu
              setContextMenu(null)
              requestDelete(entry)
            }}
            className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-zinc-800"
          >
            Elimina
          </button>
          <div className="my-1 border-t border-zinc-800" />
          <button
            type="button"
            onClick={() => {
              setContextMenu(null)
              void navigator.clipboard.writeText(getRelativePath(workspacePath, contextMenu.entry.path))
            }}
            className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800"
          >
            Copia path relativo
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null)
              void navigator.clipboard.writeText(contextMenu.entry.path)
            }}
            className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800"
          >
            Copia path assoluto
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null)
              void window.api.revealPath(contextMenu.entry.path)
            }}
            className="block w-full px-3 py-1.5 text-left hover:bg-zinc-800"
          >
            Rivela in Esplora file
          </button>
        </div>
      )}

      {deletePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[min(420px,calc(100vw-32px))] rounded-md border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
            <h2 className="text-sm font-medium text-zinc-100">Eliminare {deletePrompt.entry.name}?</h2>
            <p className="mt-2 text-xs text-zinc-400">L'operazione non puo essere annullata.</p>
            <label className="mt-4 flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={deletePrompt.skipNext}
                onChange={(event) =>
                  setDeletePrompt((prev) => (prev ? { ...prev, skipNext: event.target.checked } : prev))
                }
              />
              Non chiedere di nuovo per questa sessione
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletePrompt(null)}
                className="rounded px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={() => {
                  if (deletePrompt.skipNext) setSkipDeleteConfirm(true)
                  const { entry } = deletePrompt
                  setDeletePrompt(null)
                  void deleteEntry(entry)
                }}
                className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-500"
              >
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
