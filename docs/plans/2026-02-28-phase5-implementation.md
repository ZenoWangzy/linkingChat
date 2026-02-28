# Phase 5: OpenClaw Gateway 云端集成实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Cloud Brain 部署 OpenClaw Gateway（每个用户一个实例），Desktop 使用 openclaw-node 连接，实现安全的远程命令执行。

**Architecture:**
- Cloud Brain 运行 Gateway Manager Service，为每个用户启动独立的 OpenClaw Gateway 进程
- Desktop 使用 openclaw-node 客户端连接到对应的 Gateway
- 复用 OpenClaw 的安全策略、命令路由、Agent 处理能力

**Tech Stack:** TypeScript, NestJS, Electron, OpenClaw Gateway, openclaw-node, WebSocket

**Design Doc:** `docs/plans/2026-02-28-phase5-openclaw-design.md`

---

## Task 1: Fork OpenClaw 并研究架构

**Files:**
- Reference: `https://github.com/openclaw/openclaw`
- Create: `docs/research/openclaw-architecture.md`

**Step 1: Fork OpenClaw 仓库**

```bash
# 在 GitHub 上 Fork openclaw/openclaw 到 linkingchat 组织
# 或者克隆到本地研究
git clone https://github.com/openclaw/openclaw.git /tmp/openclaw-research
```

Expected: 获得 OpenClaw 源码访问

**Step 2: 研究 Gateway 核心模块**

重点研究：
- `packages/gateway` - Gateway 服务核心
- `packages/shared` - 共享类型和协议
- 配置系统 - 如何配置网络绑定和端口

Expected: 理解 Gateway 启动参数和配置方式

**Step 3: 记录关键文件和配置**

创建研究笔记，记录：
- Gateway 启动入口文件
- 网络绑定配置位置
- 认证模块位置
- 多实例支持方案

---

## Task 2: 修改 OpenClaw Gateway 网络绑定

**Files:**
- Modify: OpenClaw Gateway 配置

**Step 1: 支持动态端口和外部绑定**

修改 Gateway 配置支持：
- 绑定 `0.0.0.0` 而非 `127.0.0.1`
- 通过环境变量或命令行参数指定端口
- 支持 `--port` 和 `--host` 参数

**Step 2: 测试本地启动**

```bash
cd openclaw
pnpm build
node dist/gateway.js --host 0.0.0.0 --port 18790
```

Expected: Gateway 可以从外部访问

**Step 3: Commit**

```bash
git add .
git commit -m "feat: support dynamic port and external binding for cloud deployment"
```

---

## Task 3: 创建 Gateway Manager Service

**Files:**
- Create: `apps/server/src/modules/openclaw/gateway-manager.service.ts`
- Create: `apps/server/src/modules/openclaw/openclaw.module.ts`

**Step 1: 创建 Gateway Manager Service**

```typescript
// apps/server/src/modules/openclaw/gateway-manager.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

interface UserGateway {
  userId: string;
  port: number;
  process: ChildProcess;
  status: 'starting' | 'running' | 'stopped' | 'error';
}

@Injectable()
export class GatewayManagerService {
  private readonly logger = new Logger(GatewayManagerService.name);
  private gateways: Map<string, UserGateway> = new Map();
  private portPool: number[] = [];
  private nextPort = 18790;

  constructor() {
    // 初始化端口池
    for (let i = 0; i < 100; i++) {
      this.portPool.push(18790 + i);
    }
  }

  async startUserGateway(userId: string): Promise<number> {
    if (this.gateways.has(userId)) {
      return this.gateways.get(userId)!.port;
    }

    const port = this.allocatePort();
    const gatewayPath = this.getGatewayPath();

    this.logger.log(`Starting OpenClaw Gateway for user ${userId} on port ${port}`);

    const proc = spawn('node', [gatewayPath, '--host', '0.0.0.0', '--port', String(port)], {
      env: {
        ...process.env,
        OPENCLAW_USER_ID: userId,
        OPENCLAW_WORKSPACE: this.getUserWorkspace(userId),
      },
    });

    const gateway: UserGateway = {
      userId,
      port,
      process: proc,
      status: 'starting',
    };

    proc.stdout?.on('data', (data) => {
      this.logger.debug(`[Gateway:${userId}] ${data}`);
      if (data.toString().includes('Gateway started')) {
        gateway.status = 'running';
      }
    });

    proc.stderr?.on('data', (data) => {
      this.logger.error(`[Gateway:${userId}] ${data}`);
      gateway.status = 'error';
    });

    proc.on('close', () => {
      this.logger.log(`Gateway for user ${userId} stopped`);
      gateway.status = 'stopped';
      this.releasePort(port);
      this.gateways.delete(userId);
    });

    this.gateways.set(userId, gateway);
    return port;
  }

  async stopUserGateway(userId: string): Promise<void> {
    const gateway = this.gateways.get(userId);
    if (gateway) {
      gateway.process.kill();
      this.gateways.delete(userId);
    }
  }

  getUserGatewayPort(userId: string): number | null {
    return this.gateways.get(userId)?.port ?? null;
  }

  private allocatePort(): number {
    return this.portPool.pop() ?? this.nextPort++;
  }

  private releasePort(port: number): void {
    this.portPool.push(port);
  }

  private getGatewayPath(): string {
    // TODO: 配置 OpenClaw Gateway 的实际路径
    return path.join(process.cwd(), 'openclaw', 'dist', 'gateway.js');
  }

  private getUserWorkspace(userId: string): string {
    return path.join(process.cwd(), 'workspaces', userId);
  }
}
```

