# LinkingChat 项目骨架结构

> 基于 brocoders/nestjs-boilerplate (Hexagonal Architecture) + Valkyrie v1 领域模型 + NestJS WebSocket Gateway

---

## 一、Monorepo 顶层结构

```
linkingchat/
├── packages/
│   ├── server/                    # Cloud Brain 后端 (NestJS)
│   ├── desktop/                   # 桌面端 (Electron + TypeScript)
│   ├── mobile/                    # 移动端 (Flutter)
│   └── shared/                    # 共享 TypeScript 类型定义
│
├── docker/                        # Docker 相关配置
│   ├── docker-compose.yaml        # 开发环境 (PostgreSQL + Redis + MinIO + Maildev)
│   ├── docker-compose.test.yaml   # 测试环境
│   └── docker-compose.prod.yaml   # 生产环境
│
├── docs/                          # 项目文档
│   └── dev-plan/                  # 开发计划（本目录）
│
├── .github/
│   └── workflows/
│       ├── ci.yaml                # CI: lint + test
│       └── deploy.yaml            # CD: 部署
│
├── package.json                   # Monorepo 根配置
├── pnpm-workspace.yaml            # pnpm workspace 定义
├── turbo.json                     # Turborepo 任务编排（可选）
├── tsconfig.base.json             # 共享 TypeScript 配置
├── .env.example                   # 环境变量模板
├── .gitignore
└── README.md
```

### pnpm-workspace.yaml

```yaml
packages:
  - "packages/*"
```

### 根 package.json

