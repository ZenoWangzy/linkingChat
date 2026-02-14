import { ipcMain } from 'electron';
import type { WsClientService } from '../services/ws-client.service';

export function registerDeviceIpc(wsClient: WsClientService): void {
  ipcMain.handle('device:get-status', () => {
    return wsClient.getStatus();
  });

  ipcMain.handle('device:get-info', () => {
    return wsClient.getDeviceInfo();
  });

  ipcMain.handle('device:get-command-log', () => {
    return wsClient.getCommandLog();
  });
}
