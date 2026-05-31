import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Workspace
  openFolder: () => ipcRenderer.invoke('workspace:openFolder'),
  getRecentWorkspaces: () => ipcRenderer.invoke('workspace:getRecent'),
  readDir: (dirPath: string) => ipcRenderer.invoke('workspace:readDir', dirPath),
  createFolder: (folderPath: string, name: string) =>
    ipcRenderer.invoke('workspace:createFolder', folderPath, name),

  // Editor
  readFile: (filePath: string) => ipcRenderer.invoke('editor:readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('editor:writeFile', filePath, content),
})

// Tipi globali per TypeScript nel renderer
declare global {
  interface Window {
    api: {
      openFolder: () => Promise<{ path: string; name: string } | null>
      getRecentWorkspaces: () => Promise<{ id: number; path: string; name: string; last_opened: string }[]>
      readDir: (dirPath: string) => Promise<{ name: string; path: string; isDirectory: boolean }[]>
      createFolder: (folderPath: string, name: string) => Promise<{ path: string; name: string }>
      readFile: (filePath: string) => Promise<{ content: string; language: string }>
      writeFile: (filePath: string, content: string) => Promise<boolean>
    }
  }
}