```json
{
  "name": "linkingchat",
  "private": true,
  "scripts": {
    "dev:server": "pnpm --filter @linkingchat/server start:dev",
    "dev:desktop": "pnpm --filter @linkingchat/desktop dev",
    "dev:all": "pnpm run --parallel dev:server dev:desktop",
    "build:server": "pnpm --filter @linkingchat/server build",
    "build:desktop": "pnpm --filter @linkingchat/desktop build",
    "build:shared": "pnpm --filter @linkingchat/shared build",
    "test": "pnpm --filter @linkingchat/server test",
    "test:e2e": "pnpm --filter @linkingchat/server test:e2e",
    "lint": "pnpm -r lint",
    "docker:up": "docker compose -f docker/docker-compose.yaml up -d",
    "docker:down": "docker compose -f docker/docker-compose.yaml down",
    "db:migrate": "pnpm --filter @linkingchat/server migration:run",
    "db:seed": "pnpm --filter @linkingchat/server seed:run"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

---

## 二、packages/shared/ — 共享类型包

```
packages/shared/
├── src/
│   ├── index.ts                           # 统一导出
│   │
│   ├── ws-events/                         # WebSocket 事件类型定义
│   │   ├── index.ts
│   │   ├── common.ts                      # WsEnvelope, WsError 等基础类型
│   │   ├── chat.events.ts                 # 聊天相关事件 payload
│   │   ├── device.events.ts               # 设备控制事件 payload
│   │   ├── ai.events.ts                   # AI 事件 payload (Whisper/Draft/Predictive)
│   │   └── constants.ts                   # 事件名称常量
│   │
│   ├── dto/                               # 共享 DTO 类型（不含 class-validator）
│   │   ├── user.dto.ts
│   │   ├── message.dto.ts
│   │   ├── device.dto.ts
│   │   └── conversation.dto.ts
│   │
│   └── enums/                             # 共享枚举
│       ├── device-platform.enum.ts        # windows | macos | linux
│       ├── message-type.enum.ts           # text | image | file | voice | command | result
│       └── command-danger-level.enum.ts   # safe | warning | dangerous
│
├── package.json                           # "@linkingchat/shared"
└── tsconfig.json
```

### package.json

```json
{
  "name": "@linkingchat/shared",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  }
}
```

---

## 三、packages/server/ — Cloud Brain 后端

基于 brocoders/nestjs-boilerplate fork，采用 Hexagonal Architecture。

```
packages/server/
├── src/
│   ├── main.ts                                 # 启动入口：创建 NestFactory, 挂载 RedisIoAdapter
│   ├── app.module.ts                           # 根模块
│   │
│   ├── config/                                 # 全局配置类型
│   │   └── config.type.ts                      # AllConfigType
│   │
│   │ ──────── 来自 brocoders 脚手架（已有） ────────
│   │
│   ├── auth/                                   # ✅ 已有：JWT 认证 (邮箱/密码 + 社交登录)
│   │   ├── config/auth.config.ts
│   │   ├── dto/
│   │   ├── strategies/
│   │   │   ├── jwt.strategy.ts                 # Access token 策略
│   │   │   └── jwt-refresh.strategy.ts         # Refresh token 策略
│   │   ├── guards/auth.guard.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.module.ts
│   │   └── auth.service.ts
│   │
│   ├── users/                                  # ✅ 已有：用户 CRUD (Hexagonal)
│   │   ├── domain/user.ts                      # 纯领域对象
│   │   ├── dto/
│   │   ├── infrastructure/persistence/
│   │   │   ├── user.repository.ts              # Port (抽象)
│   │   │   └── relational/
│   │   │       ├── entities/user.entity.ts     # TypeORM Entity
│   │   │       ├── mappers/user.mapper.ts      # Domain <-> Entity 映射
│   │   │       └── repositories/user.repository.ts  # Adapter (TypeORM)
│   │   ├── users.controller.ts
│   │   ├── users.module.ts
│   │   └── users.service.ts
│   │
│   ├── session/                                # ✅ 已有：JWT Session 管理 (Hexagonal)
│   ├── files/                                  # ✅ 已有：文件上传 (local / S3 / S3-presigned)
│   ├── mail/                                   # ✅ 已有：邮件发送
│   ├── mailer/                                 # ✅ 已有：底层 nodemailer
│   ├── roles/                                  # ✅ 已有：角色枚举
│   ├── statuses/                               # ✅ 已有：状态枚举
│   ├── home/                                   # ✅ 已有：健康检查
│   ├── i18n/                                   # ✅ 已有：国际化翻译文件
│   │
│   │ ──────── 需要新建的模块 ────────
│   │
│   ├── friends/                                # 🆕 好友系统 (Hexagonal)
│   │   ├── domain/
│   │   │   └── friend-request.ts
│   │   ├── dto/
│   │   │   ├── send-friend-request.dto.ts
│   │   │   └── friend-response.dto.ts
│   │   ├── infrastructure/persistence/
│   │   │   ├── friend.repository.ts            # Port
│   │   │   └── relational/
│   │   │       ├── entities/friend-request.entity.ts
│   │   │       ├── mappers/friend.mapper.ts
│   │   │       └── repositories/friend.repository.ts
│   │   ├── friends.controller.ts               # REST: /api/v1/friends
│   │   ├── friends.module.ts
│   │   └── friends.service.ts
│   │
│   ├── conversations/                          # 🆕 会话管理 (Hexagonal)
│   │   ├── domain/
│   │   │   ├── conversation.ts                 # 1:1 和群聊统一模型
│   │   │   └── conversation-member.ts
│   │   ├── dto/
│   │   ├── infrastructure/persistence/
│   │   │   ├── conversation.repository.ts      # Port
│   │   │   └── relational/
│   │   │       ├── entities/
│   │   │       │   ├── conversation.entity.ts
│   │   │       │   └── conversation-member.entity.ts
│   │   │       ├── mappers/
│   │   │       └── repositories/
│   │   ├── conversations.controller.ts         # REST: /api/v1/conversations
│   │   ├── conversations.module.ts
│   │   └── conversations.service.ts
│   │
│   ├── messages/                               # 🆕 消息 (Hexagonal)
│   │   ├── domain/
│   │   │   └── message.ts
│   │   ├── dto/
│   │   │   ├── send-message.dto.ts
│   │   │   └── message-response.dto.ts
│   │   ├── infrastructure/persistence/
│   │   │   ├── message.repository.ts           # Port
│   │   │   └── relational/
│   │   │       ├── entities/message.entity.ts
│   │   │       ├── mappers/message.mapper.ts
│   │   │       └── repositories/message.repository.ts
│   │   ├── messages.controller.ts              # REST: /api/v1/messages
│   │   ├── messages.module.ts
│   │   └── messages.service.ts
│   │
│   ├── devices/                                # 🆕 设备管理 (Hexagonal)
│   │   ├── domain/
│   │   │   ├── device.ts
│   │   │   └── command-log.ts
│   │   ├── dto/
│   │   │   ├── register-device.dto.ts
│   │   │   └── send-command.dto.ts
│   │   ├── infrastructure/persistence/
│   │   │   ├── device.repository.ts            # Port
│   │   │   └── relational/
│   │   │       ├── entities/
│   │   │       │   ├── device.entity.ts
│   │   │       │   └── command-log.entity.ts
│   │   │       ├── mappers/
│   │   │       └── repositories/
│   │   ├── devices.controller.ts               # REST: /api/v1/devices
│   │   ├── devices.module.ts
│   │   └── devices.service.ts
│   │
│   ├── gateway/                                # 🆕 WebSocket 网关
│   │   ├── adapters/
│   │   │   └── redis-io.adapter.ts             # Redis + Socket.IO 适配器
│   │   ├── middleware/
│   │   │   └── ws-auth.middleware.ts           # WebSocket JWT 认证中间件
│   │   ├── guards/
│   │   │   └── ws-auth.guard.ts               # WebSocket 事件级鉴权
│   │   ├── filters/
│   │   │   └── ws-exception.filter.ts         # WebSocket 异常过滤器
│   │   ├── chat.gateway.ts                     # /chat 命名空间: 聊天事件
│   │   ├── device.gateway.ts                   # /device 命名空间: 设备控制事件
│   │   ├── socket.service.ts                   # @Global 服务：供其他模块推送事件
│   │   └── gateway.module.ts
│   │
│   ├── ai/                                    # 🆕 AI 模块 (Sprint 2+，Q5 确认三模式全做)
│   │   ├── domain/
│   │   │   ├── ai-suggestion.ts               # Whisper + Predictive 建议
│   │   │   └── draft-state.ts                 # Draft & Verify 状态机
│   │   ├── dto/
│   │   │   ├── whisper-response.dto.ts
│   │   │   ├── draft-response.dto.ts
│   │   │   └── predictive-response.dto.ts
│   │   ├── infrastructure/persistence/
│   │   │   ├── ai-suggestion.repository.ts    # Port
│   │   │   ├── draft-state.repository.ts      # Port
│   │   │   └── relational/
│   │   │       ├── entities/
│   │   │       │   ├── ai-suggestion.entity.ts
│   │   │       │   └── draft-state.entity.ts
│   │   │       ├── mappers/
│   │   │       └── repositories/
│   │   ├── services/
│   │   │   ├── llm-router.service.ts          # 多 LLM 供应商路由 (DeepSeek / Kimi 2.5)
│   │   │   ├── whisper.service.ts             # Whisper 耳语建议生成 (<800ms)
│   │   │   ├── draft.service.ts               # Draft & Verify 状态机管理
│   │   │   └── predictive.service.ts          # Predictive Actions 上下文分析
│   │   ├── listeners/
│   │   │   └── message.listener.ts            # 监听 message:new 事件触发 AI 流程
│   │   ├── ai.controller.ts                   # REST: /api/v1/ai (草稿审批等)
│   │   ├── ai.module.ts
│   │   └── config/
│   │       └── ai.config.ts                   # LLM API keys, 超时配置, 模型选择
│   │
│   ├── database/
│   │   ├── data-source.ts                      # TypeORM DataSource (CLI)
│   │   ├── typeorm-config.service.ts
│   │   ├── migrations/                         # 数据库迁移
│   │   └── seeds/                              # 种子数据
│   │
│   └── utils/                                  # 工具函数
│       ├── infinity-pagination.ts              # ✅ 已有
│       ├── serializer.interceptor.ts           # ✅ 已有
│       └── id-generator.ts                     # 🆕 Snowflake ID 生成器
│
├── test/                                       # E2E 测试
│   ├── auth/
│   ├── friends/
│   ├── conversations/
│   ├── messages/
│   ├── devices/
│   └── utils/
│
├── package.json                                # "@linkingchat/server"
├── tsconfig.json
├── nest-cli.json
└── .env.example
```

### 模块依赖关系

```
                    app.module
                        │
         ┌──────────────┼──────────────────────┐
         │              │                      │
    ✅ 已有模块     🆕 社交模块            🆕 设备+AI 模块
         │              │                      │
    ├── auth        ├── friends            ├── devices
    ├── users       ├── conversations      ├── ai (Sprint 2+)
    ├── session     ├── messages           └── gateway (WS)
    ├── files       └── gateway (WS)            │
    ├── mail             │                      │
    └── i18n             └──────────┬───────────┘
                                    │
                            gateway.module
                            (@Global)
                                    │
                         ┌──────────┼──────────┐
                         │          │          │
                   chat.gateway  device.gateway  socket.service
                   (/chat 命名空间) (/device 命名空间) (事件推送服务)
                                    │
                              ai.module (Sprint 2+)
                                    │
                         ┌──────────┼──────────┐
                         │          │          │
                  llm-router   whisper.svc   draft.svc
                  (DeepSeek/    (<800ms)     (状态机)
                   Kimi 2.5)
