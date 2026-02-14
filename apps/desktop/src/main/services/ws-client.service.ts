import { io, type Socket } from 'socket.io-client';
import { BrowserWindow } from 'electron';
import { AuthStore } from './auth-store.service';
import { CommandExecutor, type CommandResult } from './command-executor.service';
import { isDangerousCommand } from '../utils/command-blacklist';
import { getDeviceId, getDeviceName, getPlatform } from '../utils/platform';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  DeviceCommandPayload,
  DeviceResultPayload,
  WsEnvelope,
} from '@linkingchat/ws-protocol';

type DeviceSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface CommandLogEntry {
  commandId: string;
  action: string;
  type: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'blocked';
  output?: string;
  exitCode?: number;
  executionTimeMs?: number;
  receivedAt: string;
  completedAt?: string;
}

export class WsClientService {
  private socket: DeviceSocket | null = null;
  private mainWindow: BrowserWindow | null = null;
  private commandLog: CommandLogEntry[] = [];
  private connectionStatus: 'disconnected' | 'connecting' | 'connected' =
    'disconnected';
  private executor = new CommandExecutor();

  private deviceId = getDeviceId();
  private deviceName = getDeviceName();
  private platform = getPlatform();

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  getStatus(): string {
    return this.connectionStatus;
  }

  getDeviceInfo() {
    return {
      deviceId: this.deviceId,
      name: this.deviceName,
      platform: this.platform,
    };
  }

  getCommandLog(): CommandLogEntry[] {
    return this.commandLog;
  }

  connect(): void {
    const tokens = AuthStore.load();
    if (!tokens) {
      console.error('[WS] No JWT token found, cannot connect');
      return;
    }

    const WS_URL = process.env.WS_URL || 'http://localhost:3008';

    this.updateStatus('connecting');

    this.socket = io(`${WS_URL}/device`, {
      auth: {
        token: tokens.accessToken,
        deviceId: this.deviceId,
        deviceType: 'desktop',
      },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
    }) as DeviceSocket;

    this.setupEventListeners();
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.updateStatus('disconnected');
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('[WS] Connected to Cloud Brain');
      this.updateStatus('connected');
      this.registerDevice();
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[WS] Disconnected:', reason);
      this.updateStatus('disconnected');
    });

    this.socket.on('connect_error', (err) => {
      console.error('[WS] Connection error:', err.message);
      this.updateStatus('disconnected');
    });

    this.socket.on('device:command:execute', (data: DeviceCommandPayload) => {
      this.handleCommandExecute(data);
    });

    this.socket.on('system:error', (err) => {
      console.error('[WS] System error:', err.code, err.message);
    });
  }

  private registerDevice(): void {
    if (!this.socket) return;

    this.socket.emit(
      'device:register',
      {
        deviceId: this.deviceId,
        name: this.deviceName,
        platform: this.platform,
      },
      (response) => {
        if (response.success) {
          console.log('[WS] Device registered successfully');
        } else {
          console.error('[WS] Device registration failed:', response.error);
        }
      },
    );
  }

  private async handleCommandExecute(
    data: DeviceCommandPayload,
  ): Promise<void> {
    const logEntry: CommandLogEntry = {
      commandId: data.commandId,
      action: data.action,
      type: data.type,
      status: 'pending',
      receivedAt: new Date().toISOString(),
    };

    // Client-side blacklist (defense-in-depth)
    if (isDangerousCommand(data.action)) {
      logEntry.status = 'blocked';
      logEntry.output = '[BLOCKED] Dangerous command blocked by client';
      this.addCommandLog(logEntry);

      this.emitResult({
        commandId: data.commandId,
        status: 'error',
        error: {
          code: 'COMMAND_BLOCKED',
          message: 'Client blocked: dangerous command',
        },
        executionTimeMs: 0,
      });
      return;
    }

    // Sprint 1: only shell type
    if (data.type !== 'shell') {
      logEntry.status = 'error';
      logEntry.output = `[ERROR] Unsupported command type: ${data.type}`;
      this.addCommandLog(logEntry);

      this.emitResult({
        commandId: data.commandId,
        status: 'error',
        error: {
          code: 'UNSUPPORTED_TYPE',
          message: `Sprint 1 only supports shell type`,
        },
        executionTimeMs: 0,
      });
      return;
    }

    logEntry.status = 'running';
    this.addCommandLog(logEntry);

    const result: CommandResult = await this.executor.execute(
      data.action,
      data.timeout,
    );

    logEntry.status = result.status === 'success' ? 'success' : 'error';
    logEntry.output = result.data?.output;
    logEntry.exitCode = result.data?.exitCode;
    logEntry.executionTimeMs = result.executionTimeMs;
    logEntry.completedAt = new Date().toISOString();
    this.updateLastCommandLog(logEntry);

    this.emitResult({
      commandId: data.commandId,
      status: result.status === 'success' ? 'success' : 'error',
      data: result.data,
      error: result.error,
      executionTimeMs: result.executionTimeMs,
    });
  }

  private emitResult(result: DeviceResultPayload): void {
    if (!this.socket) return;

    const envelope: WsEnvelope<DeviceResultPayload> = {
      requestId: result.commandId,
      timestamp: new Date().toISOString(),
      data: result,
    };

    this.socket.emit('device:result:complete', envelope);
    console.log(
      `[WS] Result sent for command ${result.commandId}: ${result.status}`,
    );
  }

  private updateStatus(
    status: 'disconnected' | 'connecting' | 'connected',
  ): void {
    this.connectionStatus = status;
    this.mainWindow?.webContents.send('device:status-changed', status);
  }

  private addCommandLog(entry: CommandLogEntry): void {
    this.commandLog.unshift(entry);
    if (this.commandLog.length > 100) {
      this.commandLog = this.commandLog.slice(0, 100);
    }
    this.mainWindow?.webContents.send('device:command-received', entry);
  }

  private updateLastCommandLog(entry: CommandLogEntry): void {
    const idx = this.commandLog.findIndex(
      (e) => e.commandId === entry.commandId,
    );
    if (idx !== -1) {
      this.commandLog[idx] = entry;
    }
    this.mainWindow?.webContents.send('device:command-received', entry);
  }
}
