import { ipcMain } from 'electron';
import { openClawClientService } from '../services/openclaw-client.service';
import { AuthStore } from '../services/auth-store.service';

const API_URL = process.env.API_URL || 'http://localhost:3008/api/v1';

export interface OpenClawConnectionStatus {
  connected: boolean;
  url?: string;
  error?: string;
}

/**
 * 连接到 OpenClaw Gateway
 *
 * 流程：
 * 1. 使用 JWT Token 调用 Server API 获取 Gateway 连接信息
 * 2. Server 自动为用户启动 Gateway 实例（如果未运行）
 * 3. Desktop 使用返回的 URL 和 Token 连接到 Gateway
 */
async function connectToGateway(): Promise<OpenClawConnectionStatus> {
  const tokens = AuthStore.load();
  if (!tokens) {
    return { connected: false, error: 'No auth token found' };
  }

  try {
    // 1. 调用 Server API 获取 Gateway 连接信息
    const response = await fetch(`${API_URL}/openclaw/gateway/connect`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `Failed to get gateway info: ${response.status}`,
      );
    }

    const result = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Invalid gateway response');
    }

    const { url, token } = result.data;

    console.log(`[OpenClaw] Connecting to Gateway at ${url}`);

    // 2. 连接到 OpenClaw Gateway
    await openClawClientService.connect({ url, token });

    console.log('[OpenClaw] Connected to Gateway successfully');

    return {
      connected: true,
      url,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error('[OpenClaw] Connection failed:', errorMessage);

    return {
      connected: false,
      error: errorMessage,
    };
  }
}

/**
 * 断开 OpenClaw Gateway 连接
 */
async function disconnectFromGateway(): Promise<void> {
  await openClawClientService.disconnect();
  console.log('[OpenClaw] Disconnected from Gateway');
}

/**
 * 注册 OpenClaw 相关的 IPC 处理器
 */
export function registerOpenClawIpc(): void {
  // 连接到 Gateway
  ipcMain.handle('openclaw:connect', async (): Promise<OpenClawConnectionStatus> => {
    return connectToGateway();
  });

  // 断开连接
  ipcMain.handle('openclaw:disconnect', async () => {
    await disconnectFromGateway();
    return { success: true };
  });

  // 获取连接状态
  ipcMain.handle('openclaw:status', () => {
    const info = openClawClientService.getConnectionInfo();
    return {
      connected: openClawClientService.isClientConnected(),
      ...info,
    };
  });

  // 发送消息给 Agent（用于测试）
  ipcMain.handle('openclaw:send-message', async (_event, message: string) => {
    if (!openClawClientService.isClientConnected()) {
      throw new Error('Not connected to Gateway');
    }

    try {
      const response = await openClawClientService.sendMessage(message);
      return { success: true, response };
    } catch (error) {
      throw new Error(
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

// 导出连接函数供其他模块使用
export { connectToGateway, disconnectFromGateway };
