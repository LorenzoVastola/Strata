import { app, BrowserWindow, Menu } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDb } from './storage/db'
import { registerWorkspaceIpc } from './ipc/workspace'
import { registerEditorIpc } from './ipc/editor'
import { registerTerminalIpc } from './ipc/terminal'
import { registerDatabaseIpc } from './ipc/database'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'index.mjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  Menu.setApplicationMenu(null)
  win.webContents.on('before-input-event', (event, input) => {
    if (!input.control || !input.shift || input.key.toLowerCase() !== 'i') return

    event.preventDefault()
    win.webContents.toggleDevTools()
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  initDb()
  registerWorkspaceIpc()
  registerEditorIpc()
  registerDatabaseIpc()
  const win = createWindow()
  registerTerminalIpc(win)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
