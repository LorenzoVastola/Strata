import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Workspace
  openFolder: () => ipcRenderer.invoke('workspace:openFolder'),
  getRecentWorkspaces: () => ipcRenderer.invoke('workspace:getRecent'),
  readDir: (dirPath: string) => ipcRenderer.invoke('workspace:readDir', dirPath),
  createFolder: (folderPath: string, name: string) =>
    ipcRenderer.invoke('workspace:createFolder', folderPath, name),
  createFile: (folderPath: string, name: string) => ipcRenderer.invoke('workspace:createFile', folderPath, name),
  renamePath: (targetPath: string, name: string) => ipcRenderer.invoke('workspace:renamePath', targetPath, name),
  deletePath: (targetPath: string) => ipcRenderer.invoke('workspace:deletePath', targetPath),
  revealPath: (targetPath: string) => ipcRenderer.invoke('workspace:revealPath', targetPath),
  searchInFiles: (workspacePath: string, query: string) =>
    ipcRenderer.invoke('workspace:searchInFiles', workspacePath, query),
  getWorkspaceFiles: (workspacePath: string) => ipcRenderer.invoke('workspace:getFiles', workspacePath),
  getEditorState: () => ipcRenderer.invoke('workspace:getEditorState'),
  saveEditorState: (openTabs: string[], activeTab: string | null) =>
    ipcRenderer.invoke('workspace:saveEditorState', openTabs, activeTab),
  getEditorSettings: () => ipcRenderer.invoke('workspace:getEditorSettings'),
  saveEditorSetting: (key: 'autoSave' | 'theme' | 'sidebarWidth' | 'terminalHeight', value: string) =>
    ipcRenderer.invoke('workspace:saveEditorSetting', key, value),

  // Editor
  readFile: (filePath: string) => ipcRenderer.invoke('editor:readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('editor:writeFile', filePath, content),

  // Terminal
  terminal: {
    getShells: () => ipcRenderer.invoke('terminal:getShells'),
    getPreferredShell: () => ipcRenderer.invoke('terminal:getPreferredShell'),
    setPreferredShell: (shellId: string) => ipcRenderer.invoke('terminal:setPreferredShell', shellId),
    create: (shellId?: string, cwd?: string) => ipcRenderer.invoke('terminal:create', shellId, cwd),
    input: (terminalId: string, data: string) => ipcRenderer.invoke('terminal:input', terminalId, data),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', terminalId, cols, rows),
    kill: (terminalId: string) => ipcRenderer.invoke('terminal:kill', terminalId),
    onData: (callback: (payload: { terminalId: string; data: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { terminalId: string; data: string }) => {
        callback(payload)
      }
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
  },

  // Database
  database: {
    listConnections: () => ipcRenderer.invoke('db:listConnections'),
    saveConnection: (connection: DbConnectionInput) => ipcRenderer.invoke('db:saveConnection', connection),
    testConnection: (connection: DbConnectionInput) => ipcRenderer.invoke('db:testConnection', connection),
    connect: (connectionId: number) => ipcRenderer.invoke('db:connect', connectionId),
    getSchema: (connectionId: number) => ipcRenderer.invoke('db:getSchema', connectionId),
    query: (connectionId: number, query: string, params: unknown[] = []) =>
      ipcRenderer.invoke('db:query', connectionId, query, params),
    browseTable: (
      connectionId: number,
      databaseName: string,
      tableName: string,
      page: number,
      pageSize: number,
    ) => ipcRenderer.invoke('db:browseTable', connectionId, databaseName, tableName, page, pageSize),
    disconnect: (connectionId: number) => ipcRenderer.invoke('db:disconnect', connectionId),
  },
})

// Tipi globali per TypeScript nel renderer
declare global {
  type DbDriver = 'mysql' | 'postgres'
  type DbConnectionInput = {
    driver: DbDriver
    name: string
    host: string
    port: number
    user: string
    password: string
    database: string
  }
  type DbConnection = Omit<DbConnectionInput, 'password'> & { id: number }
  type DbColumn = {
    name: string
    type: string
    columnKey?: string
    nullable?: string
  }
  type DbIndex = {
    name: string
    columnName?: string
    definition?: string
    nonUnique?: number
  }
  type DbForeignKey = {
    name: string
    columnName: string
    referencedTable: string
    referencedColumn: string
  }
  type DbTable = {
    name: string
    columns: DbColumn[]
    indexes: DbIndex[]
    foreignKeys: DbForeignKey[]
  }
  type DbSchemaNode = {
    name: string
    tables: DbTable[]
  }
  type DbQueryResult = {
    columns: string[]
    rows: Record<string, unknown>[]
    rowCount: number
    duration: number
    total?: number
    page?: number
    pageSize?: number
  }

  interface Window {
    api: {
      openFolder: () => Promise<{ path: string; name: string } | null>
      getRecentWorkspaces: () => Promise<{ id: number; path: string; name: string; last_opened: string }[]>
      readDir: (dirPath: string) => Promise<{ name: string; path: string; isDirectory: boolean }[]>
      createFolder: (folderPath: string, name: string) => Promise<{ path: string; name: string }>
      createFile: (folderPath: string, name: string) => Promise<{ path: string; name: string }>
      renamePath: (
        targetPath: string,
        name: string,
      ) => Promise<{ path: string; name: string; isDirectory: boolean }>
      deletePath: (targetPath: string) => Promise<boolean>
      revealPath: (targetPath: string) => Promise<boolean>
      searchInFiles: (
        workspacePath: string,
        query: string,
      ) => Promise<{ filePath: string; fileName: string; line: number; preview: string }[]>
      getWorkspaceFiles: (
        workspacePath: string,
      ) => Promise<{ path: string; name: string; relativePath: string }[]>
      getEditorState: () => Promise<{ open_tabs: string; active_tab: string | null } | undefined>
      saveEditorState: (openTabs: string[], activeTab: string | null) => Promise<boolean>
      getEditorSettings: () => Promise<{
        autoSave: boolean
        theme: string
        sidebarWidth: number
        terminalHeight: number
      }>
      saveEditorSetting: (
        key: 'autoSave' | 'theme' | 'sidebarWidth' | 'terminalHeight',
        value: string,
      ) => Promise<boolean>
      readFile: (filePath: string) => Promise<{ content: string; language: string }>
      writeFile: (filePath: string, content: string) => Promise<boolean>
      terminal: {
        getShells: () => Promise<{ id: string; label: string }[]>
        getPreferredShell: () => Promise<string>
        setPreferredShell: (shellId: string) => Promise<boolean>
        create: (shellId?: string, cwd?: string) => Promise<string>
        input: (terminalId: string, data: string) => Promise<void>
        resize: (terminalId: string, cols: number, rows: number) => Promise<void>
        kill: (terminalId: string) => Promise<void>
        onData: (callback: (payload: { terminalId: string; data: string }) => void) => () => void
      }
      database: {
        listConnections: () => Promise<DbConnection[]>
        saveConnection: (connection: DbConnectionInput) => Promise<number>
        testConnection: (connection: DbConnectionInput) => Promise<{ success: boolean; error?: string }>
        connect: (connectionId: number) => Promise<boolean>
        getSchema: (connectionId: number) => Promise<DbSchemaNode[]>
        query: (connectionId: number, query: string, params?: unknown[]) => Promise<DbQueryResult>
        browseTable: (
          connectionId: number,
          databaseName: string,
          tableName: string,
          page: number,
          pageSize: number,
        ) => Promise<DbQueryResult>
        disconnect: (connectionId: number) => Promise<boolean>
      }
    }
  }
}
