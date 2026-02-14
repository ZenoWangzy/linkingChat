import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  // Auth
  login: (email: string, password: string) =>
    ipcRenderer.invoke('auth:login', email, password),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getToken: () => ipcRenderer.invoke('auth:get-token'),

  // Device / WS status
  getConnectionStatus: () => ipcRenderer.invoke('device:get-status'),
  getDeviceInfo: () => ipcRenderer.invoke('device:get-info'),
  getCommandLog: () => ipcRenderer.invoke('device:get-command-log'),

  // Event listeners (main → renderer)
  onConnectionStatusChanged: (callback: (status: string) => void) => {
    ipcRenderer.on('device:status-changed', (_event, status) =>
      callback(status),
    );
  },
  onCommandReceived: (callback: (entry: unknown) => void) => {
    ipcRenderer.on('device:command-received', (_event, entry) =>
      callback(entry),
    );
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
