import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type BrowserState, type WorkbenchApi } from '@shared/api'
import { exportApi } from './export'
import { libraryApi } from './library'
import { papersApi } from './papers'

const api: WorkbenchApi = {
  browser: {
    show: (bounds) => ipcRenderer.send(IPC.browserShow, bounds),
    hide: () => ipcRenderer.send(IPC.browserHide),
    navigate: (url) => ipcRenderer.send(IPC.browserNavigate, url),
    back: () => ipcRenderer.send(IPC.browserBack),
    forward: () => ipcRenderer.send(IPC.browserForward),
    reload: () => ipcRenderer.send(IPC.browserReload),
    home: () => ipcRenderer.send(IPC.browserHome),
    getState: () => ipcRenderer.invoke(IPC.browserGetState),
    onState: (listener) => {
      const handler = (_event: IpcRendererEvent, state: BrowserState): void => listener(state)
      ipcRenderer.on(IPC.browserState, handler)
      return () => ipcRenderer.removeListener(IPC.browserState, handler)
    }
  },
  data: {
    info: () => ipcRenderer.invoke(IPC.dataInfo),
    openFolder: () => ipcRenderer.invoke(IPC.dataOpenFolder),
    changeFolder: () => ipcRenderer.invoke(IPC.dataChangeFolder)
  },
  library: libraryApi,
  papers: papersApi,
  exporter: exportApi
}

contextBridge.exposeInMainWorld('workbench', api)
