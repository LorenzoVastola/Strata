import { ipcMain, type WebContents } from 'electron'

export interface AIEnvironment {
  activeDbConnectionId: string | null
  activeHttpCollectionId: string | null
}

const environment: AIEnvironment = {
  activeDbConnectionId: null,
  activeHttpCollectionId: null
}

let mainWebContents: WebContents | null = null

export function setMainWebContents(webContents: WebContents): void {
  mainWebContents = webContents
}

export function getMainWebContents(): WebContents | null {
  return mainWebContents && !mainWebContents.isDestroyed() ? mainWebContents : null
}

export function getAIEnvironment(): AIEnvironment {
  return { ...environment }
}

export function setActiveDbConnectionId(connectionId: string | number | null): AIEnvironment {
  environment.activeDbConnectionId = connectionId === null ? null : String(connectionId)
  return getAIEnvironment()
}

export function setActiveHttpCollectionId(collectionId: string | number | null): AIEnvironment {
  environment.activeHttpCollectionId = collectionId === null ? null : String(collectionId)
  return getAIEnvironment()
}

export function registerEnvironmentIpc(): void {
  ipcMain.handle('env:setDb', (_event, connectionId: string | number | null) => setActiveDbConnectionId(connectionId))
  ipcMain.handle('env:setHttpCollection', (_event, collectionId: string | number | null) => setActiveHttpCollectionId(collectionId))
}
