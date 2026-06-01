import { ipcMain } from 'electron'
import simpleGit from 'simple-git'
import fs from 'fs'
import path from 'path'

export function registerGitIpc() {
  ipcMain.handle('git:status', async (_, workspacePath: string) => {
    const git = simpleGit(workspacePath)
    const status = await git.status()

    const staged: { path: string; status: string }[] = []
    const unstaged: { path: string; status: string }[] = []

    for (const file of status.files) {
      const idx = file.index
      const wd = file.working_dir

      if (idx === '?' && wd === '?') {
        unstaged.push({ path: file.path, status: 'U' })
        continue
      }

      if (idx && idx !== ' ') {
        staged.push({ path: file.path, status: idx })
      }

      if (wd && wd !== ' ' && wd !== '?') {
        unstaged.push({ path: file.path, status: wd })
      }
    }

    return {
      staged,
      unstaged,
      ahead: status.ahead,
      behind: status.behind,
      current: status.current ?? '',
      tracking: status.tracking ?? null,
    }
  })

  ipcMain.handle('git:stage', async (_, workspacePath: string, filePath: string) => {
    const git = simpleGit(workspacePath)
    await git.add(filePath)
    return true
  })

  ipcMain.handle('git:unstage', async (_, workspacePath: string, filePath: string) => {
    const git = simpleGit(workspacePath)
    await git.raw(['restore', '--staged', filePath])
    return true
  })

  ipcMain.handle('git:stageAll', async (_, workspacePath: string) => {
    const git = simpleGit(workspacePath)
    await git.add('.')
    return true
  })

  ipcMain.handle('git:discardFile', async (_, workspacePath: string, filePath: string, isUntracked: boolean) => {
    const git = simpleGit(workspacePath)
    if (isUntracked) {
      const fullPath = path.join(workspacePath, filePath)
      fs.unlinkSync(fullPath)
    } else {
      await git.checkout(['--', filePath])
    }
    return true
  })

  ipcMain.handle('git:discardAll', async (_, workspacePath: string) => {
    const git = simpleGit(workspacePath)
    await git.raw(['checkout', '--', '.'])
    return true
  })

  ipcMain.handle('git:commit', async (_, workspacePath: string, message: string) => {
    const git = simpleGit(workspacePath)
    await git.commit(message)
    return true
  })

  ipcMain.handle('git:getBranch', async (_, workspacePath: string) => {
    const git = simpleGit(workspacePath)
    const status = await git.status()
    return status.current ?? ''
  })

  ipcMain.handle('git:getBranches', async (_, workspacePath: string) => {
    const git = simpleGit(workspacePath)
    const branches = await git.branch(['-a'])
    const result: { name: string; current: boolean; remote: boolean }[] = []

    for (const name of branches.all) {
      const isRemote = name.startsWith('remotes/')
      const cleanName = isRemote ? name.replace('remotes/', '') : name
      if (cleanName.endsWith('/HEAD')) continue
      result.push({
        name: cleanName,
        current: !isRemote && cleanName === branches.current,
        remote: isRemote,
      })
    }

    return result
  })

  ipcMain.handle('git:checkoutBranch', async (_, workspacePath: string, branch: string) => {
    const git = simpleGit(workspacePath)
    await git.checkout(branch)
    return true
  })

  ipcMain.handle('git:createBranch', async (_, workspacePath: string, branch: string) => {
    const git = simpleGit(workspacePath)
    await git.checkoutLocalBranch(branch)
    return true
  })

  ipcMain.handle('git:pull', async (_, workspacePath: string) => {
    const git = simpleGit(workspacePath)
    await git.pull()
    return true
  })

  ipcMain.handle('git:push', async (_, workspacePath: string) => {
    const git = simpleGit(workspacePath)
    await git.push()
    return true
  })

  ipcMain.handle('git:getLog', async (_, workspacePath: string) => {
    const git = simpleGit(workspacePath)
    const log = await git.log({ maxCount: 50 })
    return log.all.map(commit => ({
      hash: commit.hash,
      shortHash: commit.hash.substring(0, 7),
      message: commit.message,
      author: commit.author_name,
      date: commit.date,
      refs: commit.refs,
    }))
  })

  ipcMain.handle('git:getCommitFiles', async (_, workspacePath: string, hash: string) => {
    const git = simpleGit(workspacePath)
    const output = await git.raw(['show', '--name-status', '--format=', hash])
    const lines = output.trim().split('\n').filter(Boolean)
    return lines.map(line => {
      const parts = line.split('\t')
      const status = parts[0]?.trim() ?? ''
      const filePath = parts[1]?.trim() ?? ''
      const newPath = parts[2]?.trim()
      return { status, path: newPath ?? filePath, oldPath: newPath ? filePath : undefined }
    }).filter(f => f.path)
  })

  ipcMain.handle('git:getCommitFileDiff', async (_, workspacePath: string, hash: string, filePath: string) => {
    const git = simpleGit(workspacePath)
    let original = ''
    let modified = ''
    try { original = await git.show([`${hash}~1:${filePath}`]) } catch { original = '' }
    try { modified = await git.show([`${hash}:${filePath}`]) } catch { modified = '' }
    return { original, modified }
  })

  ipcMain.handle('git:getDiff', async (_, workspacePath: string, filePath: string, isStaged: boolean) => {
    const git = simpleGit(workspacePath)

    let original = ''
    let modified = ''

    try {
      original = await git.show([`HEAD:${filePath}`])
    } catch {
      original = ''
    }

    if (isStaged) {
      try {
        modified = await git.show([`:${filePath}`])
      } catch {
        modified = ''
      }
    } else {
      try {
        const fullPath = path.join(workspacePath, filePath)
        modified = fs.readFileSync(fullPath, 'utf-8')
      } catch {
        modified = ''
      }
    }

    return { original, modified }
  })
}
