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
    updateConnection: (connectionId: number, connection: DbConnectionInput) =>
      ipcRenderer.invoke('db:updateConnection', connectionId, connection),
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
    deleteConnection: (connectionId: number) => ipcRenderer.invoke('db:deleteConnection', connectionId),
  },

  // HTTP
  http: {
    list: () => ipcRenderer.invoke('http:list'),
    createCollection: (name: string) => ipcRenderer.invoke('http:createCollection', name),
    renameCollection: (id: number, name: string) => ipcRenderer.invoke('http:renameCollection', id, name),
    deleteCollection: (id: number) => ipcRenderer.invoke('http:deleteCollection', id),
    duplicateCollection: (id: number) => ipcRenderer.invoke('http:duplicateCollection', id),
    createFolder: (collectionId: number, name: string, parentId?: number | null) => ipcRenderer.invoke('http:createFolder', collectionId, name, parentId),
    renameFolder: (id: number, name: string) => ipcRenderer.invoke('http:renameFolder', id, name),
    deleteFolder: (id: number) => ipcRenderer.invoke('http:deleteFolder', id),
    duplicateFolder: (id: number) => ipcRenderer.invoke('http:duplicateFolder', id),
    saveRequest: (request: HttpRequest) => ipcRenderer.invoke('http:saveRequest', request),
    deleteRequest: (id: number) => ipcRenderer.invoke('http:deleteRequest', id),
    moveRequest: (id: number, collectionId: number, folderId?: number | null) => ipcRenderer.invoke('http:moveRequest', id, collectionId, folderId),
    duplicateRequest: (id: number) => ipcRenderer.invoke('http:duplicateRequest', id),
    setActiveRequest: (id: number | null) => ipcRenderer.invoke('http:setActiveRequest', id),
    getLayout: () => ipcRenderer.invoke('http:getLayout'),
    saveLayout: (layout: { sidebarWidth: number; requestPanePercent: number }) => ipcRenderer.invoke('http:saveLayout', layout),
    listEnvironments: () => ipcRenderer.invoke('http:listEnvironments'),
    saveEnvironment: (environment: HttpEnvironment) => ipcRenderer.invoke('http:saveEnvironment', environment),
    deleteEnvironment: (id: number) => ipcRenderer.invoke('http:deleteEnvironment', id),
    history: () => ipcRenderer.invoke('http:history'),
    deleteHistory: (id: number) => ipcRenderer.invoke('http:deleteHistory', id),
    send: (request: HttpRequest) => ipcRenderer.invoke('http:send', request),
  },

  // Git
  git: {
    status: (workspacePath: string) => ipcRenderer.invoke('git:status', workspacePath),
    stage: (workspacePath: string, filePath: string) => ipcRenderer.invoke('git:stage', workspacePath, filePath),
    unstage: (workspacePath: string, filePath: string) => ipcRenderer.invoke('git:unstage', workspacePath, filePath),
    stageAll: (workspacePath: string) => ipcRenderer.invoke('git:stageAll', workspacePath),
    discardFile: (workspacePath: string, filePath: string, isUntracked: boolean) =>
      ipcRenderer.invoke('git:discardFile', workspacePath, filePath, isUntracked),
    discardAll: (workspacePath: string) => ipcRenderer.invoke('git:discardAll', workspacePath),
    commit: (workspacePath: string, message: string) => ipcRenderer.invoke('git:commit', workspacePath, message),
    getBranch: (workspacePath: string) => ipcRenderer.invoke('git:getBranch', workspacePath),
    getBranches: (workspacePath: string) => ipcRenderer.invoke('git:getBranches', workspacePath),
    checkoutBranch: (workspacePath: string, branch: string) => ipcRenderer.invoke('git:checkoutBranch', workspacePath, branch),
    createBranch: (workspacePath: string, branch: string) => ipcRenderer.invoke('git:createBranch', workspacePath, branch),
    pull: (workspacePath: string) => ipcRenderer.invoke('git:pull', workspacePath),
    push: (workspacePath: string) => ipcRenderer.invoke('git:push', workspacePath),
    getLog: (workspacePath: string) => ipcRenderer.invoke('git:getLog', workspacePath),
    getCommitFiles: (workspacePath: string, hash: string) => ipcRenderer.invoke('git:getCommitFiles', workspacePath, hash),
    getCommitFileDiff: (workspacePath: string, hash: string, filePath: string) =>
      ipcRenderer.invoke('git:getCommitFileDiff', workspacePath, hash, filePath),
    getDiff: (workspacePath: string, filePath: string, isStaged: boolean) =>
      ipcRenderer.invoke('git:getDiff', workspacePath, filePath, isStaged),
  },
})

