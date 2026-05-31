import { ipcMain, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { getDb } from '../storage/db'

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
    const db = getDb()
    db.prepare(`
      INSERT INTO workspaces (path, name, last_opened)
      VALUES (?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET last_opened = excluded.last_opened
    `).run(fullPath, name, new Date().toISOString())
    return { path: fullPath, name }
  })
}
