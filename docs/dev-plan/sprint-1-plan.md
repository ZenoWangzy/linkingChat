# Sprint 1 实施计划 — 最小全链路 PoC

> **目标**: 手机发一条文字指令 → 云端转发 → 桌面端执行 Shell 命令 → 结果返回手机显示
>
> **不包含**: 好友系统、群聊、AI 功能、文件传输、消息搜索、推送通知

---

## 一、Sprint 1 交付物

| 交付物 | 说明 |
|--------|------|
| **Cloud Brain** | NestJS 服务端，提供 JWT 认证 + WebSocket /device 命名空间 |
| **Mobile PoC** | Flutter 最小 App：登录 → 设备列表 → 发送命令 → 查看结果 |
| **Desktop PoC** | Electron 最小 App：登录 → 连接 Cloud → 接收命令 → 调用 OpenClaw → 回报结果 |
| **Shared Types** | 设备控制事件的 TypeScript 类型定义 |

### 验收标准 (Acceptance Criteria)

```gherkin
GIVEN 用户在手机端和桌面端都已登录同一账号
  AND 桌面端显示 "已连接" 状态
WHEN 用户在手机端输入 Shell 命令 (e.g. "ls -la")
  AND 选择目标桌面设备
  AND 点击 "执行"
THEN 桌面端接收到命令
  AND 执行 Shell 命令
  AND 执行结果在 3 秒内返回手机端显示
  AND command_logs 表中记录该次执行
```

---

## 二、任务分解

### Phase 0: 基础设施搭建

| # | 任务 | 产出 | 依赖 |
|---|------|------|------|
| 0.1 | 初始化 Monorepo (pnpm workspace) | 仓库结构、根 package.json、pnpm-workspace.yaml | - |
| 0.2 | Fork brocoders/nestjs-boilerplate 到 packages/server | 可运行的 NestJS 服务端 | 0.1 |
| 0.3 | 配置 Docker Compose (PostgreSQL + Redis) | docker/docker-compose.yaml | 0.1 |
| 0.4 | 初始化 packages/shared 类型包 | @linkingchat/shared 可构建 | 0.1 |
| 0.5 | 验证脚手架可运行：注册、登录、Swagger | 冒烟测试通过 | 0.2, 0.3 |

### Phase 1: 共享类型定义

| # | 任务 | 产出 | 依赖 |
|---|------|------|------|
| 1.1 | 定义设备控制 WS 事件类型 (shared/) | DeviceCommandPayload, DeviceResultPayload, DeviceStatusPayload | 0.4 |
| 1.2 | 定义 WS 基础类型 (shared/) | WsEnvelope, WsResponse, WsError, SocketData | 0.4 |
| 1.3 | 定义事件名称常量 (shared/) | DeviceEvent enum | 0.4 |

### Phase 2: Server — 设备管理 + WebSocket Gateway

| # | 任务 | 产出 | 依赖 |
|---|------|------|------|
| 2.1 | 创建 Device Entity + Migration | devices 表 | 0.5 |
| 2.2 | 创建 CommandLog Entity + Migration | command_logs 表 | 0.5 |
| 2.3 | 创建 Devices 模块 (Hexagonal) | REST: POST/GET /api/v1/devices | 2.1 |
| 2.4 | 安装 Socket.IO 依赖 | @nestjs/websockets, @nestjs/platform-socket.io, socket.io, ioredis, @socket.io/redis-adapter | 0.5 |
| 2.5 | 创建 Redis IO Adapter | gateway/adapters/redis-io.adapter.ts | 2.4 |
| 2.6 | 创建 WS Auth Middleware | gateway/middleware/ws-auth.middleware.ts (JWT 验证) | 2.4 |
| 2.7 | 创建 Device Gateway (/device 命名空间) | device:register, device:command:send, device:result:complete | 2.3, 2.5, 2.6, 1.x |
| 2.8 | 创建 Socket Service (@Global) | 供其他模块推送 WS 事件的全局服务 | 2.7 |
| 2.9 | E2E 测试：WebSocket 命令流程 | 自动化测试 | 2.7 |

### Phase 3: Desktop — Electron 最小骨架

| # | 任务 | 产出 | 依赖 |
|---|------|------|------|
| 3.1 | 初始化 Electron 项目 (electron-vite 或 electron-forge) | packages/desktop 可启动 | 0.1 |
| 3.2 | 登录界面 + JWT 存储 | 调用 Cloud Brain /auth/email/login API | 0.5 |
| 3.3 | WebSocket 客户端 (/device) | 连接 Cloud Brain，JWT 认证 | 3.2, 1.x |
| 3.4 | 设备注册逻辑 | 启动时 emit device:register | 3.3 |
| 3.5 | 命令接收 + Shell 执行 | 监听 device:command:execute，child_process.exec() | 3.3 |
| 3.6 | 结果回报 | emit device:result:complete | 3.5 |
| 3.7 | OpenClaw Node 集成 (可选) | spawn openclaw node run | 3.5 |
| 3.8 | 最小 UI：连接状态 + 命令日志 | Electron 主窗口 | 3.1 |