**Step 2: 创建 OpenClaw Module**

```typescript
// apps/server/src/modules/openclaw/openclaw.module.ts
import { Module } from '@nestjs/common';
import { GatewayManagerService } from './gateway-manager.service';

@Module({
  providers: [GatewayManagerService],
  exports: [GatewayManagerService],
})
export class OpenClawModule {}
```

**Step 3: Commit**

```bash
git add apps/server/src/modules/openclaw/
git commit -m "feat(server): add Gateway Manager Service for multi-tenant OpenClaw"
```

---

## Task 4: 集成 JWT 认证到 Gateway

**Files:**
- Modify: OpenClaw Gateway 认证模块
- Create: `apps/server/src/modules/openclaw/gateway-auth.service.ts`

**Step 1: 创建认证适配器**

在 OpenClaw Gateway 中添加 JWT 认证支持：
- 解析 LinkingChat JWT token
- 验证用户身份
- 关联到对应的 Gateway 实例

**Step 2: 修改 Gateway 认证逻辑**

```typescript
// 在 OpenClaw Gateway 中添加 JWT 验证
import { verify } from 'jsonwebtoken';

function validateToken(token: string, userId: string): boolean {
  try {
    const decoded = verify(token, process.env.JWT_PUBLIC_KEY!);
    return decoded.sub === userId;
  } catch {
    return false;
  }
}
```

**Step 3: Commit**

```bash
git add .
git commit -m "feat: integrate LinkingChat JWT authentication into OpenClaw Gateway"
```

---

## Task 5: Desktop 集成 openclaw-node

**Files:**
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/main/services/openclaw-client.service.ts`
- Modify: `apps/desktop/src/main/services/command-executor.service.ts`

**Step 1: 添加 openclaw-node 依赖**

```bash
cd apps/desktop && pnpm add openclaw-node
```

**Step 2: 创建 OpenClaw Client Service**

```typescript
// apps/desktop/src/main/services/openclaw-client.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { OpenClawClient } from 'openclaw-node';

@Injectable()
export class OpenClawClientService {
  private readonly logger = new Logger(OpenClawClientService.name);
  private client: OpenClawClient | null = null;

  async connect(gatewayUrl: string, token: string): Promise<void> {
    this.client = new OpenClawClient({
      url: gatewayUrl,
      token,
      autoReconnect: true,
    });

    await this.client.connect();
    this.logger.log(`Connected to OpenClaw Gateway at ${gatewayUrl}`);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }

  getClient(): OpenClawClient | null {
    return this.client;
  }

  isConnected(): boolean {
    return this.client !== null;
  }
}
```

**Step 3: 更新 CommandExecutor 支持双模式**

```typescript
// apps/desktop/src/main/services/command-executor.service.ts
import { OpenClawClientService } from './openclaw-client.service';

export class CommandExecutor {
  constructor(private readonly openClawClient?: OpenClawClientService) {}

