import { Columns2, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import 'xterm/css/xterm.css'

type ShellOption = {
  id: string
  label: string
}

type TerminalSession = {
  id: string
  name: string
  shellId: string
  shellLabel: string
  pane: 0 | 1
}

type TerminalInstance = {
  terminal: Terminal
  fitAddon: FitAddon
  disposeInput: { dispose: () => void }
  resizeObserver: ResizeObserver
  disposeResize: () => void
}

type TerminalPanelProps = {
  workspacePath?: string
}

const terminalTheme = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#ffffff',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
}

export default function TerminalPanel({ workspacePath }: TerminalPanelProps) {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeByPane, setActiveByPane] = useState<Record<0 | 1, string | null>>({ 0: null, 1: null })
  const [activePane, setActivePane] = useState<0 | 1>(0)
  const [shells, setShells] = useState<ShellOption[]>([])
  const [preferredShell, setPreferredShell] = useState<string | null>(null)
  const [selectedShellId, setSelectedShellId] = useState<string | null>(null)
  const [isShellMenuOpen, setShellMenuOpen] = useState(false)
  const [isSplit, setSplit] = useState(false)
  const [leftWidth, setLeftWidth] = useState(50)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const containersRef = useRef<Record<string, HTMLDivElement | null>>({})
  const instancesRef = useRef<Record<string, TerminalInstance>>({})
  const countersRef = useRef<Record<string, number>>({})
  const didCreateInitialTerminalRef = useRef(false)

  const visiblePanes = useMemo<0[] | [0, 1]>(() => (isSplit ? [0, 1] : [0]), [isSplit])

  const fitAndResize = useCallback((terminalId: string) => {
    const instance = instancesRef.current[terminalId]
    if (!instance) return

    instance.fitAddon.fit()
    void window.api.terminal.resize(terminalId, instance.terminal.cols, instance.terminal.rows)
  }, [])

  const attachTerminal = useCallback(
    (session: TerminalSession, container: HTMLDivElement) => {
      if (instancesRef.current[session.id]) return

      const initialize = () => {
        if (instancesRef.current[session.id]) return
        if (container.offsetWidth === 0 || container.offsetHeight === 0) return

        const terminal = new Terminal({
          fontFamily: 'Cascadia Code, Fira Code, Consolas, monospace',
          fontSize: 13,
          theme: terminalTheme,
          cursorBlink: true,
          cursorStyle: 'block',
          scrollback: 5000,
        })
        const fitAddon = new FitAddon()
        const webLinksAddon = new WebLinksAddon()

        terminal.loadAddon(fitAddon)
        terminal.loadAddon(webLinksAddon)
        terminal.open(container)

        const disposeInput = terminal.onData((data) => {
          void window.api.terminal.input(session.id, data)
        })
        const resizeObserver = new ResizeObserver(() => {
          if (container.offsetWidth > 0 && container.offsetHeight > 0) fitAndResize(session.id)
        })
        const onWindowResize = () => fitAndResize(session.id)

        resizeObserver.observe(container)
        window.addEventListener('resize', onWindowResize)

        instancesRef.current[session.id] = {
          terminal,
          fitAddon,
          disposeInput,
          resizeObserver,
          disposeResize: () => window.removeEventListener('resize', onWindowResize),
        }
        window.setTimeout(() => fitAndResize(session.id), 0)
      }

      const waitForSizeObserver = new ResizeObserver(() => {
        if (container.offsetWidth === 0 || container.offsetHeight === 0) return
        waitForSizeObserver.disconnect()
        initialize()
      })

      waitForSizeObserver.observe(container)
      window.setTimeout(() => {
        waitForSizeObserver.disconnect()
        initialize()
      }, 50)
    },
    [fitAndResize],
  )

  const createTerminalForShell = useCallback(
    async (selectedShell: ShellOption, pane: 0 | 1) => {
      if (!selectedShell) return

      await window.api.terminal.setPreferredShell(selectedShell.id)
      setPreferredShell(selectedShell.id)
      setSelectedShellId(selectedShell.id)
      countersRef.current[selectedShell.id] = (countersRef.current[selectedShell.id] ?? 0) + 1

      const id = await window.api.terminal.create(selectedShell.id, workspacePath)
      const nextSession: TerminalSession = {
        id,
        shellId: selectedShell.id,
        shellLabel: selectedShell.label.toLowerCase(),
        name: `${selectedShell.label.toLowerCase()} ${countersRef.current[selectedShell.id]}`,
        pane,
      }

      setSessions((prev) => [...prev, nextSession])
      setActiveByPane((prev) => ({ ...prev, [pane]: id }))
      setActivePane(pane)
      setShellMenuOpen(false)
    },
    [workspacePath],
  )

  const createTerminal = useCallback(
    async (shellId?: string, pane: 0 | 1 = activePane) => {
      const selectedShell = shells.find((shell) => shell.id === (shellId ?? preferredShell)) ?? shells[0]
      if (!selectedShell) return
      await createTerminalForShell(selectedShell, pane)
    },
    [activePane, createTerminalForShell, preferredShell, shells],
  )

  const closeTerminal = useCallback((terminalId: string) => {
    const instance = instancesRef.current[terminalId]
    if (instance) {
      instance.resizeObserver.disconnect()
      instance.disposeResize()
      instance.disposeInput.dispose()
      instance.terminal.dispose()
      delete instancesRef.current[terminalId]
    }

    void window.api.terminal.kill(terminalId)
    setSessions((prev) => {
      const session = prev.find((item) => item.id === terminalId)
      const nextSessions = prev.filter((item) => item.id !== terminalId)

      if (session) {
        setActiveByPane((current) => {
          if (current[session.pane] !== terminalId) return current
          return {
            ...current,
            [session.pane]: nextSessions.find((item) => item.pane === session.pane)?.id ?? null,
          }
        })

        if (session.pane === 1 && !nextSessions.some((item) => item.pane === 1)) setSplit(false)
      }

      return nextSessions
    })
  }, [])

  const splitTerminal = useCallback(() => {
    if (isSplit) return
    setSplit(true)
    void createTerminal(preferredShell ?? undefined, 1)
  }, [createTerminal, isSplit, preferredShell])

  const resizeSplit = useCallback((startX: number) => {
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    const startWidth = leftWidth

    const onMouseMove = (event: MouseEvent) => {
      const delta = ((event.clientX - startX) / rect.width) * 100
      setLeftWidth(Math.max(20, Math.min(80, startWidth + delta)))
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [leftWidth])

  useEffect(() => {
    let isCancelled = false

    const loadShells = async () => {
      const [availableShells, preferred] = await Promise.all([
        window.api.terminal.getShells(),
        window.api.terminal.getPreferredShell(),
      ])

      if (isCancelled) return
      setShells(availableShells)
      setPreferredShell(preferred)
      if (availableShells.length > 0) {
        const shellId = availableShells.some((shell) => shell.id === preferred)
          ? preferred
          : availableShells[0].id
        setSelectedShellId(shellId)
        const shell = availableShells.find((option) => option.id === shellId) ?? availableShells[0]
        if (!didCreateInitialTerminalRef.current) {
          didCreateInitialTerminalRef.current = true
          await createTerminalForShell(shell, 0)
        }
      }
    }

    void loadShells()
    return () => {
      isCancelled = true
    }
  }, [createTerminalForShell])

  useEffect(() => {
    const unsubscribe = window.api.terminal.onData(({ terminalId, data }) => {
      instancesRef.current[terminalId]?.terminal.write(data)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    for (const terminalId of Object.values(activeByPane)) {
      if (terminalId) window.setTimeout(() => fitAndResize(terminalId), 0)
    }
  }, [activeByPane, fitAndResize, isSplit, leftWidth])

  useEffect(() => {
    const instances = instancesRef.current

    return () => {
      for (const terminalId of Object.keys(instances)) {
        const instance = instances[terminalId]
        instance.resizeObserver.disconnect()
        instance.disposeResize()
        instance.disposeInput.dispose()
        instance.terminal.dispose()
        void window.api.terminal.kill(terminalId)
      }
    }
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1e1e1e] text-zinc-200">
      <div className="flex h-[35px] shrink-0 items-center border-b border-zinc-800 bg-[#1e1e1e]">
        <div className="flex h-full shrink-0 items-center border-r border-zinc-800 px-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Terminali
        </div>
        <div className="tabbar-scroll flex min-w-0 flex-1 overflow-x-auto">
          {sessions.map((session) => {
            const isActive = activeByPane[session.pane] === session.id

            return (
              <div
                key={session.id}
                className={`flex h-[35px] min-w-[130px] items-center gap-2 border-r border-zinc-800 px-3 text-xs ${
                  isActive ? 'bg-[#2d2d2d] text-[#cccccc]' : 'text-zinc-500'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveByPane((prev) => ({ ...prev, [session.pane]: session.id }))
                    setActivePane(session.pane)
                  }}
                  className="min-w-0 flex-1 truncate text-left"
                >
                  {session.name}
                </button>
                <button
                  type="button"
                  aria-label={`Chiudi ${session.name}`}
                  onClick={() => closeTerminal(session.id)}
                  className="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1 px-2">
          <select
            value={selectedShellId ?? preferredShell ?? shells[0]?.id ?? ''}
            onChange={(event) => setSelectedShellId(event.target.value)}
            className="h-6 max-w-32 rounded border border-zinc-700 bg-[#252526] px-1 text-[11px] text-[#cccccc] outline-none"
          >
            {shells.map((shell) => (
              <option key={shell.id} value={shell.id}>
                {shell.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="Nuovo terminale"
            onClick={() => void createTerminal(selectedShellId ?? preferredShell ?? undefined, activePane)}
            className="h-6 rounded bg-[#2d2d2d] px-2 text-[11px] text-[#cccccc] hover:bg-zinc-700"
          >
            + Nuovo
          </button>
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            title="Scegli shell"
            onClick={() => setShellMenuOpen((prev) => !prev)}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
          >
            <Plus className="h-4 w-4" />
          </button>
          {isShellMenuOpen && (
            <div className="absolute right-0 top-8 z-50 min-w-36 rounded-md border border-zinc-700 bg-zinc-900 py-1 text-xs shadow-xl">
              {shells.map((shell) => (
                <button
                  key={shell.id}
                  type="button"
                  onClick={() => {
                    setSelectedShellId(shell.id)
                    void createTerminal(shell.id, activePane)
                  }}
                  className="block w-full px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-800"
                >
                  Nuova {shell.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          title="Split terminale"
          onClick={splitTerminal}
          disabled={isSplit}
          className="mr-2 flex h-6 items-center gap-1 rounded bg-[#2d2d2d] px-2 text-[11px] text-[#cccccc] hover:bg-zinc-700 disabled:opacity-40"
        >
          <Columns2 className="h-4 w-4" />
          Split
        </button>
      </div>

      <div ref={panelRef} className="flex min-h-0 flex-1">
        {visiblePanes.map((pane, paneIndex) => {
          const activeId = activeByPane[pane]
          const paneSessions = sessions.filter((session) => session.pane === pane)
          const width = isSplit ? (pane === 0 ? leftWidth : 100 - leftWidth) : 100

          return (
            <div key={pane} className="flex min-h-0 overflow-hidden" style={{ flexBasis: `${width}%` }}>
              <div className="relative h-full min-h-0 w-full flex-1 overflow-hidden">
                {paneSessions.map((session) => (
                  <div
                    key={session.id}
                    ref={(node) => {
                      containersRef.current[session.id] = node
                      if (node) attachTerminal(session, node)
                    }}
                    className={`absolute inset-[10px] h-[calc(100%-20px)] w-[calc(100%-20px)] overflow-hidden p-2 ${
                      session.id === activeId ? 'block' : 'hidden'
                    }`}
                  />
                ))}
              </div>
              {paneIndex === 0 && isSplit && (
                <button
                  type="button"
                  aria-label="Ridimensiona terminali"
                  onMouseDown={(event) => resizeSplit(event.clientX)}
                  className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-sky-600"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