```

### 关键设计决策

1. **Hexagonal Architecture**：遵循 brocoders 的 Port + Adapter 模式。Domain 对象是纯 TS 类，不依赖 ORM；TypeORM Entity 仅在 infrastructure 层；Mapper 负责双向转换。
2. **Gateway Module 为 @Global**：`SocketService` 全局注入，任何业务模块（friends, messages, conversations）都可以调用它来推送实时事件。参考 Valkyrie v1 的模式。
3. **REST-First Mutations**：所有数据变更走 REST API，WebSocket 仅用于广播实时事件和接收设备控制指令。参考 Valkyrie v1 的架构。
4. **双命名空间**：`/chat` 处理社交消息，`/device` 处理设备控制。各自独立连接、独立认证。

---

## 四、packages/desktop/ — Electron 桌面端

```
packages/desktop/
├── src/
│   ├── main/                              # Electron 主进程
│   │   ├── index.ts                       # Electron app 入口
│   │   ├── window.ts                      # BrowserWindow 管理
│   │   ├── ipc/                           # IPC 通信处理
│   │   │   ├── auth.ipc.ts               # 登录/登出 IPC
│   │   │   └── device.ipc.ts             # 设备命令 IPC
│   │   ├── services/
│   │   │   ├── ws-client.service.ts       # WebSocket 客户端 (连接 Cloud Brain)
│   │   │   ├── openclaw.service.ts        # OpenClaw Node 进程管理
│   │   │   └── auth-store.service.ts      # JWT token 本地存储
│   │   └── utils/
│   │       └── platform.ts               # 平台检测
│   │
│   ├── renderer/                          # Electron 渲染进程 (UI)
│   │   ├── index.html
│   │   ├── App.tsx                        # React/Vue 根组件
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Chat.tsx                   # 聊天主界面
│   │   │   └── DevicePanel.tsx            # 设备控制面板
│   │   ├── components/
│   │   │   ├── Sidebar.tsx                # 左侧导航栏
│   │   │   ├── ConversationList.tsx       # 会话列表
│   │   │   ├── MessageList.tsx            # 消息列表
│   │   │   ├── MessageInput.tsx           # 消息输入框
│   │   │   └── DeviceStatus.tsx           # 设备在线状态
│   │   └── stores/                        # 状态管理
│   │
│   └── preload/
│       └── index.ts                       # Preload 脚本 (contextBridge)
│
├── package.json                           # "@linkingchat/desktop"
├── tsconfig.json
├── electron-builder.yaml                  # Electron 打包配置
└── vite.config.ts                         # Vite 构建 (渲染进程)
```

### OpenClaw 集成关键代码

```typescript
// src/main/services/openclaw.service.ts
import { spawn, ChildProcess } from 'child_process';