// Tipi globali per TypeScript nel renderer
declare global {
  type GitFileItem = { path: string; status: string }
  type GitStatusResult = {
    staged: GitFileItem[]
    unstaged: GitFileItem[]
    ahead: number
    behind: number
    current: string
    tracking: string | null
  }
  type GitCommit = {
    hash: string
    shortHash: string
    message: string
    author: string
    date: string
    refs: string
  }
  type GitBranchItem = { name: string; current: boolean; remote: boolean }
  type GitDiff = { original: string; modified: string }
  type GitCommitFile = { status: string; path: string; oldPath?: string }

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
  type DbConnection = Omit<DbConnectionInput, 'password'> & {
    id: number
    status?: 'connected' | 'disconnected' | 'error'
    statusError?: string
  }
  type DbColumn = {
    name: string
    type: string
    columnKey?: string
    nullable?: string
    defaultValue?: string | null
    extra?: string
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
  type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  type HttpKeyValue = { id?: string; key: string; value: string; enabled: boolean; description?: string }
  type HttpBody = {
    type: 'none' | 'raw' | 'form-data' | 'x-www-form-urlencoded'
    rawType?: 'json' | 'xml' | 'text'
    raw?: string
    fields?: HttpKeyValue[]
  }
  type HttpAuth =
    | { type: 'none' }
    | { type: 'bearer'; token: string }
    | { type: 'basic'; username: string; password: string }
    | { type: 'apiKey'; key: string; value: string; addTo: 'header' | 'query' }
  type HttpScripts = { preRequest?: string; postResponse?: string }
  type HttpResponseCapture = { id?: string; jsonPath: string; variable: string; enabled: boolean }
  type HttpCollection = { id: number; name: string }
  type HttpFolder = { id: number; collectionId: number; name: string; parentId?: number | null; updatedAt?: string }
  type HttpRequest = {
    id?: number
    collectionId: number
    folderId?: number | null
    name: string
    method: HttpMethod
    url: string
    params: HttpKeyValue[]
    headers: HttpKeyValue[]
    body: HttpBody
    auth: HttpAuth
    timeoutMs: number
    environmentId?: number | null
    updatedAt?: string
    description?: string
    scripts?: HttpScripts
    responseCaptures?: HttpResponseCapture[]
  }
  type HttpEnvironment = { id?: number; name: string; variables: HttpKeyValue[]; updatedAt?: string }
  type HttpResponse = {
    status: number
    statusText: string
    duration: number
    size: number
    body: string
    headers: Record<string, string>
    timeline: { dns: number; tcp: number; ttfb: number; download: number }
    url: string
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
        updateConnection: (connectionId: number, connection: DbConnectionInput) => Promise<boolean>
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
        deleteConnection: (connectionId: number) => Promise<boolean>
      }
      git: {
        status: (workspacePath: string) => Promise<GitStatusResult>
        stage: (workspacePath: string, filePath: string) => Promise<boolean>
        unstage: (workspacePath: string, filePath: string) => Promise<boolean>
        stageAll: (workspacePath: string) => Promise<boolean>
        discardFile: (workspacePath: string, filePath: string, isUntracked: boolean) => Promise<boolean>
        discardAll: (workspacePath: string) => Promise<boolean>
        commit: (workspacePath: string, message: string) => Promise<boolean>
        getBranch: (workspacePath: string) => Promise<string>
        getBranches: (workspacePath: string) => Promise<GitBranchItem[]>
        checkoutBranch: (workspacePath: string, branch: string) => Promise<boolean>
        createBranch: (workspacePath: string, branch: string) => Promise<boolean>
        pull: (workspacePath: string) => Promise<boolean>
        push: (workspacePath: string) => Promise<boolean>
        getLog: (workspacePath: string) => Promise<GitCommit[]>
        getCommitFiles: (workspacePath: string, hash: string) => Promise<GitCommitFile[]>
        getCommitFileDiff: (workspacePath: string, hash: string, filePath: string) => Promise<GitDiff>
        getDiff: (workspacePath: string, filePath: string, isStaged: boolean) => Promise<GitDiff>
      }
      http: {
        list: () => Promise<{ collections: HttpCollection[]; folders: HttpFolder[]; requests: HttpRequest[]; activeRequestId: number | null }>
        createCollection: (name: string) => Promise<number>
        renameCollection: (id: number, name: string) => Promise<boolean>
        deleteCollection: (id: number) => Promise<boolean>
        duplicateCollection: (id: number) => Promise<number>
        createFolder: (collectionId: number, name: string, parentId?: number | null) => Promise<number>
        renameFolder: (id: number, name: string) => Promise<boolean>
        deleteFolder: (id: number) => Promise<boolean>
        duplicateFolder: (id: number) => Promise<number>
        saveRequest: (request: HttpRequest) => Promise<number>
        deleteRequest: (id: number) => Promise<boolean>
        moveRequest: (id: number, collectionId: number, folderId?: number | null) => Promise<boolean>
        duplicateRequest: (id: number) => Promise<number>
        setActiveRequest: (id: number | null) => Promise<boolean>
        getLayout: () => Promise<{ sidebarWidth: number; requestPanePercent: number }>
        saveLayout: (layout: { sidebarWidth: number; requestPanePercent: number }) => Promise<boolean>
        listEnvironments: () => Promise<HttpEnvironment[]>
        saveEnvironment: (environment: HttpEnvironment) => Promise<number>
        deleteEnvironment: (id: number) => Promise<boolean>
        history: () => Promise<{ id: number; request: Record<string, unknown>; response: Record<string, unknown>; executedAt: string }[]>
        deleteHistory: (id: number) => Promise<boolean>
        send: (request: HttpRequest) => Promise<HttpResponse>
      }
    }
  }
}