  async execute(command: string, timeout = CommandExecutor.DEFAULT_TIMEOUT): Promise<CommandResult> {
    // 如果 OpenClaw 可用，通过 Gateway 执行
    if (this.openClawClient?.isConnected()) {
      // 通过 node.invoke 调用 system.run
      return this.executeViaOpenClaw(command, timeout);
    }

    // 降级到 child_process
    return this.executeWithChildProcess(command, timeout);
  }

  private async executeViaOpenClaw(command: string, timeout: number): Promise<CommandResult> {
    // TODO: 调用 OpenClaw node.invoke('system.run', { command })
    // 暂时降级
    return this.executeWithChildProcess(command, timeout);
  }
}
```

**Step 4: Commit**

```bash
git add apps/desktop/
git commit -m "feat(desktop): integrate openclaw-node client with fallback"
```

---

## Task 6: 连接 Cloud Brain 和 Desktop 数据流

**Files:**
- Modify: `apps/server/src/modules/device/device.gateway.ts`
- Modify: `apps/desktop/src/main/ipc/device.ipc.ts`

**Step 1: Server 端关联用户和 Gateway**

当 Desktop 连接时，启动对应用户的 Gateway 并返回端口：

```typescript
@SubscribeMessage('device:register')
async handleDeviceRegister(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { deviceId: string }
) {
  const userId = this.extractUserId(client);

  // 启动用户的 Gateway
  const gatewayPort = await this.gatewayManager.startUserGateway(userId);

  return {
    success: true,
    gatewayUrl: `ws://cloud-brain-host:${gatewayPort}`,
  };
}
```

**Step 2: Desktop 连接到 Gateway**

```typescript
// Desktop 收到 Gateway URL 后连接
ipcMain.handle('device:connect-gateway', async (event, gatewayUrl: string, token: string) => {
  await openClawClient.connect(gatewayUrl, token);
  return { connected: true };
});
```

**Step 3: Commit**

```bash
git add apps/server/src/modules/device/ apps/desktop/src/main/ipc/
git commit -m "feat: connect Cloud Brain Gateway Manager with Desktop client"
```

---

## Task 7: 端到端测试

**Files:**
- Create: `apps/server/src/modules/openclaw/__tests__/gateway-manager.service.spec.ts`
- Create: `apps/desktop/src/main/services/__tests__/openclaw-client.service.spec.ts`

**Step 1: Server 单元测试**

```typescript
describe('GatewayManagerService', () => {
  it('should start a gateway for a user', async () => {
    const service = new GatewayManagerService();
    const port = await service.startUserGateway('user-123');
    expect(port).toBeGreaterThanOrEqual(18790);
    expect(port).toBeLessThan(18890);
  });

  it('should reuse existing gateway for same user', async () => {
    const service = new GatewayManagerService();
    const port1 = await service.startUserGateway('user-123');
    const port2 = await service.startUserGateway('user-123');
    expect(port1).toBe(port2);
  });
});
```

**Step 2: Desktop 单元测试**

```typescript
describe('OpenClawClientService', () => {
  it('should connect to gateway', async () => {
    const service = new OpenClawClientService();
    await service.connect('ws://localhost:18790', 'test-token');
    expect(service.isConnected()).toBe(true);
  });
});
```

**Step 3: 运行测试**

```bash
pnpm test
```

**Step 4: Commit**

```bash
git add apps/server/src/modules/openclaw/__tests__/ apps/desktop/src/main/services/__tests__/
git commit -m "test: add unit tests for OpenClaw integration"
```

---

## Task 8: 更新文档

**Files:**
- Modify: `docs/dev/sprint3_implement.md`
- Modify: `CLAUDE.md`

**Step 1: 更新 Sprint 3 文档**

标记 Phase 5 完成，记录实施细节。

**Step 2: 更新 CLAUDE.md**

更新项目状态和架构说明。

**Step 3: Commit**

```bash
git add docs/dev/sprint3_implement.md CLAUDE.md
git commit -m "docs: mark Phase 5 OpenClaw cloud integration as complete"
```

---

## 执行选项

计划已更新保存到 `docs/plans/2026-02-28-phase5-implementation.md`

**执行方式：** 使用 executing-plans skill 逐任务执行
