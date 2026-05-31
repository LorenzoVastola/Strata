import {
  Braces,
  Code2,
  File,
  FileCode,
  FileCog,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Hash,
} from 'lucide-react'
import type { ComponentType } from 'react'

type IconMeta = {
  Icon: ComponentType<{ className?: string }>
  colorClass: string
}

const getExtension = (name: string) => {
  const normalizedName = name.toLowerCase()
  if (normalizedName === '.env' || normalizedName.endsWith('.env')) return 'env'
  if (normalizedName === '.gitignore') return 'gitignore'

  return normalizedName.split('.').pop() ?? ''
}

export const getFileIconMeta = (name: string, language?: string): IconMeta => {
  const ext = getExtension(name)

  if (ext === 'ts' || ext === 'tsx') return { Icon: FileCode, colorClass: 'text-sky-400' }
  if (ext === 'js' || ext === 'jsx') return { Icon: FileCode, colorClass: 'text-yellow-300' }
  if (ext === 'json' || language === 'json') return { Icon: FileJson, colorClass: 'text-orange-400' }
  if (ext === 'md' || language === 'markdown') return { Icon: FileText, colorClass: 'text-zinc-100' }
  if (ext === 'css' || ext === 'scss') return { Icon: Hash, colorClass: 'text-violet-400' }
  if (ext === 'html') return { Icon: Code2, colorClass: 'text-orange-600' }
  if (ext === 'env') return { Icon: FileCog, colorClass: 'text-zinc-300' }
  if (ext === 'gitignore') return { Icon: File, colorClass: 'text-zinc-500' }
  if (language && language !== 'plaintext') return { Icon: Braces, colorClass: 'text-sky-300' }

  return { Icon: File, colorClass: 'text-zinc-500' }
}

export const getFolderIconMeta = (isOpen: boolean): IconMeta => ({
  Icon: isOpen ? FolderOpen : Folder,
  colorClass: 'text-[#dcb67a]',
})
