import { ipcMain } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { getActiveWorkspaceRoot } from '../environment'
import { assertWithinWorkspace } from '../utils/pathGuard'

export function registerEditorIpc(): void {

  ipcMain.handle('editor:readFile', async (_event, filePath: string) => {
    assertWithinWorkspace(getActiveWorkspaceRoot(), filePath)
    const content = await fs.readFile(filePath, 'utf-8')
    const ext = path.extname(filePath).slice(1)
    return { content, language: extToLanguage(ext) }
  })

  ipcMain.handle('editor:writeFile', async (_event, filePath: string, content: string) => {
    assertWithinWorkspace(getActiveWorkspaceRoot(), filePath)
    await fs.writeFile(filePath, content, 'utf-8')
    return true
  })
}

function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    json: 'json', html: 'html',
    css: 'css', scss: 'scss',
    md: 'markdown', py: 'python',
    rs: 'rust', go: 'go',
    java: 'java', cpp: 'cpp',
    c: 'c', sh: 'shell',
    sql: 'sql', yaml: 'yaml', yml: 'yaml'
  }
  return map[ext] ?? 'plaintext'
}
