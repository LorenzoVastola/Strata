import { BrowserWindow, ipcMain } from 'electron'
import fs from 'fs'
import pty, { type IPty } from 'node-pty'
import path from 'path'
import { getDb } from '../storage/db'

const terminals = new Map<string, IPty>()
let terminalCounter = 0

type ShellOption = {
  id: string
  label: string
  command: string
  args: string[]
}

const findOnPath = (command: string) => {
  const pathExts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE').split(';') : ['']
  const paths = (process.env.PATH ?? '').split(path.delimiter)

  for (const basePath of paths) {
    for (const ext of pathExts) {
      const fullPath = path.join(basePath, command.endsWith(ext.toLowerCase()) ? command : `${command}${ext}`)
      if (fs.existsSync(fullPath)) return fullPath
    }
  }

  return null
}

const getAvailableShells = (): ShellOption[] => {
  if (process.platform !== 'win32') {
    return [{ id: 'bash', label: 'bash', command: 'bash', args: [] }]
  }

  const gitBashCandidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]
  const powershell = findOnPath('powershell.exe')
  const cmd = findOnPath('cmd.exe') ?? 'cmd.exe'
  const gitBash = gitBashCandidates.find((candidate) => fs.existsSync(candidate)) ?? findOnPath('bash.exe')
  const wsl = findOnPath('wsl.exe')
  const shells: ShellOption[] = []

  if (powershell) shells.push({ id: 'powershell', label: 'PowerShell', command: powershell, args: [] })
  shells.push({ id: 'cmd', label: 'CMD', command: cmd, args: [] })
  if (gitBash) shells.push({ id: 'git-bash', label: 'Git Bash', command: gitBash, args: ['--login', '-i'] })
  if (wsl) shells.push({ id: 'wsl', label: 'WSL', command: wsl, args: [] })

  return shells
}

const getPreferredShell = () => {
  const db = getDb()
  const row = db.prepare(`
    SELECT value FROM app_settings WHERE key = 'terminalShell'
  `).get() as { value: string } | undefined
  const shells = getAvailableShells()

  return shells.find((shell) => shell.id === row?.value)?.id ?? shells[0]?.id ?? 'cmd'
}

export function registerTerminalIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle('terminal:getShells', () => {
    return getAvailableShells().map(({ id, label }) => ({ id, label }))
  })

  ipcMain.handle('terminal:getPreferredShell', () => getPreferredShell())

  ipcMain.handle('terminal:setPreferredShell', (_event, shellId: string) => {
    const db = getDb()
    db.prepare(`
      INSERT INTO app_settings (key, value)
      VALUES ('terminalShell', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(shellId)
    return true
  })

  ipcMain.handle('terminal:create', (_event, shellId: string | undefined, cwd: string | undefined) => {
    terminalCounter += 1
    const terminalId = `terminal-${terminalCounter}`
    const shells = getAvailableShells()
    const shell =
      shells.find((option) => option.id === shellId) ??
      shells.find((option) => option.id === getPreferredShell()) ??
      shells[0]
    const resolvedCwd = cwd && fs.existsSync(cwd) ? cwd : process.cwd()
    const terminal = pty.spawn(shell.command, shell.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: resolvedCwd,
      env: process.env as Record<string, string>,
    })

    terminals.set(terminalId, terminal)
    terminal.onData((data) => {
      mainWindow.webContents.send('terminal:data', { terminalId, data })
    })
    terminal.onExit(() => {
      terminals.delete(terminalId)
      mainWindow.webContents.send('terminal:exit', { terminalId })
    })

    return terminalId
  })

  ipcMain.handle('terminal:input', (_event, terminalId: string, data: string) => {
    terminals.get(terminalId)?.write(data)
  })

  ipcMain.handle('terminal:resize', (_event, terminalId: string, cols: number, rows: number) => {
    terminals.get(terminalId)?.resize(cols, rows)
  })

  ipcMain.handle('terminal:kill', (_event, terminalId: string) => {
    const terminal = terminals.get(terminalId)
    if (!terminal) return

    terminal.kill()
    terminals.delete(terminalId)
  })
}
