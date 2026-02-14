import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { registerAuthIpc } from './ipc/auth.ipc';
import { registerDeviceIpc } from './ipc/device.ipc';
import { WsClientService } from './services/ws-client.service';
import { AuthStore } from './services/auth-store.service';

let mainWindow: BrowserWindow | null = null;
const wsClient = new WsClientService();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    title: 'LinkingChat',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  wsClient.setMainWindow(mainWindow);

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerAuthIpc(wsClient);
  registerDeviceIpc(wsClient);

  createWindow();

  // Auto-connect if tokens exist
  const tokens = AuthStore.load();
  if (tokens) {
    wsClient.connect();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  wsClient.disconnect();
  if (process.platform !== 'darwin') app.quit();
});
