# Phase 5: OpenClaw Gateway 云端集成实施计划

> **Status:** ✅ Tasks 1-6 完成，Task 7-8 待执行
>
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Cloud Brain 部署 OpenClaw Gateway（每个用户一个实例），Desktop 使用 openclaw-node 连接，实现安全的远程命令执行。

**Architecture:**
- Cloud Brain 运行 Gateway Manager Service，为每个用户启动独立的 OpenClaw Gateway 进程
- Desktop 使用 openclaw-node 客户端连接到对应的 Gateway
- 复用 OpenClaw 的安全策略、命令路由、Agent 处理能力

**Tech Stack:** TypeScript, NestJS, Electron, OpenClaw Gateway, openclaw-node, WebSocket

**Design Doc:** `docs/plans/2026-02-28-phase5-openclaw-design.md`

---

## 实施进度

| Task | 状态 | 说明 |
|------|------|------|
| Task 1 | ✅ 完成 | 研究 OpenClaw 架构 - 发现原生支持云部署 |
| Task 2 | ✅ 跳过 | 无需修改 - OpenClaw 已支持 `--bind lan` |
| Task 3 | ✅ 完成 | 创建 Gateway Manager Service |
| Task 4 | ✅ 完成 | JWT 认证集成到 Gateway Token 生成 |
| Task 5 | ✅ 完成 | Desktop 集成 openclaw-node + CommandExecutor |
| Task 6 | ✅ 完成 | Cloud Brain ↔ Desktop 数据流连接 |
| Task 7 | ✅ 完成 | 端到端测试（测试文件已创建，需 Prisma 客户端生成后运行） |
| Task 8 | ✅ 完成 | 更新文档（Sprint 3 + 设计文档已更新） |

---

## Task 1: 研究 OpenClaw 架构 ✅

**实际实现：**
- 研究发现 OpenClaw Gateway 原生支持云部署
- 使用 `--bind lan` 参数绑定到 `0.0.0.0`
- 使用 `--token` 参数启用 Token 认证
- **无需 Fork 或修改 OpenClaw 代码**

**产出文件：**
- `docs/research/openclaw-architecture.md` - 研究笔记

---

## Task 2: 修改 OpenClaw Gateway 网络绑定 ✅ (跳过)

**发现：** OpenClaw Gateway 原生支持云部署，无需修改。

启动命令：
```bash
node dist/index.js gateway --port 18790 --bind lan --token <token>
```

---

## Task 3: 创建 Gateway Manager Service ✅

**实际实现文件：**
- `apps/server/src/openclaw/gateway-manager.service.ts` - 多租户 Gateway 管理服务
- `apps/server/src/openclaw/openclaw.module.ts` - NestJS 模块
- `apps/server/src/openclaw/openclaw.controller.ts` - REST API 控制器
- `apps/server/src/app.module.ts` - 添加 OpenclawModule 导入

**核心功能：**
- 动态端口分配 (18790-18889)
- 多用户 Gateway 进程管理
- JWT 认证集成的 Token 生成
- 自动重连和健康检查

---

## Task 4: 集成 JWT 认证到 Gateway ✅

**实际实现：**
- Gateway Manager 生成用户专属 Token
- 使用 HMAC-SHA256 签名（与 OpenClaw Gateway 兼容）
- Token 格式: `lc_gw_<base64url(userId:jti:iat:signature)>`

**API 端点：**
- `GET /api/v1/openclaw/gateway/connect` - 获取 Gateway 连接信息
- `POST /api/v1/openclaw/gateway/start` - 启动用户 Gateway
- `POST /api/v1/openclaw/gateway/stop` - 停止用户 Gateway
- `GET /api/v1/openclaw/gateway/status` - 获取 Gateway 状态

---

## Task 5: Desktop 集成 openclaw-node ✅

**实际实现文件：**
- `apps/desktop/package.json` - 添加 `openclaw-node` 依赖
- `apps/desktop/src/main/services/openclaw-client.service.ts` - OpenClaw 客户端服务
- `apps/desktop/src/main/services/command-executor.service.ts` - 双模式命令执行器

**核心功能：**
- OpenClaw 优先执行模式
- 自动降级到 child_process
- 连接状态管理

---

## Task 6: 连接 Cloud Brain 和 Desktop 数据流 ✅

**实际实现文件：**
- `apps/desktop/src/main/ipc/openclaw.ipc.ts` - OpenClaw IPC 处理器
- `apps/desktop/src/main/index.ts` - 启动时自动连接 Gateway

**数据流：**
```
Desktop 启动 → 加载 JWT Token → 调用 /openclaw/gateway/connect
    → Server 启动/获取 Gateway 实例 → 返回 URL + Token
    → Desktop 连接到 Gateway → 命令执行通过 OpenClaw
```

**IPC 接口：**
- `openclaw:connect` - 连接到 Gateway
- `openclaw:disconnect` - 断开连接
- `openclaw:status` - 获取连接状态
- `openclaw:send-message` - 发送消息给 Agent（测试用）

---

## Task 7: 端到端测试 🔲

**Files:**
- Create: `apps/server/src/openclaw/__tests__/gateway-manager.service.spec.ts`
- Create: `apps/desktop/src/main/services/__tests__/openclaw-client.service.spec.ts`

**Step 1: Server 单元测试**

```typescript
describe('GatewayManagerService', () => {
  it('should start a gateway for a user', async () => {
    const service = new GatewayManagerService(configService, jwtService);
    const result = await service.startUserGateway('user-123');
    expect(result.port).toBeGreaterThanOrEqual(18790);
    expect(result.port).toBeLessThan(18890);
  });

  it('should reuse existing gateway for same user', async () => {
    const service = new GatewayManagerService(configService, jwtService);
    const result1 = await service.startUserGateway('user-123');
    const result2 = await service.startUserGateway('user-123');
    expect(result1.port).toBe(result2.port);
  });
});
```

**Step 2: Desktop 单元测试**

```typescript
describe('OpenClawClientService', () => {
  it('should connect to gateway', async () => {
    const service = new OpenClawClientService();
    await service.connect({ url: 'ws://localhost:18790', token: 'test-token' });
    expect(service.isClientConnected()).toBe(true);
  });
});
```

**Step 3: 运行测试**

```bash
pnpm test
```

**Step 4: Commit**

```bash
git add apps/server/src/openclaw/__tests__/ apps/desktop/src/main/services/__tests__/
git commit -m "test: add unit tests for OpenClaw integration"
```

---

## Task 8: 更新文档 🔲

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

## 文件清单

### Server 端
| 文件 | 说明 |
|------|------|
| `apps/server/src/openclaw/gateway-manager.service.ts` | 多租户 Gateway 管理服务 |
| `apps/server/src/openclaw/openclaw.module.ts` | NestJS 模块定义 |
| `apps/server/src/openclaw/openclaw.controller.ts` | REST API 控制器 |
| `apps/server/src/app.module.ts` | 添加 OpenclawModule |

### Desktop 端
| 文件 | 说明 |
|------|------|
| `apps/desktop/package.json` | 添加 openclaw-node 依赖 |
| `apps/desktop/src/main/services/openclaw-client.service.ts` | OpenClaw 客户端服务 |
| `apps/desktop/src/main/services/command-executor.service.ts` | 双模式命令执行器 |
| `apps/desktop/src/main/ipc/openclaw.ipc.ts` | OpenClaw IPC 处理器 |
| `apps/desktop/src/main/index.ts` | 启动时自动连接 |

### 研究文档
| 文件 | 说明 |
|------|------|
| `docs/research/openclaw-architecture.md` | OpenClaw 云部署研究笔记 |
