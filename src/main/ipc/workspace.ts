import { ipcMain, dialog, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { getDb } from '../storage/db'

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

type EditorSettings = {
  autoSave: boolean
  theme: string
  sidebarWidth: number
  terminalHeight: number
}

const ignoredSearchDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.vite',
])

const walkFiles = async (rootPath: string): Promise<WorkspaceFile[]> => {
  const files: WorkspaceFile[] = []

  const visitDir = async (dirPath: string) => {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        if (!ignoredSearchDirs.has(entry.name)) await visitDir(fullPath)
        continue
      }

      if (!entry.isFile()) continue

      files.push({
        path: fullPath,
        name: entry.name,
        relativePath: path.relative(rootPath, fullPath),
      })
    }
  }

  await visitDir(rootPath)
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export function registerWorkspaceIpc(): void {

  ipcMain.handle('workspace:openFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null

    const folderPath = result.filePaths[0]
    const name = path.basename(folderPath)
    const db = getDb()

    db.prepare(`
      INSERT INTO workspaces (path, name, last_opened)
      VALUES (?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET last_opened = excluded.last_opened
    `).run(folderPath, name, new Date().toISOString())

    return { path: folderPath, name }
  })

  ipcMain.handle('workspace:getRecent', () => {
    const db = getDb()
    return db.prepare(`
      SELECT * FROM workspaces ORDER BY last_opened DESC LIMIT 10
    `).all()
  })

  ipcMain.handle('workspace:readDir', (_event, dirPath: string) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    return entries.map(e => ({
      name: e.name,
      path: path.join(dirPath, e.name),
      isDirectory: e.isDirectory()
    }))
  })

  ipcMain.handle('workspace:createFolder', async (_event, folderPath: string, name: string) => {
    const fullPath = path.join(folderPath, name)
    await fs.promises.mkdir(fullPath, { recursive: true })
    return { path: fullPath, name }
  })

  ipcMain.handle('workspace:createFile', async (_event, folderPath: string, name: string) => {
    const fullPath = path.join(folderPath, name)
    await fs.promises.writeFile(fullPath, '', { flag: 'wx' })
    return { path: fullPath, name }
  })

  ipcMain.handle('workspace:renamePath', async (_event, targetPath: string, name: string) => {
    const nextPath = path.join(path.dirname(targetPath), name)
    await fs.promises.rename(targetPath, nextPath)
    return { path: nextPath, name, isDirectory: fs.statSync(nextPath).isDirectory() }
  })

  ipcMain.handle('workspace:deletePath', async (_event, targetPath: string) => {
    await fs.promises.rm(targetPath, { recursive: true, force: true })
    return true
  })

  ipcMain.handle('workspace:revealPath', async (_event, targetPath: string) => {
    const stat = await fs.promises.stat(targetPath)
    const folderPath = stat.isDirectory() ? targetPath : path.dirname(targetPath)
    await shell.openPath(folderPath)
    return true
  })

  ipcMain.handle('workspace:searchInFiles', async (_event, workspacePath: string, query: string) => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) return []

    const results: SearchResult[] = []
    const queryLower = trimmedQuery.toLowerCase()

    const visitDir = async (dirPath: string) => {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)

        if (entry.isDirectory()) {
          if (!ignoredSearchDirs.has(entry.name)) await visitDir(fullPath)
          continue
        }

        if (!entry.isFile()) continue

        try {
          const stat = await fs.promises.stat(fullPath)
          if (stat.size > 2 * 1024 * 1024) continue

          const content = await fs.promises.readFile(fullPath, 'utf-8')
          const lines = content.split(/\r?\n/)

          lines.forEach((lineText, index) => {
            if (!lineText.toLowerCase().includes(queryLower)) return

            results.push({
              filePath: fullPath,
              fileName: path.basename(fullPath),
              line: index + 1,
              preview: lineText.trim(),
            })
          })
        } catch {
          // Ignore binary, locked, or unreadable files during workspace search.
        }
      }
    }

    await visitDir(workspacePath)
    return results
  })

  ipcMain.handle('workspace:getFiles', async (_event, workspacePath: string) => {
    return walkFiles(workspacePath)
  })

  ipcMain.handle('workspace:getEditorState', () => {
    const db = getDb()
    db.prepare(`
      CREATE TABLE IF NOT EXISTS editor_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        open_tabs TEXT NOT NULL DEFAULT '[]',
        active_tab TEXT
      )
    `).run()
    db.prepare(`
      INSERT OR IGNORE INTO editor_state (id, open_tabs, active_tab) VALUES (1, '[]', NULL)
    `).run()

    return db.prepare(`
      SELECT open_tabs, active_tab FROM editor_state WHERE id = 1
    `).get()
  })

  ipcMain.handle('workspace:saveEditorState', (_event, openTabs: string[], activeTab: string | null) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO editor_state (id, open_tabs, active_tab)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        open_tabs = excluded.open_tabs,
        active_tab = excluded.active_tab
    `).run(JSON.stringify(openTabs), activeTab)

    return true
  })

  ipcMain.handle('workspace:getEditorSettings', () => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT key, value FROM app_settings WHERE key IN ('autoSave', 'theme', 'sidebarWidth', 'terminalHeight')
    `).all() as { key: string; value: string }[]
    const settings: EditorSettings = {
      autoSave: false,
      theme: 'vs-dark',
      sidebarWidth: 240,
      terminalHeight: 220,
    }

    for (const row of rows) {
      if (row.key === 'autoSave') settings.autoSave = row.value === 'true'
      if (row.key === 'theme') settings.theme = row.value
      if (row.key === 'sidebarWidth') {
        const width = Number.parseInt(row.value, 10)
        if (Number.isFinite(width)) settings.sidebarWidth = width
      }
      if (row.key === 'terminalHeight') {
        const height = Number.parseInt(row.value, 10)
        if (Number.isFinite(height)) settings.terminalHeight = height
      }
    }

    return settings
  })

  ipcMain.handle('workspace:saveEditorSetting', (_event, key: keyof EditorSettings, value: string) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)

    return true
  })
}
