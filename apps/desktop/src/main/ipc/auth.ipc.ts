import { ipcMain } from 'electron';
import { AuthStore } from '../services/auth-store.service';
import type { WsClientService } from '../services/ws-client.service';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3008';

export function registerAuthIpc(wsClient: WsClientService): void {
  ipcMain.handle(
    'auth:login',
    async (_event, email: string, password: string) => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        if (!res.ok) {
          const err = await res.json();
          return { success: false, error: err.message || 'Login failed' };
        }

        const data = await res.json();
        AuthStore.save({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        });

        // Connect WS after successful login
        wsClient.connect();

        return { success: true, user: data.user };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Network error',
        };
      }
    },
  );

  ipcMain.handle('auth:logout', async () => {
    wsClient.disconnect();
    AuthStore.clear();
    return { success: true };
  });

  ipcMain.handle('auth:get-token', async () => {
    const tokens = AuthStore.load();
    return tokens?.accessToken ?? null;
  });
}
