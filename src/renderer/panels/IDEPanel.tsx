import Editor from '@monaco-editor/react'
import { FilePlus, FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import FileExplorer from '../components/FileExplorer'

type IDEPanelProps = {
  workspacePath: string
}

export default function IDEPanel({ workspacePath: initialWorkspacePath }: IDEPanelProps) {
  const [content, setContent] = useState('')
  const [language, setLanguage] = useState('typescript')
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState(initialWorkspacePath)

  useEffect(() => {
    setWorkspacePath(initialWorkspacePath)
  }, [initialWorkspacePath])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [openingFolder, setOpeningFolder] = useState(false)

  const openFolder = async () => {
    setOpeningFolder(true)
    try {
      const result = await window.api.openFolder()
      if (result) setWorkspacePath(result.path)
    } catch (err) {
      console.error('Failed to open folder:', err)
    } finally {
      setOpeningFolder(false)
    }
  }

  const handleFileSelect = async (path: string) => {
    setLoading(true)
    try {
      const result = await window.api.readFile(path)
      setContent(result.content)
      setLanguage(result.language)
      setCurrentFile(path)
    } catch (err) {
      console.error('Failed to open file:', err)
    } finally {
      setLoading(false)
    }
  }

  const saveFile = async () => {
    if (!currentFile) return

    setSaving(true)
    try {
      await window.api.writeFile(currentFile, content)
    } catch (err) {
      console.error('Failed to save file:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-300">
          {currentFile ?? 'Nessun file aperto'}
        </span>

        <button
          type="button"
          onClick={saveFile}
          disabled={saving || !currentFile}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Salvataggio...' : 'Salva'}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
          <div className="flex shrink-0 items-center gap-0.5 border-b border-zinc-800 px-2 py-1.5">
            <button
              type="button"
              onClick={openFolder}
              disabled={openingFolder}
              title="Apri cartella"
              className="rounded p-1 text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-50"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Nuovo file"
              className="rounded p-1 text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-100"
            >
              <FilePlus className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <FileExplorer workspacePath={workspacePath} onFileSelect={handleFileSelect} />
          </div>
        </aside>

        <div className="min-h-0 min-w-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Caricamento file...
            </div>
          ) : currentFile ? (
            <Editor
              height="100%"
              width="100%"
              language={language}
              value={content}
              theme="vs-dark"
              onChange={(value) => setContent(value ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: 'on',
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Seleziona un file dall&apos;explorer
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
