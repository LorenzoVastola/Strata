import { File, Folder, FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type DirEntry = { name: string; path: string; isDirectory: boolean }

type FileExplorerProps = {
  workspacePath: string
  onFileSelect: (path: string) => void
}

export default function FileExplorer({ workspacePath, onFileSelect }: FileExplorerProps) {
  const [childrenByPath, setChildrenByPath] = useState<Record<string, DirEntry[]>>({})
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())

  const loadDir = useCallback(async (dirPath: string) => {
    setLoadingPaths((prev) => new Set(prev).add(dirPath))
    try {
      const entries = await window.api.readDir(dirPath)
      const sorted = [...entries].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setChildrenByPath((prev) => ({ ...prev, [dirPath]: sorted }))
    } catch (err) {
      console.error('Failed to read directory:', dirPath, err)
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev)
        next.delete(dirPath)
        return next
      })
    }
  }, [])

  useEffect(() => {
    setChildrenByPath({})
    setExpandedDirs(new Set())
    loadDir(workspacePath)
  }, [workspacePath, loadDir])

  const toggleDir = async (dirPath: string) => {
    if (expandedDirs.has(dirPath)) {
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        next.delete(dirPath)
        return next
      })
      return
    }

    if (!childrenByPath[dirPath]) {
      await loadDir(dirPath)
    }

    setExpandedDirs((prev) => new Set(prev).add(dirPath))
  }

  const renderEntries = (dirPath: string, depth: number) => {
    const entries = childrenByPath[dirPath]
    if (!entries) return null

    return entries.map((entry) => {
      const paddingLeft = 8 + depth * 12

      if (entry.isDirectory) {
        const isExpanded = expandedDirs.has(entry.path)
        const isLoading = loadingPaths.has(entry.path)

        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() => toggleDir(entry.path)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-800"
              style={{ paddingLeft }}
            >
              {isExpanded ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              )}
              <span className="truncate">{entry.name}</span>
              {isLoading && <span className="text-zinc-500">…</span>}
            </button>
            {isExpanded && renderEntries(entry.path, depth + 1)}
          </div>
        )
      }

      return (
        <button
          key={entry.path}
          type="button"
          onClick={() => onFileSelect(entry.path)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          style={{ paddingLeft }}
        >
          <File className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <span className="truncate">{entry.name}</span>
        </button>
      )
    })
  }

  return (
    <div className="h-full overflow-y-auto bg-zinc-900 py-2">
      {loadingPaths.has(workspacePath) && !childrenByPath[workspacePath] ? (
        <p className="px-3 text-xs text-zinc-500">Caricamento...</p>
      ) : (
        renderEntries(workspacePath, 0)
      )}
    </div>
  )
}