> **3.5 说明**: Sprint 1 先用 Node.js `child_process.exec()` 直接执行 Shell 命令。OpenClaw 集成 (3.7) 可以推迟到 Sprint 2，Sprint 1 先验证全链路。

### Phase 4: Mobile — Flutter 最小骨架

| # | 任务 | 产出 | 依赖 |
|---|------|------|------|
| 4.1 | 初始化 Flutter 项目 | packages/mobile 可运行 | 0.1 |
| 4.2 | 登录页面 | Dio HTTP 客户端，调用 /auth/email/login | 0.5 |
| 4.3 | JWT Token 管理 | flutter_secure_storage 存储/刷新 token | 4.2 |
| 4.4 | WebSocket 客户端 (/device) | socket_io_client 连接 Cloud Brain | 4.3, 1.x |
| 4.5 | 设备列表页面 | GET /api/v1/devices 显示在线设备 | 4.4 |
| 4.6 | 命令输入页面 | 文本输入框 + 设备选择器 + 执行按钮 | 4.5 |
| 4.7 | 命令结果显示 | 监听 device:result:delivered，显示输出 | 4.6 |

### Phase 5: 集成测试

| # | 任务 | 产出 | 依赖 |
|---|------|------|------|
| 5.1 | 全链路手动测试 | 手机→云→桌面→手机 完整流程 | 2.x, 3.x, 4.x |
| 5.2 | Bug 修复 | 稳定可演示的 PoC | 5.1 |
| 5.3 | 黑名单命令过滤 | 服务端拦截危险命令 (rm -rf, format 等) | 2.7 |

---

## 三、任务依赖图

```
Phase 0 (基础设施)
  0.1 ─┬── 0.2 ──── 0.5
       ├── 0.3 ──── 0.5
       └── 0.4

Phase 1 (共享类型)                Phase 2 (Server)
  0.4 ── 1.1 ─┐                    0.5 ── 2.1 ── 2.3
               ├── 1.3              0.5 ── 2.2
  0.4 ── 1.2 ─┘                    0.5 ── 2.4 ── 2.5 ─┐
                                                        ├── 2.7 ── 2.8 ── 2.9
                                    0.5 ── 2.6 ────────┘
                                    2.3 ───────────────┘

Phase 3 (Desktop)                 Phase 4 (Mobile)
  0.1 ── 3.1 ── 3.2               0.1 ── 4.1 ── 4.2 ── 4.3
                  │                                        │
                3.3 ─ 3.4                                4.4 ── 4.5 ── 4.6 ── 4.7
                  │
            3.5 ── 3.6
                │
              3.7 (optional)

Phase 5 (集成)
  2.x + 3.x + 4.x ── 5.1 ── 5.2 ── 5.3
```

---

## 四、技术实现要点

### 4.1 Server: Device Gateway 核心代码结构

```typescript
// packages/server/src/gateway/device.gateway.ts

@WebSocketGateway({ namespace: '/device' })
export class DeviceGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {

  @WebSocketServer()
  namespace: Namespace;

  afterInit(server: Namespace) {
    // 注册 JWT 认证中间件
    server.use(createWsAuthMiddleware(this.jwtService, this.userService));
  }

  async handleConnection(client: TypedSocket) {
    const userId = client.data.userId;
    client.join(`user:${userId}`);
    // 设备上线广播
  }

  async handleDisconnect(client: TypedSocket) {
    // 设备下线，更新 DB，广播状态
  }

  @SubscribeMessage('device:register')
  async handleRegister(client: TypedSocket, data: DeviceRegisterPayload) {
    // 注册/更新设备信息到 DB
    // 加入 device:{deviceId} 房间
  }

  @SubscribeMessage('device:command:send')
  async handleCommandSend(client: TypedSocket, data: WsEnvelope<DeviceCommandPayload>) {
    // 1. 黑名单检查
    // 2. 保存 command_log
    // 3. 转发到 device:{targetDeviceId} 房间
    // 4. ACK 给发送者
  }

  @SubscribeMessage('device:result:complete')
  async handleResult(client: TypedSocket, data: WsEnvelope<DeviceResultPayload>) {
    // 1. 更新 command_log
    // 2. 转发到 user:{userId} 房间 (排除桌面端自身)
  }
}
```

### 4.2 Desktop: 命令执行核心逻辑

```typescript
// packages/desktop/src/main/services/command-executor.service.ts

import { exec } from 'child_process';

export class CommandExecutor {
  async execute(command: string, timeout: number = 30000): Promise<CommandResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      exec(command, { timeout }, (error, stdout, stderr) => {
        resolve({
          status: error ? 'error' : 'success',
          data: {
            output: stdout || stderr,
            exitCode: error?.code ?? 0,
          },
          error: error ? {
            code: 'EXEC_ERROR',
            message: error.message,
          } : undefined,
          executionTimeMs: Date.now() - startTime,
        });
      });
    });
  }
}
```

