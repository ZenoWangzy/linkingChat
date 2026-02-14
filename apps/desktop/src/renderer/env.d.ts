interface ElectronAPI {
  login: (
    email: string,
    password: string,
  ) => Promise<{
    success: boolean;
    error?: string;
    user?: { id: string; username: string; displayName: string };
  }>;
  logout: () => Promise<{ success: boolean }>;
  getToken: () => Promise<string | null>;

  getConnectionStatus: () => Promise<string>;
  getDeviceInfo: () => Promise<{
    deviceId: string;
    name: string;
    platform: string;
  }>;
  getCommandLog: () => Promise<
    Array<{
      commandId: string;
      action: string;
      type: string;
      status: string;
      output?: string;
      exitCode?: number;
      executionTimeMs?: number;
      receivedAt: string;
      completedAt?: string;
    }>
  >;

  onConnectionStatusChanged: (callback: (status: string) => void) => void;
  onCommandReceived: (callback: (entry: unknown) => void) => void;
}

interface Window {
  electronAPI: ElectronAPI;
}
