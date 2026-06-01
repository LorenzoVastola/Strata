import Editor, { DiffEditor, type BeforeMount, type Monaco, type OnMount } from '@monaco-editor/react'
import { FilePlus, FolderOpen, FolderPlus, Search, X } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import FileExplorer from '../components/FileExplorer'
import TabBar, { type EditorTab } from '../components/TabBar'
import TerminalPanel from './TerminalPanel'
import { getFileIconMeta } from '../utils/fileIcons'
import { DARK_THEMES, LIGHT_THEMES, applyThemeCSSVars, defineMonacoThemes } from '../themes'

type IDEPanelProps = {
  workspacePath: string
  /** When true, hides the file-explorer sidebar (used when git sidebar is shown externally) */
  hideSidebar?: boolean
}

export type IDEPanelHandle = {
  openDiffTab: (params: {
    path: string
    title: string
    language: string
    original: string
    modified: string
    filePath?: string
  }) => void
}

type SearchResult = {
  filePath: string
  fileName: string
  line: number
  preview: string
}

type WorkspaceFile = {
  path: string
  name: string
  relativePath: string
}

type EditorPanelState = {
  id: string
  tabPaths: string[]
  activePath: string | null
  width: number
}

type DraggedTab = {
  panelId: string
  path: string
}

type CommandItem = {
  id: string
  label: string
  run: () => void
}

const getFileName = (filePath: string) => filePath.split(/[\\/]/).pop() ?? filePath
const normalizePath = (filePath: string) => filePath.replace(/\\/g, '/')
const DEFAULT_SIDEBAR_WIDTH = 240
const MIN_SIDEBAR_WIDTH = 160
const MAX_SIDEBAR_WIDTH = 500
const DEFAULT_TERMINAL_HEIGHT = 220
const MIN_TERMINAL_HEIGHT = 80

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const getRelativePath = (workspacePath: string, filePath: string) => {
  const normalizedWorkspace = normalizePath(workspacePath).replace(/\/$/, '')
  const normalizedFile = normalizePath(filePath)

  if (!normalizedFile.startsWith(`${normalizedWorkspace}/`)) return getFileName(filePath)

  return normalizedFile.slice(normalizedWorkspace.length + 1)
}

const fuzzyScore = (value: string, query: string) => {
  if (!query) return 1

  let score = 0
  let cursor = 0
  const lowerValue = value.toLowerCase()
  const lowerQuery = query.toLowerCase()

  for (const char of lowerQuery) {
    const foundIndex = lowerValue.indexOf(char, cursor)
    if (foundIndex === -1) return 0
    score += foundIndex === cursor ? 2 : 1
    cursor = foundIndex + 1
  }

  return score
}

const rebalancePanels = (nextPanels: EditorPanelState[]) => {
  if (nextPanels.length === 0) return [{ id: 'panel-1', tabPaths: [], activePath: null, width: 100 }]
  const width = 100 / nextPanels.length
  return nextPanels.map((panel) => ({ ...panel, width }))
}

const isTextModelCandidate = (file: WorkspaceFile) => {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return [
    'ts',
    'tsx',
    'js',
    'jsx',
    'json',
    'md',
    'css',
    'scss',
    'html',
    'env',
    'gitignore',
    'txt',
  ].includes(ext) || file.name.startsWith('.env')
}

const getModelLanguage = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    env: 'plaintext',
    gitignore: 'plaintext',
    txt: 'plaintext',
  }
  return map[ext ?? ''] ?? 'plaintext'
}

