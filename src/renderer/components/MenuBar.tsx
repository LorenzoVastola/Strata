import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'

type ActivePanel = 'ide' | 'git' | 'db' | 'http' | 'terminal'

type ActionItem = {
  kind: 'action'
  label: string
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  action: () => void
}
type SeparatorItem = { kind: 'separator' }
type SubmenuItem = {
  kind: 'submenu'
  label: string
  disabled?: boolean
  items: MenuItem[]
}
type MenuItem = ActionItem | SeparatorItem | SubmenuItem

type MenuDef = { label: string; items: MenuItem[] }

type Props = {
  workspacePath: string | null
  activePanel: ActivePanel
  onSelectPanel: (panel: ActivePanel) => void
  onOpenWorkspace: (path: string, name: string) => void
  aiOpen: boolean
  onToggleAI: () => void
}

function MenuDropdown({
  items,
  onClose,
  nested,
}: {
  items: MenuItem[]
  onClose: () => void
  nested?: boolean
}) {
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null)

  return (
    <div
      className={`absolute z-50 min-w-44 overflow-hidden rounded border py-1 shadow-xl ${nested ? 'left-full top-0' : 'top-full left-0'}`}
      style={{ background: 'var(--strata-sidebar)', borderColor: 'var(--strata-border)' }}
    >
      {items.map((item, i) => {
        if (item.kind === 'separator') {
          return <div key={i} className="my-1 border-t" style={{ borderColor: 'var(--strata-border)' }} />
        }
        if (item.kind === 'submenu') {
          return (
            <div
              key={i}
              className={`relative flex cursor-pointer items-center justify-between gap-6 px-3 py-1.5 text-sm ${
                item.disabled
                  ? 'cursor-not-allowed text-zinc-600'
                  : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
              }`}
              onMouseEnter={() => !item.disabled && setOpenSubmenu(i)}
              onMouseLeave={() => setOpenSubmenu(null)}
            >
              <span>{item.label}</span>
              <ChevronRight className="h-3 w-3 text-zinc-500" />
              {openSubmenu === i && !item.disabled && (
                <MenuDropdown items={item.items} onClose={onClose} nested />
              )}
            </div>
          )
        }
        return (
          <button
            key={i}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                item.action()
                onClose()
              }
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
              item.disabled
                ? 'cursor-not-allowed text-zinc-600'
                : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
            }`}
          >
            <span className="w-3.5 shrink-0">
              {item.checked && <Check className="h-3.5 w-3.5 text-zinc-300" />}
            </span>
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="ml-4 shrink-0 text-xs text-zinc-500">{item.shortcut}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function MenuBar({
  workspacePath,
  activePanel,
  onSelectPanel,
  onOpenWorkspace,
  aiOpen,
  onToggleAI,
}: Props) {
  const [openMenu, setOpenMenu] = useState<number | null>(null)
  const [recentWorkspaces, setRecentWorkspaces] = useState<{ path: string; name: string }[]>([])
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    const onMouseDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [])

  const loadRecent = async () => {
    try {
      const recents = await window.api.getRecentWorkspaces()
      setRecentWorkspaces(recents.map((r) => ({ path: r.path, name: r.name })))
    } catch {
      setRecentWorkspaces([])
    }
  }

  const openFolder = async () => {
    const result = await window.api.openFolder()
    if (result) onOpenWorkspace(result.path, result.name)
  }

  const menus: MenuDef[] = [
    {
      label: 'File',
      items: [
        { kind: 'action', label: 'Apri cartella…', shortcut: 'Ctrl+O', action: openFolder },
        {
          kind: 'submenu',
          label: 'Cartelle recenti',
          disabled: recentWorkspaces.length === 0,
          items: recentWorkspaces.map((r) => ({
            kind: 'action' as const,
            label: r.name,
            action: () => onOpenWorkspace(r.path, r.name),
          })),
        },
        { kind: 'separator' },
        {
          kind: 'action',
          label: 'Chiudi cartella',
          disabled: !workspacePath,
          action: () => {
            window.location.reload()
          },
        },
      ],
    },
    {
      label: 'Vista',
      items: [
        {
          kind: 'action',
          label: 'Editor',
          disabled: !workspacePath,
          checked: activePanel === 'ide',
          action: () => onSelectPanel('ide'),
        },
        {
          kind: 'action',
          label: 'Git',
          disabled: !workspacePath,
          checked: activePanel === 'git',
          action: () => onSelectPanel('git'),
        },
        { kind: 'separator' },
        {
          kind: 'action',
          label: 'Database',
          checked: activePanel === 'db',
          action: () => onSelectPanel('db'),
        },
        {
          kind: 'action',
          label: 'HTTP',
          checked: activePanel === 'http',
          action: () => onSelectPanel('http'),
        },
        {
          kind: 'action',
          label: 'Terminale',
          checked: activePanel === 'terminal',
          action: () => onSelectPanel('terminal'),
        },
        { kind: 'separator' },
        {
          kind: 'action',
          label: 'AI Assistant',
          shortcut: 'Ctrl+L',
          checked: aiOpen,
          action: onToggleAI,
        },
      ],
    },
    {
      label: 'Aiuto',
      items: [
        {
          kind: 'action',
          label: 'Scorciatoie da tastiera',
          action: () => {
            // placeholder — potrà aprire un modal shortcuts in futuro
          },
        },
      ],
    },
  ]

  const toggle = (index: number) => {
    if (openMenu === index) {
      setOpenMenu(null)
    } else {
      if (index === 0) void loadRecent()
      setOpenMenu(index)
    }
  }

  const switchTo = (index: number) => {
    if (openMenu !== null && openMenu !== index) {
      if (index === 0) void loadRecent()
      setOpenMenu(index)
    }
  }

  return (
    <div
      ref={barRef}
      className="flex h-8 shrink-0 items-center gap-0.5 px-1 text-sm select-none"
      style={{ background: 'var(--strata-sidebar)', borderBottom: '1px solid var(--strata-border)' }}
    >
      {menus.map((menu, i) => (
        <div key={menu.label} className="relative">
          <button
            type="button"
            onClick={() => toggle(i)}
            onMouseEnter={() => switchTo(i)}
            className={`rounded px-2.5 py-0.5 text-zinc-300 transition hover:bg-zinc-700 hover:text-white ${
              openMenu === i ? 'bg-zinc-700 text-white' : ''
            }`}
          >
            {menu.label}
          </button>
          {openMenu === i && (
            <MenuDropdown items={menu.items} onClose={() => setOpenMenu(null)} />
          )}
        </div>
      ))}
    </div>
  )
}
