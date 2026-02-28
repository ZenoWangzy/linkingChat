import { OpenClawClient } from 'openclaw-node';

/**
 * OpenClaw Gateway 连接配置
 */
export interface GatewayConnectionConfig {
  url: string;
  token: string;
}

/**
 * OpenClaw Client Service
 *
 * 管理 Desktop 与 OpenClaw Gateway 的连接：
 * - 连接管理
 * - 命令执行
 * - 自动重连
 */
export class OpenClawClientService {
  private client: OpenClawClient | null = null;
  private connectionConfig: GatewayConnectionConfig | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;

  /**
   * 连接到 OpenClaw Gateway
   */
  async connect(config: GatewayConnectionConfig): Promise<void> {
    if (this.client && this.isConnected) {
      console.log('[OpenClaw] Already connected');
      return;
    }

    this.connectionConfig = config;

    console.log(`[OpenClaw] Connecting to Gateway at ${config.url}`);

    this.client = new OpenClawClient({
      url: config.url,
      token: config.token,
      autoReconnect: true,
      maxReconnectAttempts: this.maxReconnectAttempts,
    });

    try {
      await this.client.connect();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('[OpenClaw] Connected to Gateway successfully');
    } catch (error) {
      this.isConnected = false;
      console.error('[OpenClaw] Failed to connect:', error);
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (error) {
        console.error('[OpenClaw] Error during disconnect:', error);
      }
      this.client = null;
      this.isConnected = false;
      console.log('[OpenClaw] Disconnected from Gateway');
    }
  }

  /**
   * 检查是否已连接
   */
  isClientConnected(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * 获取当前连接信息
   */
  getConnectionInfo(): { url: string; connected: boolean } | null {
    if (!this.connectionConfig) {
      return null;
    }
    return {
      url: this.connectionConfig.url,
      connected: this.isConnected,
    };
  }

  /**
   * 发送消息给 Agent（用于测试连接）
   */
  async sendMessage(message: string): Promise<string> {
    if (!this.client || !this.isConnected) {
      throw new Error('Not connected to Gateway');
    }

    try {
      const response = await this.client.chatSync(message);
      return response;
    } catch (error) {
      console.error('[OpenClaw] Error sending message:', error);
      throw error;
    }
  }

  /**
   * 获取底层客户端（供高级用例使用）
   */
  getClient(): OpenClawClient | null {
    return this.client;
  }
}

// 单例实例
export const openClawClientService = new OpenClawClientService();