const IDEPanel = forwardRef<IDEPanelHandle, IDEPanelProps>(function IDEPanel(
  { workspacePath: initialWorkspacePath, hideSidebar = false },
  ref,
) {
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [panels, setPanels] = useState<EditorPanelState[]>([
    { id: 'panel-1', tabPaths: [], activePath: null, width: 100 },
  ])
  const [activePanelId, setActivePanelId] = useState('panel-1')
  const [workspacePath, setWorkspacePath] = useState(initialWorkspacePath)
  const editorAreaRef = useRef<HTMLDivElement | null>(null)
  const editorStackRef = useRef<HTMLDivElement | null>(null)
  const draggedTabRef = useRef<DraggedTab | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const editorRefs = useRef<Record<string, Parameters<OnMount>[0]>>({})
  const autosaveTimerRef = useRef<number | null>(null)
  const [hasRestoredTabs, setHasRestoredTabs] = useState(false)

  useEffect(() => {
    setWorkspacePath(initialWorkspacePath)
    setTabs([])
    setActivePath(null)
    setPanels([{ id: 'panel-1', tabPaths: [], activePath: null, width: 100 }])
    setActivePanelId('panel-1')
    setHasRestoredTabs(false)
  }, [initialWorkspacePath])

  const [loading, setLoading] = useState(false)
  const [isSaving, setSaving] = useState(false)
  const [openingFolder, setOpeningFolder] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [revealPath, setRevealPath] = useState<string | null>(null)
  const [isQuickOpen, setIsQuickOpen] = useState(false)
  const [quickOpenQuery, setQuickOpenQuery] = useState('')
  const [quickOpenFiles, setQuickOpenFiles] = useState<WorkspaceFile[]>([])
  const [quickOpenIndex, setQuickOpenIndex] = useState(0)
  const [createCommand, setCreateCommand] = useState<{ id: number; type: 'file' | 'folder' } | null>(null)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [commandIndex, setCommandIndex] = useState(0)
  const [autoSave, setAutoSave] = useState(false)
  const [theme, setTheme] = useState('vs-dark')
  const [monacoReady, setMonacoReady] = useState(false)
  const [isTerminalVisible, setTerminalVisible] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_HEIGHT)
  const [terminalPreviewHeight, setTerminalPreviewHeight] = useState<number | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [sidebarPreviewWidth, setSidebarPreviewWidth] = useState<number | null>(null)

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activePath) ?? null,
    [activePath, tabs],
  )
  const openTabKey = useMemo(() => tabs.map((tab) => tab.path).join('\u0000'), [tabs])

  const breadcrumbSegments = useMemo(() => {
    if (!activeTab) return []

    const parts = getRelativePath(workspacePath, activeTab.path).split('/').filter(Boolean)

    return parts.map((part, index) => {
      const relativePath = parts.slice(0, index + 1).join('/')
      const isFile = index === parts.length - 1
      const fullPath = `${normalizePath(workspacePath).replace(/\/$/, '')}/${relativePath}`

      return { label: part, fullPath, isFile }
    })
  }, [activeTab, workspacePath])

  const quickOpenResults = useMemo(() => {
    return quickOpenFiles
      .map((file) => ({ file, score: fuzzyScore(file.relativePath, quickOpenQuery) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.file.relativePath.localeCompare(b.file.relativePath))
      .slice(0, 50)
      .map((result) => result.file)
  }, [quickOpenFiles, quickOpenQuery])

  useEffect(() => {
    setQuickOpenIndex(0)
  }, [quickOpenQuery])

  useEffect(() => {
    setCommandIndex(0)
  }, [commandQuery])

  useEffect(() => {
    let isCancelled = false

    const loadSettings = async () => {
      try {
        const settings = await window.api.getEditorSettings()
        if (isCancelled) return
        setAutoSave(settings.autoSave)
        const savedTheme = settings.theme || 'one-dark-pro'
        setTheme(savedTheme)
        applyThemeCSSVars(savedTheme)
        setSidebarWidth(clamp(settings.sidebarWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH))
        setTerminalHeight(
          clamp(
            settings.terminalHeight || DEFAULT_TERMINAL_HEIGHT,
            MIN_TERMINAL_HEIGHT,
            window.innerHeight * 0.6,
          ),
        )
        monacoRef.current?.editor.setTheme(savedTheme)
      } catch (err) {
        console.error('Failed to load editor settings:', err)
      }
    }

    void loadSettings()
    return () => {
      isCancelled = true
    }
  }, [])

  const openFolder = useCallback(async () => {
    setOpeningFolder(true)
    try {
      const result = await window.api.openFolder()
      if (result) {
        setTabs([])
        setActivePath(null)
        setPanels([{ id: 'panel-1', tabPaths: [], activePath: null, width: 100 }])
        setActivePanelId('panel-1')
        setHasRestoredTabs(false)
        setWorkspacePath(result.path)
      }
    } catch (err) {
      console.error('Failed to open folder:', err)
    } finally {
      setOpeningFolder(false)
    }
  }, [])

  const loadWorkspaceModels = useCallback(async () => {
    const monaco = monacoRef.current
    if (!monaco) return

    try {
      const files = await window.api.getWorkspaceFiles(workspacePath)
      await Promise.all(
        files.filter(isTextModelCandidate).map(async (file) => {
          const uri = monaco.Uri.file(file.path)
          if (monaco.editor.getModel(uri)) return

          try {
            const result = await window.api.readFile(file.path)
            monaco.editor.createModel(result.content, result.language || getModelLanguage(file.name), uri)
          } catch {
            // Skip unreadable or binary-like files while preparing cross-file services.
          }
        }),
      )
    } catch (err) {
      console.error('Failed to prepare Monaco workspace models:', err)
    }
  }, [workspacePath])

  const handleBeforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco
    defineMonacoThemes(monaco)
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    })
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    })
    monaco.editor.setTheme(theme)
    setMonacoReady(true)
  }

  useEffect(() => {
    if (!monacoReady) return
    void loadWorkspaceModels()
  }, [loadWorkspaceModels, monacoReady])

  const ensureMonacoModel = useCallback((path: string, content: string, language: string) => {
    const monaco = monacoRef.current
    if (!monaco) return null

    const uri = monaco.Uri.file(path)
    const existingModel = monaco.editor.getModel(uri)
    if (existingModel) {
      if (existingModel.getValue() !== content) existingModel.setValue(content)
      return existingModel
    }

    return monaco.editor.createModel(content, language, uri)
  }, [])

  const openFile = useCallback(async (path: string) => {
    const existingTab = tabs.find((tab) => tab.path === path)
    if (existingTab) {
      setPanels((prev) =>
        prev.map((panel) =>
          panel.id === activePanelId
            ? {
                ...panel,
                tabPaths: panel.tabPaths.includes(path) ? panel.tabPaths : [...panel.tabPaths, path],
                activePath: path,
              }
            : panel,
        ),
      )
      setActivePath(path)
      return
    }

    setLoading(true)
    try {
      const result = await window.api.readFile(path)
      ensureMonacoModel(path, result.content, result.language)
      setTabs((prev) => [
        ...prev,
        {
          path,
          name: getFileName(path),
          content: result.content,
          savedContent: result.content,
          language: result.language,
        },
      ])
      setPanels((prev) =>
        prev.map((panel) =>
          panel.id === activePanelId
            ? { ...panel, tabPaths: [...panel.tabPaths, path], activePath: path }
            : panel,
        ),
      )
      setActivePath(path)
    } catch (err) {
      console.error('Failed to open file:', err)
    } finally {
      setLoading(false)
    }
  }, [activePanelId, ensureMonacoModel, tabs])

  useEffect(() => {
    let isCancelled = false

    const restoreTabs = async () => {
      try {
        const state = await window.api.getEditorState()
        const openTabs = state?.open_tabs ? (JSON.parse(state.open_tabs) as string[]) : []
        const restoredTabs: EditorTab[] = []

        for (const tabPath of openTabs) {
          if (!normalizePath(tabPath).startsWith(normalizePath(workspacePath))) continue

          try {
            const result = await window.api.readFile(tabPath)
            ensureMonacoModel(tabPath, result.content, result.language)
            restoredTabs.push({
              path: tabPath,
              name: getFileName(tabPath),
              content: result.content,
              savedContent: result.content,
              language: result.language,
            })
          } catch (err) {
            console.error('Failed to restore editor tab:', tabPath, err)
          }
        }

        if (isCancelled) return

        setTabs(restoredTabs)
        setActivePath(
          restoredTabs.some((tab) => tab.path === state?.active_tab)
            ? state?.active_tab ?? null
            : restoredTabs[0]?.path ?? null,
        )
        setPanels([
          {
            id: 'panel-1',
            tabPaths: restoredTabs.map((tab) => tab.path),
            activePath: restoredTabs.some((tab) => tab.path === state?.active_tab)
              ? state?.active_tab ?? null
              : restoredTabs[0]?.path ?? null,
            width: 100,
          },
        ])
        setActivePanelId('panel-1')
      } catch (err) {
        console.error('Failed to restore editor state:', err)
      } finally {
        if (!isCancelled) setHasRestoredTabs(true)
      }
    }

    void restoreTabs()

    return () => {
      isCancelled = true
    }
  }, [ensureMonacoModel, workspacePath])

  useEffect(() => {
    if (!hasRestoredTabs) return

    void window.api.saveEditorState(
      openTabKey ? openTabKey.split('\u0000') : [],
      activePath,
    )
  }, [activePath, hasRestoredTabs, openTabKey])

  const saveFile = useCallback(async () => {
    if (isSaving || !activeTab) return

    setSaving(true)
    try {
      await window.api.writeFile(activeTab.path, activeTab.content)
      setTabs((prev) =>
        prev.map((tab) =>
          tab.path === activeTab.path ? { ...tab, savedContent: activeTab.content } : tab,
        ),
      )
    } catch (err) {
      console.error('Failed to save file:', err)
    } finally {
      setSaving(false)
    }
  }, [activeTab, isSaving])

  const closeTab = useCallback((path: string, panelId = activePanelId) => {
    const tabToClose = tabs.find((tab) => tab.path === path)
    if (!tabToClose) return

    const nextPanelsBeforeCollapse = panels.map((panel) => {
      if (panel.id !== panelId) return panel

      const closedIndex = panel.tabPaths.indexOf(path)
      const nextTabPaths = panel.tabPaths.filter((tabPath) => tabPath !== path)
      const nextActivePath =
        panel.activePath === path
          ? nextTabPaths[closedIndex] ?? nextTabPaths[closedIndex - 1] ?? null
          : panel.activePath

      return { ...panel, tabPaths: nextTabPaths, activePath: nextActivePath }
    })
    const isStillReferenced = nextPanelsBeforeCollapse.some((panel) => panel.tabPaths.includes(path))

    if (!isStillReferenced && tabToClose.content !== tabToClose.savedContent &&
      !window.confirm(`Chiudere ${tabToClose.name} senza salvare le modifiche?`)) {
      return
    }

    const nonEmptyPanels = nextPanelsBeforeCollapse.filter((panel) => panel.tabPaths.length > 0)
    const nextPanels = rebalancePanels(nonEmptyPanels.length > 0 ? nonEmptyPanels : [
      { id: 'panel-1', tabPaths: [], activePath: null, width: 100 },
    ])
    const nextActivePanel = nextPanels.find((panel) => panel.id === panelId) ?? nextPanels[0]

    setPanels(nextPanels)
    setActivePanelId(nextActivePanel.id)
    if (activePath === path || activePanelId === panelId) {
      setActivePath(nextActivePanel.activePath)
    }
    if (!isStillReferenced) setTabs((prev) => prev.filter((tab) => tab.path !== path))
  }, [activePanelId, activePath, panels, tabs])

  const openQuickOpen = useCallback(async () => {
    setIsQuickOpen(true)
    setQuickOpenQuery('')
    setQuickOpenIndex(0)

    try {
      const files = await window.api.getWorkspaceFiles(workspacePath)
      setQuickOpenFiles(files)
    } catch (err) {
      console.error('Failed to load workspace files:', err)
      setQuickOpenFiles([])
    }
  }, [workspacePath])

  const activateTab = useCallback((panelId: string, path: string) => {
    setActivePanelId(panelId)
    setActivePath(path)
    setPanels((prev) =>
      prev.map((panel) => (panel.id === panelId ? { ...panel, activePath: path } : panel)),
    )
  }, [])

  const splitTabToRight = useCallback((path: string, sourcePanelId: string, move: boolean) => {
    if (panels.length >= 3) return

    const nextPanelId = `panel-${Date.now()}`
    const sourceIndex = panels.findIndex((panel) => panel.id === sourcePanelId)
    const nextPanel: EditorPanelState = { id: nextPanelId, tabPaths: [path], activePath: path, width: 0 }
    const nextPanels = panels.map((panel) =>
      move && panel.id === sourcePanelId
        ? {
            ...panel,
            tabPaths: panel.tabPaths.filter((tabPath) => tabPath !== path),
            activePath: panel.activePath === path
              ? panel.tabPaths.filter((tabPath) => tabPath !== path)[0] ?? null
              : panel.activePath,
          }
        : panel,
    )
    const insertAt = Math.min(sourceIndex + 1, nextPanels.length)
    nextPanels.splice(insertAt, 0, nextPanel)

    const rebalanced = rebalancePanels(nextPanels.filter((panel) => panel.tabPaths.length > 0))
    setPanels(rebalanced)
    setActivePanelId(nextPanelId)
    setActivePath(path)
  }, [panels])

  const moveDraggedTab = useCallback((targetPanelId: string, insertIndex: number) => {
    const dragged = draggedTabRef.current
    if (!dragged) return
    draggedTabRef.current = null

    const targetPanel = panels.find((panel) => panel.id === targetPanelId)
    if (!targetPanel) return

    const nextPanels = panels.map((panel) => {
      const withoutDragged = panel.tabPaths.filter((tabPath) => tabPath !== dragged.path)
      if (panel.id !== targetPanelId) {
        return {
          ...panel,
          tabPaths: withoutDragged,
          activePath: panel.activePath === dragged.path ? withoutDragged[0] ?? null : panel.activePath,
        }
      }

      const boundedIndex = Math.max(0, Math.min(insertIndex, withoutDragged.length))
      const nextTabPaths = [...withoutDragged]
      nextTabPaths.splice(boundedIndex, 0, dragged.path)
      return { ...panel, tabPaths: nextTabPaths, activePath: dragged.path }
    })

    const rebalanced = rebalancePanels(nextPanels.filter((panel) => panel.tabPaths.length > 0))
    setPanels(rebalanced)
    setActivePanelId(targetPanelId)
    setActivePath(dragged.path)
  }, [panels])

  const handleTabDragEnd = useCallback((path: string, clientX: number) => {
    const dragged = draggedTabRef.current
    draggedTabRef.current = null
    const rect = editorAreaRef.current?.getBoundingClientRect()

    if (!dragged || !rect || rect.right - clientX > 100 || panels.length >= 3) return

    splitTabToRight(path, dragged.panelId, true)
  }, [panels.length, splitTabToRight])

  const resizePanels = useCallback((leftPanelId: string, rightPanelId: string, startX: number) => {
    const leftPanel = panels.find((panel) => panel.id === leftPanelId)
    const rightPanel = panels.find((panel) => panel.id === rightPanelId)
    const rect = editorAreaRef.current?.getBoundingClientRect()
    if (!leftPanel || !rightPanel || !rect) return

    const startLeft = leftPanel.width
    const startRight = rightPanel.width

    const onMouseMove = (event: MouseEvent) => {
      const deltaPercent = ((event.clientX - startX) / rect.width) * 100
      setPanels((prev) =>
        prev.map((panel) => {
          if (panel.id === leftPanelId) {
            return { ...panel, width: Math.max(15, startLeft + deltaPercent) }
          }
          if (panel.id === rightPanelId) {
            return { ...panel, width: Math.max(15, startRight - deltaPercent) }
          }
          return panel
        }),
      )
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [panels])

  const resizeTerminal = useCallback((startY: number) => {
    const rect = editorStackRef.current?.getBoundingClientRect()
    if (!rect) return
    const startHeight = terminalHeight
    const maxHeight = Math.max(MIN_TERMINAL_HEIGHT, Math.min(rect.height, window.innerHeight * 0.6))
    let nextHeight = startHeight

    const onMouseMove = (event: MouseEvent) => {
      nextHeight = startHeight - (event.clientY - startY)
      setTerminalPreviewHeight(clamp(nextHeight, 0, maxHeight))
    }

    const onMouseUp = () => {
      setTerminalPreviewHeight(null)
      if (nextHeight < MIN_TERMINAL_HEIGHT) {
        setTerminalVisible(false)
      } else {
        const committedHeight = clamp(nextHeight, MIN_TERMINAL_HEIGHT, maxHeight)
        setTerminalHeight(committedHeight)
        void window.api.saveEditorSetting('terminalHeight', String(Math.round(committedHeight)))
      }
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [terminalHeight])

  const toggleTerminalPanel = useCallback(() => {
    setTerminalVisible((prev) => {
      if (prev) return false
      setTerminalHeight((height) => Math.max(MIN_TERMINAL_HEIGHT, height || DEFAULT_TERMINAL_HEIGHT))
      return true
    })
  }, [])

  const toggleTerminalByHandle = useCallback(() => {
    if (terminalHeight === DEFAULT_TERMINAL_HEIGHT) {
      setTerminalVisible(false)
      return
    }

    setTerminalHeight(DEFAULT_TERMINAL_HEIGHT)
    void window.api.saveEditorSetting('terminalHeight', String(DEFAULT_TERMINAL_HEIGHT))
  }, [terminalHeight])

  const resizeSidebar = useCallback((startX: number) => {
    const startWidth = sidebarWidth
    let nextWidth = startWidth

    const onMouseMove = (event: MouseEvent) => {
      nextWidth = clamp(startWidth + event.clientX - startX, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
      setSidebarPreviewWidth(nextWidth)
    }

    const onMouseUp = () => {
      setSidebarPreviewWidth(null)
      setSidebarWidth(nextWidth)
      void window.api.saveEditorSetting('sidebarWidth', String(Math.round(nextWidth)))
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  const toggleSidebarWidth = useCallback(() => {
    const nextWidth = sidebarWidth <= MIN_SIDEBAR_WIDTH ? DEFAULT_SIDEBAR_WIDTH : MIN_SIDEBAR_WIDTH
    setSidebarWidth(nextWidth)
    void window.api.saveEditorSetting('sidebarWidth', String(nextWidth))
  }, [sidebarWidth])

  const closeAllTabs = useCallback(() => {
    const hasUnsaved = tabs.some((tab) => tab.content !== tab.savedContent)
    if (hasUnsaved && !window.confirm('Chiudere tutte le tab senza salvare le modifiche?')) return

    setTabs([])
    setActivePath(null)
    setPanels([{ id: 'panel-1', tabPaths: [], activePath: null, width: 100 }])
    setActivePanelId('panel-1')
  }, [tabs])

  // ── Expose openDiffTab to parent via ref ────────────────────────────────────
  const openDiffTab = useCallback((params: {
    path: string; title: string; language: string
    original: string; modified: string; filePath?: string
  }) => {
    const { path, title, language, original, modified, filePath } = params
    if (tabs.find(t => t.path === path)) {
      setPanels(prev => prev.map(p => p.id === activePanelId ? { ...p, activePath: path } : p))
      setActivePath(path)
      return
    }
    const newTab: EditorTab = {
      path, name: title, content: '', savedContent: '', language,
      diff: { original, modified },
      iconPath: filePath,
    }
    setTabs(prev => [...prev, newTab])
    setPanels(prev => prev.map(p =>
      p.id === activePanelId ? { ...p, tabPaths: [...p.tabPaths, path], activePath: path } : p
    ))
    setActivePath(path)
  }, [tabs, activePanelId])

  useImperativeHandle(ref, () => ({ openDiffTab }), [openDiffTab])

  const changeActiveLanguage = useCallback(() => {
    if (!activeTab || !monacoRef.current) return

    const nextLanguage = window.prompt('Linguaggio file', activeTab.language)
    if (!nextLanguage) return

    const model = monacoRef.current.editor.getModel(monacoRef.current.Uri.file(activeTab.path))
    if (model) monacoRef.current.editor.setModelLanguage(model, nextLanguage)
    setTabs((prev) =>
      prev.map((tab) => (tab.path === activeTab.path ? { ...tab, language: nextLanguage } : tab)),
    )
  }, [activeTab])

  const commandItems = useMemo<CommandItem[]>(() => [
    {
      id: 'goto-line',
      label: 'Vai a riga',
      run: () => editorRefs.current[activePanelId]?.getAction('editor.action.gotoLine')?.run(),
    },
    {
      id: 'format-document',
      label: 'Formatta documento',
      run: () => editorRefs.current[activePanelId]?.getAction('editor.action.formatDocument')?.run(),
    },
    { id: 'change-language', label: 'Cambia linguaggio file', run: changeActiveLanguage },
    {
      id: 'split-editor',
      label: 'Dividi editor',
      run: () => {
        if (activePath) splitTabToRight(activePath, activePanelId, false)
      },
    },
    {
      id: 'close-tab',
      label: 'Chiudi tab',
      run: () => {
        if (activePath) closeTab(activePath)
      },
    },
    { id: 'close-all-tabs', label: 'Chiudi tutti i tab', run: closeAllTabs },
    { id: 'open-folder', label: 'Apri cartella', run: () => void openFolder() },
    {
      id: 'reveal-file',
      label: 'Rivela file in explorer',
      run: () => {
        if (activePath) setRevealPath(activePath.replace(/\/[^/]+$/, ''))
      },
    },
  ], [activePanelId, activePath, changeActiveLanguage, closeAllTabs, closeTab, openFolder, splitTabToRight])

  const commandResults = useMemo(() => {
    return commandItems
      .map((command) => ({ command, score: fuzzyScore(command.label, commandQuery) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label))
      .map((result) => result.command)
  }, [commandItems, commandQuery])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return

      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveFile()
      }

      if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        if (activePath) closeTab(activePath)
      }

      if (event.key.toLowerCase() === 'p') {
        event.preventDefault()
        if (event.shiftKey) {
          setIsCommandPaletteOpen(true)
          setCommandQuery('')
          setCommandIndex(0)
        } else {
          void openQuickOpen()
        }
      }

      if (event.key === '\\' && activePath) {
        event.preventDefault()
        splitTabToRight(activePath, activePanelId, false)
      }

      if (event.code === 'Semicolon' || event.key.toLowerCase() === 'ò') {
        event.preventDefault()
        toggleTerminalPanel()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activePanelId, activePath, closeTab, openQuickOpen, saveFile, splitTabToRight, toggleTerminalPanel])

  const handleEditorMount = (
    editor: Parameters<OnMount>[0],
    monaco: Monaco,
    panelId: string,
    tab: EditorTab,
  ) => {
    monacoRef.current = monaco
    editorRefs.current[panelId] = editor
    const model = ensureMonacoModel(tab.path, tab.content, tab.language)
    if (model) editor.setModel(model)

    const revealDefinitionAndOpen = () => {
      const beforeModel = editor.getModel()
      void editor.getAction('editor.action.revealDefinition')?.run()
      window.setTimeout(() => {
        const nextModel = editor.getModel()
        if (!nextModel || nextModel === beforeModel) return

        const fsPath = nextModel.uri.fsPath
        if (!fsPath || fsPath === tab.path) return

        void openFile(fsPath)
      }, 50)
    }

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
      void openQuickOpen()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => {
      setIsCommandPaletteOpen(true)
      setCommandQuery('')
      setCommandIndex(0)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backslash, () => {
      if (activePath) splitTabToRight(activePath, activePanelId, false)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => {
      editor.trigger('keyboard', 'undo', null)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
      void editor.getAction('editor.action.gotoLine')?.run()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
      void editor.getAction('editor.action.startFindReplaceAction')?.run()
    })
    editor.addCommand(monaco.KeyCode.F12, revealDefinitionAndOpen)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
      void editor.getAction('editor.action.addSelectionToNextFindMatch')?.run()
    })
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => {
      void editor.getAction('editor.action.moveLinesUpAction')?.run()
    })
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => {
      void editor.getAction('editor.action.moveLinesDownAction')?.run()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash, () => {
      void editor.getAction('editor.action.commentLine')?.run()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, () => {
      void editor.getAction('expandLineSelection')?.run()
    })
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
      void editor.getAction('editor.action.formatDocument')?.run()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, () => {
      editor.trigger('keyboard', 'redo', null)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.BracketLeft, () => {
      void editor.getAction('editor.fold')?.run()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.BracketRight, () => {
      void editor.getAction('editor.unfold')?.run()
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
      editor.trigger('keyboard', 'redo', null)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => {
      const model = editor.getModel()
      const selection = editor.getSelection()

      if (!model || !selection) return

      if (!selection.isEmpty()) {
        editor.trigger('keyboard', 'editor.action.clipboardCutAction', null)
        return
      }

      const lineNumber = selection.startLineNumber
      const isLastLine = lineNumber === model.getLineCount()
      const lineText = model.getLineContent(lineNumber)
      const textToCut = isLastLine ? lineText : `${lineText}${model.getEOL()}`
      const range = isLastLine
        ? new monaco.Range(lineNumber, 1, lineNumber, model.getLineMaxColumn(lineNumber))
        : new monaco.Range(lineNumber, 1, lineNumber + 1, 1)

      void navigator.clipboard.writeText(textToCut)
      editor.executeEdits('cut-line', [{ range, text: '' }])
      editor.setPosition({
        lineNumber: Math.min(lineNumber, model.getLineCount()),
        column: 1,
      })
    })

    editor.onKeyDown((event) => {
      if (!(event.ctrlKey || event.metaKey) || event.browserEvent.key.toLowerCase() !== 'f') return

      event.preventDefault()
      event.browserEvent.preventDefault()
      void editor.getAction('actions.find')?.run()
    })

    editor.onMouseDown((event) => {
      if (!event.event.ctrlKey || !event.target.position) return
      revealDefinitionAndOpen()
    })
  }

  const handleEditorChange = (path: string, value: string | undefined) => {
    const nextValue = value ?? ''
    const model = monacoRef.current?.editor.getModel(monacoRef.current.Uri.file(path))
    if (model && model.getValue() !== nextValue) model.setValue(nextValue)
    setTabs((prev) =>
      prev.map((tab) => (tab.path === path ? { ...tab, content: nextValue } : tab)),
    )
  }

  useEffect(() => {
    if (!autoSave || !activeTab || activeTab.content === activeTab.savedContent) return

    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = window.setTimeout(() => {
      void saveFile()
    }, 1000)

    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
    }
  }, [activeTab, autoSave, saveFile])

  const updateAutoSave = (nextAutoSave: boolean) => {
    setAutoSave(nextAutoSave)
    void window.api.saveEditorSetting('autoSave', String(nextAutoSave))
  }

  const updateTheme = (nextTheme: string) => {
    setTheme(nextTheme)
    monacoRef.current?.editor.setTheme(nextTheme)
    applyThemeCSSVars(nextTheme)
    void window.api.saveEditorSetting('theme', nextTheme)
  }

  // Listen for theme changes dispatched by StatusBar
  useEffect(() => {
    const handler = (e: Event) => {
      const themeId = (e as CustomEvent<string>).detail
      setTheme(themeId)
      monacoRef.current?.editor.setTheme(themeId)
    }
    window.addEventListener('strata:theme-change', handler)
    return () => window.removeEventListener('strata:theme-change', handler)
  }, [])

  const runSearch = async () => {
    const query = searchQuery.trim()
    if (!query) {
      setSearchResults([])
      return
    }

    setSearching(true)
    try {
      const results = await window.api.searchInFiles(workspacePath, query)
      setSearchResults(results)
    } catch (err) {
      console.error('Failed to search files:', err)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100" style={{ background: 'var(--strata-bg)', color: 'var(--strata-text)' }}>
      <div className="relative flex min-h-0 flex-1">
        {sidebarPreviewWidth !== null && (
          <div
            className="pointer-events-none absolute bottom-0 top-0 z-50 w-px bg-sky-500"
            style={{ left: sidebarPreviewWidth }}
          />
        )}
        {!hideSidebar && (
          <>
            <aside
              className="flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-900"
              style={{ width: sidebarWidth, background: 'var(--strata-sidebar)', borderColor: 'var(--strata-border)' }}
            >
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
                  onClick={() => setCreateCommand({ id: Date.now(), type: 'file' })}
                  className="rounded p-1 text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-100"
                >
                  <FilePlus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Nuova cartella"
                  onClick={() => setCreateCommand({ id: Date.now(), type: 'folder' })}
                  className="rounded p-1 text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-100"
                >
                  <FolderPlus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsSearchOpen(true)}
                  title="Cerca in tutti i file"
                  className="rounded p-1 text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-100"
                >
                  <Search className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <FileExplorer
                  workspacePath={workspacePath}
                  onFileSelect={openFile}
                  revealPath={revealPath}
                  createCommand={createCommand}
                />
              </div>
            </aside>
            <button
              type="button"
              aria-label="Ridimensiona sidebar"
              onDoubleClick={toggleSidebarWidth}
              onMouseDown={(event) => resizeSidebar(event.clientX)}
              className={`w-1 shrink-0 cursor-col-resize ${
                sidebarPreviewWidth !== null ? 'bg-sky-500' : 'bg-zinc-800 hover:bg-sky-600'
              }`}
            />
          </>
        )}

        <div ref={editorStackRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {terminalPreviewHeight !== null && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-50 h-px bg-sky-500"
              style={{ bottom: terminalPreviewHeight }}
            />
          )}
          <div ref={editorAreaRef} className="flex min-h-0 min-w-0 flex-1">
            {panels.map((panel, panelIndex) => {
              const panelTabs = panel.tabPaths
                .map((tabPath) => tabs.find((tab) => tab.path === tabPath))
                .filter((tab): tab is EditorTab => Boolean(tab))
              const panelActiveTab = tabs.find((tab) => tab.path === panel.activePath) ?? null

              return (
                <div key={panel.id} className="flex min-h-0 min-w-0" style={{ flexBasis: `${panel.width}%` }}>
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <TabBar
                      panelId={panel.id}
                      tabs={panelTabs}
                      activePath={panel.activePath}
                      onSelect={(path) => activateTab(panel.id, path)}
                      onClose={(path) => closeTab(path, panel.id)}
                      onDragStart={(panelId, path) => {
                        draggedTabRef.current = { panelId, path }
                      }}
                      onDragEnd={handleTabDragEnd}
                      onDropTab={moveDraggedTab}
                    />
                    {panelActiveTab && panel.id === activePanelId && !panelActiveTab.diff && (
                      <div className="flex h-7 shrink-0 items-center gap-1 overflow-hidden border-b border-zinc-800 bg-zinc-900/60 px-3 text-xs text-zinc-500">
                        {breadcrumbSegments.map((segment, index) => (
                          <span key={segment.fullPath} className="flex min-w-0 items-center gap-1">
                            {index > 0 && <span className="text-zinc-700">&gt;</span>}
                            <button
                              type="button"
                              onClick={() => {
                                const folderPath = segment.isFile
                                  ? segment.fullPath.replace(/\/[^/]+$/, '')
                                  : segment.fullPath
                                setRevealPath(folderPath)
                              }}
                              className={`truncate rounded px-1 py-0.5 hover:bg-zinc-800 hover:text-zinc-300 ${
                                segment.isFile ? 'text-zinc-400' : ''
                              }`}
                            >
                              {segment.label}
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {loading && panel.id === activePanelId ? (
                      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                        Caricamento file...
                      </div>
                    ) : panelActiveTab?.diff ? (
                      <DiffEditor
                        height="100%"
                        width="100%"
                        language={panelActiveTab.language}
                        original={panelActiveTab.diff.original}
                        modified={panelActiveTab.diff.modified}
                        theme={theme}
                        beforeMount={handleBeforeMount}
                        options={{
                          readOnly: true,
                          renderSideBySide: true,
                          minimap: { enabled: false },
                          fontSize: 14,
                          wordWrap: 'on',
                        }}
                      />
                    ) : panelActiveTab ? (
                      <Editor
                        height="100%"
                        width="100%"
                        path={panelActiveTab.path}
                        language={panelActiveTab.language}
                        value={panelActiveTab.content}
                        theme={theme}
                        beforeMount={handleBeforeMount}
                        onMount={(editor, monaco) => {
                          handleEditorMount(editor, monaco, panel.id, panelActiveTab)
                          editor.onDidFocusEditorWidget(() => activateTab(panel.id, panelActiveTab.path))
                        }}
                        onChange={(value) => handleEditorChange(panelActiveTab.path, value)}
                        options={{
                          minimap: { enabled: true, renderCharacters: false, maxColumn: 80 },
                          fontSize: 14,
                          wordWrap: 'on',
                          folding: true,
                          foldingStrategy: 'indentation',
                          stickyScroll: { enabled: true },
                        }}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                        Seleziona un file dall&apos;explorer
                      </div>
                    )}
                  </div>
                  {panelIndex < panels.length - 1 && (
                    <button
                      type="button"
                      aria-label="Ridimensiona split"
                      onMouseDown={(event) => resizePanels(panel.id, panels[panelIndex + 1].id, event.clientX)}
                      className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-sky-600"
                    />
                  )}
                </div>
              )
            })}
          </div>
          {isTerminalVisible && (
            <>
              <button
                type="button"
                aria-label="Ridimensiona terminale"
                onDoubleClick={toggleTerminalByHandle}
                onMouseDown={(event) => {
                  event.preventDefault()
                  resizeTerminal(event.clientY)
                }}
                className={`group flex h-[10px] shrink-0 cursor-row-resize items-center justify-center ${
                  terminalPreviewHeight !== null ? 'bg-sky-500' : 'bg-zinc-800 hover:bg-sky-600'
                }`}
              >
                <span className="h-px w-12 rounded bg-zinc-500 group-hover:bg-white" />
              </button>
              <div className="shrink-0 overflow-hidden" style={{ height: terminalHeight }}>
                <TerminalPanel workspacePath={workspacePath} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex h-6 shrink-0 items-center justify-end gap-3 border-t border-zinc-800 bg-zinc-900 px-3 text-[11px] text-zinc-400">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={autoSave}
            onChange={(event) => updateAutoSave(event.target.checked)}
          />
          Auto-save {autoSave ? 'on' : 'off'}
        </label>
        <label className="flex items-center gap-1.5">
          Tema
          <select
            value={theme}
            onChange={(event) => updateTheme(event.target.value)}
            className="rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-[11px] text-zinc-200 outline-none"
          >
            <optgroup label="Dark">
              {DARK_THEMES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </optgroup>
            <optgroup label="Light">
              {LIGHT_THEMES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>

      {isCommandPaletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 pt-24">
          <div className="flex max-h-[70vh] w-[min(720px,calc(100vw-32px))] flex-col rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl">
            <input
              autoFocus
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setIsCommandPaletteOpen(false)
                  return
                }

                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setCommandIndex((prev) =>
                    commandResults.length > 0 ? Math.min(prev + 1, commandResults.length - 1) : 0,
                  )
                  return
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setCommandIndex((prev) => Math.max(prev - 1, 0))
                  return
                }

                if (event.key === 'Enter') {
                  const command = commandResults[commandIndex]
                  if (!command) return

                  setIsCommandPaletteOpen(false)
                  command.run()
                }
              }}
              placeholder="Esegui comando"
              className="border-b border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            />
            <div className="min-h-0 overflow-y-auto py-1">
              {commandResults.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => {
                    setIsCommandPaletteOpen(false)
                    command.run()
                  }}
                  className={`block w-full px-4 py-2 text-left text-xs ${
                    index === commandIndex ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
                  }`}
                >
                  {command.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isQuickOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 pt-24">
          <div className="flex max-h-[70vh] w-[min(720px,calc(100vw-32px))] flex-col rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl">
            <input
              autoFocus
              value={quickOpenQuery}
              onChange={(event) => setQuickOpenQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setIsQuickOpen(false)
                  return
                }

                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setQuickOpenIndex((prev) =>
                    quickOpenResults.length > 0 ? Math.min(prev + 1, quickOpenResults.length - 1) : 0,
                  )
                  return
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setQuickOpenIndex((prev) => Math.max(prev - 1, 0))
                  return
                }

                if (event.key === 'Enter') {
                  const file = quickOpenResults[quickOpenIndex]
                  if (!file) return

                  setIsQuickOpen(false)
                  void openFile(file.path)
                }
              }}
              placeholder="Apri file"
              className="border-b border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            />
            <div className="min-h-0 overflow-y-auto py-1">
              {quickOpenResults.length > 0 ? (
                quickOpenResults.map((file, index) => {
                  const { Icon, colorClass } = getFileIconMeta(file.name)

                  return (
                    <button
                      key={file.path}
                      type="button"
                      title={file.path}
                      onMouseEnter={() => setQuickOpenIndex(index)}
                      onClick={() => {
                        setIsQuickOpen(false)
                        void openFile(file.path)
                      }}
                      className={`flex w-full items-center gap-2 px-4 py-2 text-left text-xs ${
                        index === quickOpenIndex ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
                      }`}
                    >
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${colorClass}`} />
                      <span className="min-w-0 flex-1 truncate">{file.relativePath}</span>
                    </button>
                  )
                })
              ) : (
                <p className="px-4 py-3 text-xs text-zinc-500">Nessun file trovato</p>
              )}
            </div>
          </div>
        </div>
      )}

      {isSearchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-20">
          <div className="flex max-h-[70vh] w-[min(720px,calc(100vw-32px))] flex-col rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
              <Search className="h-4 w-4 text-zinc-400" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runSearch()
                  if (event.key === 'Escape') setIsSearchOpen(false)
                }}
                placeholder="Cerca in tutti i file"
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={() => void runSearch()}
                className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-100 transition hover:bg-zinc-600"
              >
                Cerca
              </button>
              <button
                type="button"
                onClick={() => setIsSearchOpen(false)}
                aria-label="Chiudi ricerca"
                className="rounded p-1 text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 overflow-y-auto py-1">
              {searching ? (
                <p className="px-3 py-3 text-xs text-zinc-500">Ricerca...</p>
              ) : searchResults.length > 0 ? (
                searchResults.map((result) => (
                  <button
                    key={`${result.filePath}:${result.line}:${result.preview}`}
                    type="button"
                    title={result.filePath}
                    onClick={() => {
                      setIsSearchOpen(false)
                      void openFile(result.filePath)
                    }}
                    className="block w-full px-3 py-2 text-left text-xs hover:bg-zinc-800"
                  >
                    <div className="flex items-center gap-2 text-zinc-200">
                      <span className="truncate font-medium">{result.fileName}</span>
                      <span className="shrink-0 text-zinc-500">riga {result.line}</span>
                    </div>
                    <div className="mt-0.5 truncate text-zinc-400">{result.preview}</div>
                  </button>
                ))
              ) : (
                <p className="px-3 py-3 text-xs text-zinc-500">Nessun risultato</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export default IDEPanel