export class OpenClawService {
  private process: ChildProcess | null = null;

  async start(gatewayToken: string, gatewayHost: string, gatewayPort: number) {
    this.process = spawn('openclaw', [
      'node', 'run',
      '--host', gatewayHost,
      '--port', String(gatewayPort),
      '--display-name', 'LinkingChat Desktop',
    ], {
      env: {
        ...process.env,
        OPENCLAW_GATEWAY_TOKEN: gatewayToken,
      },
    });

    this.process.on('exit', (code) => { /* 重启逻辑 */ });
    this.process.stderr?.on('data', (data) => { /* 错误日志 */ });
  }

  async stop() {
    this.process?.kill();
    this.process = null;
  }
}
```

---

## 五、packages/mobile/ — Flutter 移动端

```
packages/mobile/
├── lib/
│   ├── main.dart                          # App 入口
│   ├── app/
│   │   ├── app.dart                       # MaterialApp / Router
│   │   ├── routes.dart                    # 路由定义
│   │   └── di.dart                        # 依赖注入 (get_it / riverpod)
│   │
│   ├── core/
│   │   ├── network/
│   │   │   ├── api_client.dart            # HTTP 客户端 (dio)
│   │   │   ├── ws_client.dart             # WebSocket 客户端 (socket_io_client)
│   │   │   └── auth_interceptor.dart      # JWT token 拦截器
│   │   ├── storage/
│   │   │   └── secure_storage.dart        # Token 安全存储
│   │   └── constants/
│   │       └── ws_events.dart             # WebSocket 事件名称常量 (与 shared/ 对应)
│   │
│   ├── features/
│   │   ├── auth/
│   │   │   ├── data/
│   │   │   │   ├── auth_repository.dart
│   │   │   │   └── models/
│   │   │   ├── presentation/
│   │   │   │   ├── login_page.dart
│   │   │   │   └── register_page.dart
│   │   │   └── providers/
│   │   │       └── auth_provider.dart
│   │   │
│   │   ├── chat/
│   │   │   ├── data/
│   │   │   │   ├── chat_repository.dart
│   │   │   │   └── models/
│   │   │   ├── presentation/
│   │   │   │   ├── conversation_list_page.dart
│   │   │   │   ├── chat_page.dart
│   │   │   │   └── widgets/
│   │   │   │       ├── message_bubble.dart
│   │   │   │       └── message_input.dart
│   │   │   └── providers/
│   │   │       └── chat_provider.dart
│   │   │
│   │   ├── device/
│   │   │   ├── data/
│   │   │   │   ├── device_repository.dart
│   │   │   │   └── models/
│   │   │   ├── presentation/
│   │   │   │   ├── device_list_page.dart
│   │   │   │   ├── command_page.dart
│   │   │   │   └── widgets/
│   │   │   │       ├── device_card.dart
│   │   │   │       └── command_result.dart
│   │   │   └── providers/
│   │   │       └── device_provider.dart
│   │   │
│   │   └── friends/
│   │       ├── data/
│   │       ├── presentation/
│   │       └── providers/
│   │
│   └── l10n/                              # i18n 翻译文件
│       ├── app_en.arb
│       └── app_zh.arb
│
├── pubspec.yaml
├── analysis_options.yaml
└── test/
```

### 核心 Flutter 依赖

```yaml
# pubspec.yaml (关键依赖)
dependencies:
  flutter_riverpod: ^2.0.0     # 状态管理
  dio: ^5.0.0                  # HTTP 客户端
  socket_io_client: ^3.0.0     # Socket.IO 客户端
  go_router: ^14.0.0           # 路由
  flutter_secure_storage: ^9.0.0  # 安全存储 JWT
  flutter_localizations:       # i18n
    sdk: flutter
  intl: ^0.19.0                # i18n
```

---

## 六、Monorepo 依赖图

```
@linkingchat/shared
    │
    ├── @linkingchat/server (depends on shared)
    │
    └── @linkingchat/desktop (depends on shared)

@linkingchat/mobile (Flutter, 独立依赖管理)
    └── 手动同步 shared/ 中的类型定义到 Dart 常量
```

> **注意**：Flutter 无法直接使用 TypeScript 包。shared/ 中的事件名称和 payload 结构需要在 `lib/core/constants/ws_events.dart` 中手动镜像维护。后续可考虑使用 JSON Schema 或 Protocol Buffers 生成双端代码。
