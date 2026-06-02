import { app, BrowserWindow, Menu } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDb } from './storage/db'
import { registerWorkspaceIpc } from './ipc/workspace'
import { registerEditorIpc } from './ipc/editor'
import { registerTerminalIpc } from './ipc/terminal'
import { registerDatabaseIpc } from './ipc/database'
import { registerHttpIpc } from './ipc/http'
import { registerGitIpc } from './ipc/git'
import { registerAiIpc } from './ipc/ai'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function createWindow(): BrowserWindow {
  const iconPath = app.isPackaged
    ? process.platform === 'darwin'
      ? path.join(process.resourcesPath, 'icons/mac/icon.icns')
      : path.join(process.resourcesPath, 'icons/win/icon.ico')
    : process.platform === 'darwin'
      ? path.join(__dirname, '../build/icons/mac/icon.icns')
      : path.join(__dirname, '../build/icons/win/icon.ico')

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#09090b',
    icon: iconPath,
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
  registerHttpIpc()
  registerGitIpc()
  const win = createWindow()
  registerAiIpc(win.webContents)
  registerTerminalIpc(win)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
