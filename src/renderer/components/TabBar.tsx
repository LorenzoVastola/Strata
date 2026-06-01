import { X } from 'lucide-react'
import { getFileIconMeta } from '../utils/fileIcons'

export type EditorTab = {
  path: string
  name: string
  content: string
  savedContent: string
  language: string
  /** If present, the tab shows a Monaco DiffEditor (read-only) */
  diff?: { original: string; modified: string }
  /** Real file path used for icon lookup on diff tabs */
  iconPath?: string
}

type TabBarProps = {
  panelId: string
  tabs: EditorTab[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onDragStart: (panelId: string, path: string) => void
  onDragEnd: (path: string, clientX: number) => void
  onDropTab: (panelId: string, insertIndex: number) => void
}

export default function TabBar({
  panelId,
  tabs,
  activePath,
  onSelect,
  onClose,
  onDragStart,
  onDragEnd,
  onDropTab,
}: TabBarProps) {
  return (
    <div
      className="tabbar-scroll flex h-9 shrink-0 overflow-x-auto border-b border-zinc-800 bg-zinc-950"
      style={{ background: 'var(--strata-tab-bar)', borderColor: 'var(--strata-border)' }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        onDropTab(panelId, tabs.length)
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.path === activePath
        const isModified = tab.content !== tab.savedContent
        const { Icon, colorClass } = getFileIconMeta(tab.iconPath ?? tab.name, tab.language)

        return (
          <div
            key={tab.path}
            title={tab.path}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', tab.path)
              onDragStart(panelId, tab.path)
            }}
            onDragEnd={(event) => onDragEnd(tab.path, event.clientX)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onDropTab(panelId, tabs.findIndex((item) => item.path === tab.path))
            }}
            onMouseDown={(event) => {
              if (event.button !== 1) return

              event.preventDefault()
              onClose(tab.path)
            }}
            className={`group flex h-9 min-w-[120px] flex-1 items-center gap-2 border-r border-zinc-800 px-3 text-left text-xs transition ${
              isActive
                ? 'bg-zinc-900 text-zinc-100'
                : 'bg-transparent text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-300'
            }`}
            style={isActive
              ? { background: 'var(--strata-tab-active)', color: 'var(--strata-text)', borderColor: 'var(--strata-border)' }
              : { borderColor: 'var(--strata-border)' }
            }
          >
            {tab.diff
              ? <span className="text-[10px] font-bold text-amber-400 shrink-0 w-3.5 text-center">M</span>
              : <Icon className={`h-3.5 w-3.5 shrink-0 ${colorClass}`} />}
            <button
              type="button"
              onClick={() => onSelect(tab.path)}
              className="min-w-0 flex-1 truncate text-left"
            >
              {tab.name}
            </button>
            {isModified ? (
              <span
                aria-label={`${tab.name} modificato`}
                className="h-2 w-2 shrink-0 rounded-full bg-white"
              />
            ) : (
              <button
                type="button"
                aria-label={`Chiudi ${tab.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(tab.path)
                }}
                className="rounded p-0.5 text-zinc-500 opacity-70 transition hover:bg-zinc-700 hover:text-zinc-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