### 4.3 Mobile: 命令发送 + 结果接收

```dart
// packages/mobile/lib/features/device/data/device_repository.dart

class DeviceRepository {
  final SocketIOClient _socket;

  Future<String> sendCommand({
    required String targetDeviceId,
    required String command,
  }) async {
    final requestId = const Uuid().v4();
    final commandId = const Uuid().v4();

    final response = await _socket.emitWithAck('device:command:send', {
      'requestId': requestId,
      'timestamp': DateTime.now().toIso8601String(),
      'data': {
        'commandId': commandId,
        'targetDeviceId': targetDeviceId,
        'type': 'shell',
        'action': command,
        'dangerLevel': 'safe',
      },
    });

    return commandId;
  }

  Stream<DeviceResult> onResult() {
    return _socket.on('device:result:delivered').map(
      (data) => DeviceResult.fromJson(data),
    );
  }
}
```

### 4.4 黑名单命令过滤

```typescript
// packages/server/src/devices/services/command-validator.service.ts

const DANGEROUS_COMMANDS = [
  /^rm\s+(-rf?|--recursive)\s+\//,     // rm -rf /
  /^rm\s+-rf?\s+~/,                     // rm -rf ~
  /^format\s/i,                         // format C:
  /^mkfs\./,                            // mkfs.ext4
  /^dd\s+if=/,                          // dd if=/dev/zero
  /^:\(\)\{.*\|.*&\s*\}\s*;/,          // fork bomb
  /shutdown|reboot|halt|poweroff/i,     // 关机/重启
  /^chmod\s+(-R\s+)?777\s+\//,         // chmod 777 /
  /^chown\s+(-R\s+)?.*\s+\//,          // chown -R ... /
];

export function isDangerousCommand(action: string): boolean {
  return DANGEROUS_COMMANDS.some(pattern => pattern.test(action.trim()));
}
```

---

## 五、REST API 端点 (Sprint 1 范围)

### Auth (已有，来自 brocoders)

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/v1/auth/email/register` | 注册 |
| POST | `/api/v1/auth/email/login` | 登录 → JWT |
| POST | `/api/v1/auth/refresh` | 刷新 token |
| POST | `/api/v1/auth/logout` | 登出 |
| PATCH | `/api/v1/auth/me` | 更新个人信息 |

### Devices (新建)

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/v1/devices` | 获取当前用户的设备列表 |
| GET | `/api/v1/devices/:id` | 获取单个设备详情 |
| PATCH | `/api/v1/devices/:id` | 更新设备信息 (名称) |
| DELETE | `/api/v1/devices/:id` | 删除设备 |

### Command Logs (新建)

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/v1/commands` | 获取命令执行历史 (分页) |
| GET | `/api/v1/commands/:id` | 获取单条命令详情 |

---

## 六、数据库 Migration (Sprint 1)

```
001_create_uuid_extension.ts     -- CREATE EXTENSION IF NOT EXISTS "uuid-ossp"
002_extend_users_table.ts        -- ALTER TABLE users ADD isOnline, lastSeenAt
003_create_devices_table.ts      -- CREATE TABLE devices (...)
004_create_command_logs_table.ts  -- CREATE TABLE command_logs (...)
```

---

## 七、Sprint 1 里程碑检查点

| 检查点 | 验收内容 | 对应任务 |
|--------|---------|---------|
| M1: Server 可运行 | 注册→登录→Swagger 可访问 | Phase 0 |
| M2: WS 可连接 | 客户端可通过 JWT 连接 /device 命名空间 | Phase 1-2 |
| M3: 桌面端可执行 | 桌面端接收命令→执行→返回结果 | Phase 3 |
| M4: 手机端可操控 | 手机端发命令→看到结果 | Phase 4 |
| M5: 全链路通 | 手机→云→桌面→手机 完整流程 < 3 秒 | Phase 5 |

---

## 八、Sprint 1 不做的事（明确排除）

| 功能 | 原因 |
|------|------|
| 好友系统 | 手机直接连自己的电脑，不需要好友 |
| 聊天消息 | Sprint 1 只做设备控制，社交在 Sprint 2+ |
| 群聊 | 同上 |
| AI (Draft & Verify) | Sprint 1 直接转发命令，不经过 LLM |
| 文件传输 | Sprint 1 只传文本命令和文本结果 |
| 推送通知 | Sprint 1 依赖 WebSocket 实时连接 |
| i18n | Sprint 1 硬编码英文，i18n 在 Sprint 2+ |
| OpenClaw 深度集成 | Sprint 1 用 child_process.exec，Sprint 2 对接 OpenClaw |
| 生产部署 | Sprint 1 全部跑 localhost |
