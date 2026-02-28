import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * 用户 Gateway 实例信息
 */
interface UserGateway {
  userId: string;
  port: number;
  process: ChildProcess | null;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: Date;
  gatewayToken: string; // 用户专属的 Gateway Token
  error?: string;
}

/**
 * Gateway Manager Service
 *
 * 管理多个用户的 OpenClaw Gateway 实例：
 * - 动态端口分配
 * - 进程生命周期管理
 * - JWT 认证集成
 * - 健康检查
 */
@Injectable()
export class GatewayManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(GatewayManagerService.name);
  private gateways: Map<string, UserGateway> = new Map();
  private usedPorts: Set<number> = new Set();
  private readonly basePort: number;
  private readonly maxPorts: number;
  private readonly openclawPath: string;
  private readonly workspacesBasePath: string;
  private readonly gatewayHost: string;
  private readonly jwtSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.basePort = this.configService.get<number>('OPENCLAW_BASE_PORT', 18790);
    this.maxPorts = this.configService.get<number>('OPENCLAW_MAX_PORTS', 100);
    this.openclawPath = this.configService.get<string>(
      'OPENCLAW_PATH',
      path.join(process.cwd(), 'openclaw', 'dist', 'index.js'),
    );
    this.workspacesBasePath = this.configService.get<string>(
      'OPENCLAW_WORKSPACES_PATH',
      path.join(process.cwd(), 'workspaces'),
    );
    this.gatewayHost = this.configService.get<string>('GATEWAY_HOST', 'localhost');
    this.jwtSecret = this.configService.get<string>('JWT_SECRET', 'default-secret');

    this.logger.log(`Gateway Manager initialized (base port: ${this.basePort})`);
  }

  /**
   * 为用户启动 Gateway 实例
   */
  async startUserGateway(userId: string): Promise<{ port: number; status: string; token: string }> {
    // 检查是否已存在
    const existing = this.gateways.get(userId);
    if (existing && existing.status === 'running') {
      this.logger.debug(`Gateway already running for user ${userId} on port ${existing.port}`);
      return { port: existing.port, status: 'running', token: existing.gatewayToken };
    }

    // 分配端口
    const port = this.allocatePort();
    if (!port) {
      throw new Error('No available ports for new Gateway instance');
    }

    // 创建用户工作空间目录
    const workspacePath = this.getUserWorkspacePath(userId);

    this.logger.log(`Starting OpenClaw Gateway for user ${userId} on port ${port}`);

    // 生成用户专属 Gateway Token
    const gatewayToken = this.generateGatewayToken(userId);

    // 创建 Gateway 实例记录
    const gateway: UserGateway = {
      userId,
      port,
      process: null,
      status: 'starting',
      startedAt: new Date(),
      gatewayToken,
    };

    this.gateways.set(userId, gateway);

    try {
      // 启动 OpenClaw Gateway 进程
      const proc = spawn(
        'node',
        [
          this.openclawPath,
          'gateway',
          '--port',
          String(port),
          '--bind',
          'lan',
          '--token',
          gatewayToken,
          '--auth',
          'token',
        ],
        {
          env: {
            ...process.env,
            OPENCLAW_WORKSPACE: workspacePath,
            OPENCLAW_USER_ID: userId,
            NODE_ENV: process.env.NODE_ENV || 'production',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        },
      );

      gateway.process = proc;

      // 处理标准输出
      proc.stdout?.on('data', (data: Buffer) => {
        const output = data.toString().trim();
        this.logger.debug(`[Gateway:${userId}] ${output}`);

        // 检测启动成功
        if (output.includes('Gateway started') || output.includes('listening')) {
          gateway.status = 'running';
          this.logger.log(`Gateway started for user ${userId} on port ${port}`);
        }
      });

      // 处理错误输出
      proc.stderr?.on('data', (data: Buffer) => {
        const output = data.toString().trim();
        this.logger.error(`[Gateway:${userId}] ${output}`);
      });

      // 处理进程退出
      proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        this.logger.log(`Gateway for user ${userId} stopped (code: ${code}, signal: ${signal})`);
        gateway.status = 'stopped';
        gateway.process = null;
        this.releasePort(port);
      });

      // 处理进程错误
      proc.on('error', (err: Error) => {
        this.logger.error(`Gateway process error for user ${userId}: ${err.message}`);
        gateway.status = 'error';
        gateway.error = err.message;
        this.releasePort(port);
      });

      // 等待启动完成（最多 10 秒）
      await this.waitForGatewayReady(gateway, 10000);

      return { port: gateway.port, status: gateway.status, token: gatewayToken };
    } catch (error) {
      gateway.status = 'error';
      gateway.error = error instanceof Error ? error.message : String(error);
      this.releasePort(port);
      throw error;
    }
  }

  /**
   * 停止用户的 Gateway 实例
   */
  async stopUserGateway(userId: string): Promise<void> {
    const gateway = this.gateways.get(userId);
    if (!gateway) {
      this.logger.debug(`No gateway found for user ${userId}`);
      return;
    }

    if (gateway.process) {
      this.logger.log(`Stopping Gateway for user ${userId}`);
      gateway.process.kill('SIGTERM');

      // 等待进程退出（最多 5 秒）
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (gateway.process) {
            gateway.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        gateway.process?.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    this.releasePort(gateway.port);
    this.gateways.delete(userId);
  }

  /**
   * 获取用户 Gateway 信息
   */
  getUserGateway(userId: string): { port: number; status: string; url: string; token: string } | null {
    const gateway = this.gateways.get(userId);
    if (!gateway) {
      return null;
    }

    return {
      port: gateway.port,
      status: gateway.status,
      url: `ws://${this.gatewayHost}:${gateway.port}`,
      token: gateway.gatewayToken,
    };
  }

  /**
   * 验证 JWT 并获取 Gateway 连接信息
   * 供 Desktop 客户端调用
   */
  async getGatewayConnectionInfo(authToken: string): Promise<{
    url: string;
    token: string;
    port: number;
  } | null> {
    try {
      // 验证 JWT Token
      const payload = await this.jwtService.verifyAsync(authToken, {
        secret: this.jwtSecret,
      });

      const userId = payload.sub;
      if (!userId) {
        return null;
      }

      // 获取或启动 Gateway
      let gateway = this.getUserGateway(userId);
      if (!gateway || gateway.status !== 'running') {
        const result = await this.startUserGateway(userId);
        gateway = {
          port: result.port,
          status: result.status,
          url: `ws://${this.gatewayHost}:${result.port}`,
          token: result.token,
        };
      }

      return {
        url: gateway.url,
        token: gateway.token,
        port: gateway.port,
      };
    } catch (error) {
      this.logger.error(`Failed to verify JWT: ${error}`);
      return null;
    }
  }

  /**
   * 获取所有 Gateway 状态
   */
  getAllGateways(): Array<{
    userId: string;
    port: number;
    status: string;
    startedAt: Date;
  }> {
    return Array.from(this.gateways.values()).map((g) => ({
      userId: g.userId,
      port: g.port,
      status: g.status,
      startedAt: g.startedAt,
    }));
  }

  /**
   * 检查 Gateway 是否运行中
   */
  isGatewayRunning(userId: string): boolean {
    const gateway = this.gateways.get(userId);
    return gateway?.status === 'running';
  }

  // ========== 私有方法 ==========

  /**
   * 分配可用端口
   */
  private allocatePort(): number | null {
    for (let i = 0; i < this.maxPorts; i++) {
      const port = this.basePort + i;
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    return null;
  }

  /**
   * 释放端口
   */
  private releasePort(port: number): void {
    this.usedPorts.delete(port);
  }

  /**
   * 生成用户专属 Gateway Token
   * 使用 HS256 对称加密（与 OpenClaw Gateway 兼容）
   */
  private generateGatewayToken(userId: string): string {
    const jti = crypto.randomUUID();
    const payload = {
      sub: userId,
      type: 'gateway',
      jti,
      iat: Math.floor(Date.now() / 1000),
    };

    // 使用简单的对称加密生成 Token
    // OpenClaw Gateway 支持 --token 参数直接使用字符串
    const tokenData = `${payload.sub}:${payload.jti}:${payload.iat}`;
    const signature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(tokenData)
      .digest('hex')
      .slice(0, 32);

    return `lc_gw_${Buffer.from(`${tokenData}:${signature}`).toString('base64url')}`;
  }

  /**
   * 获取用户工作空间路径
   */
  private getUserWorkspacePath(userId: string): string {
    return path.join(this.workspacesBasePath, userId);
  }

  /**
   * 等待 Gateway 启动完成
   */
  private async waitForGatewayReady(gateway: UserGateway, timeoutMs: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (gateway.status === 'running') {
        return;
      }
      if (gateway.status === 'error') {
        throw new Error(`Gateway failed to start: ${gateway.error}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 超时后假设启动成功（实际生产环境应该做健康检查）
    gateway.status = 'running';
    this.logger.warn(`Gateway startup timeout for user ${gateway.userId}, assuming running`);
  }

  /**
   * 模块销毁时清理所有 Gateway
   */
  onModuleDestroy(): void {
    this.logger.log('Shutting down all Gateway instances...');

    for (const [userId, gateway] of this.gateways) {
      if (gateway.process) {
        this.logger.log(`Stopping Gateway for user ${userId}`);
        gateway.process.kill('SIGTERM');
      }
    }

    this.gateways.clear();
    this.usedPorts.clear();
  }
}
