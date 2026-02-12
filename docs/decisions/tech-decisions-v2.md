# LinkingChat 技术决策文档 v2

> 基于 follow-up-questions-v2.md 团队回答 + OpenClaw 调研 + 开源 IM 方案调研 + 脚手架选型的综合技术决策。
>
> 日期：2026-02-11

---

## 一、V2 追问回答汇总与分析

### 1.1 已明确的决策

| # | 问题 | 团队回答 | 对架构的影响 |
|---|------|---------|-------------|
| Q1 | 产品名称 | **linkingChat** | 仓库名/包名统一为 `linkingchat` 或 `linking-chat` |
| Q4 | MVP 社交功能 | 除语音/视频通话外**全部需要** | MVP 社交范围大，见下方详表 |
| Q5 | MVP AI 功能 | **都做**（三个模式全部） | Draft & Verify + Whisper + Predictive Actions 全部纳入 MVP |
| Q6 | 设备配对方式 | **同账号自动关联** | 不需要扫码/配对码流程，登录即绑定 |
| Q7 | 多台电脑 | **支持多台，发指令时选择目标** | 需要设备注册表 + 设备选择器 UI |
| Q8 | 远程命令安全 | **黑名单制**（屏蔽危险命令） | 需维护危险命令列表，其余放行 |
| Q9 | 消息协议 | **找一个 GitHub 开源项目** | 见下方「开源 IM 调研」章节 |
| Q10 | 文件存储 | **抄 Discord**（S3/对象存储 + CDN） | MVP 阶段用 S3 兼容存储（MinIO 本地/AWS S3 生产） |
| Q11 | WebSocket 认证 | **JWT** | 注册/登录返回 JWT token，WSS 连接时携带 |
| Q12 | 开发环境 | **先本地，后部署服务器** | 开发阶段三端跑 localhost |
| Q13 | 用户语言 | **从一开始就做 i18n 双语** | 需要引入 i18n 框架（Flutter: intl, Electron: i18next 等） |
| Q14 | 代码语言 | **代码英文，注释中文** | commit message 也建议用英文（当前仓库已是英文 commit） |
| Q15 | 第一个 Sprint | **同意最小 PoC** | 手机→云端→桌面执行→返回结果，不做好友/群聊/AI |

### 1.2 MVP 社交功能确认（Q4）

| 功能 | MVP？ | 备注 |
|------|-------|------|
| 邮箱注册 / 登录 | ✅ | |
| 好友系统（添加、删除、列表） | ✅ | |
| 1对1 文字聊天 | ✅ | |
| 1对1 文件/图片发送 | ✅ | |
| 群聊 | ✅ | |
| 消息推送（离线通知） | ✅ | |
| 用户头像 / 个人资料 | ✅ | |
| 在线/离线状态 | ✅ | |
| 消息已读回执 | ✅ | |
| 消息撤回 | ✅ | |
| 消息搜索 | ✅ | |
| 语音消息 | ✅ | |
| 语音/视频通话 | ❌ | 明确排除 |

> **注意**：12 项社交功能对 2-3 人团队是很大的工作量。建议在 Sprint 规划时分批交付，第一个 Sprint 只做最小 PoC（Q15），社交功能按优先级逐步加入。

### 1.3 仍需明确的问题

| 问题 | 状态 | 说明 |
|------|------|------|
| Q2: OpenClaw 到底是什么 | ✅ 已通过调研解决 | 见下方「OpenClaw 调研」章节 |
| Q3: OpenClaw 集成方式 | ✅ 已通过调研确定 | Electron 独立进程方式集成 |
| Q9: 消息协议选型 | ✅ 已通过调研确定 | 自建 + 参考开源项目，见下方 |

---

## 二、OpenClaw 技术调研

### 2.1 OpenClaw 是什么

OpenClaw 是一个**开源的、自托管的 AI Agent 网关**，TypeScript 编写，MIT 许可证。

| 属性 | 值 |
|------|-----|
| GitHub | [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) |
| npm | `openclaw` |
| 许可证 | **MIT** |
| 语言 | TypeScript (ESM, strict mode)，182,000+ 行 |
| 运行时 | Node.js 22+ |
| 最新版 | 2026.2.9 |
| GitHub Stars | 100,000+ |
| 创建者 | Peter Steinberger (@steipete, PSPDFKit 创始人) |
| 历史 | 2025.11 Clawd → Clawdbot → Moltbot → OpenClaw (2026.01.30) |

### 2.2 核心架构：Gateway + Node

```
┌──────────────────────────────┐         SSH反向隧道          ┌───────────────────────────────┐
│  AWS 云端 (公网)              │  ◄──── :18790 ────────────  │  本地机器 (NAT 内网)            │
│                              │                              │                               │
│  OpenClaw Gateway            │   WebSocket 指令 ──────►     │  OpenClaw Node                │
│  `openclaw serve`            │   ◄────── 结果/媒体回传      │  `openclaw node run`          │
│  :18789                      │                              │  :18790                       │
│                              │                              │                               │
│  ├── Agent (Claude/GPT)      │                              │  ├── system.run (Shell 执行)  │
│  ├── Tool Router             │                              │  ├── camera.snap/clip         │
│  ├── Media Understanding     │                              │  ├── screen.record            │
│  ├── WebSocket Server        │                              │  ├── canvas (可视化工作区)     │
│  └── Channel Adapters        │                              │  ├── Talk Mode / Voice Wake   │
│      (Telegram/WhatsApp/...) │                              │  ├── location.get (GPS)       │
│                              │                              │  └── system.notify (通知)     │
└──────────────────────────────┘                              └───────────────────────────────┘
```

**通信协议**：WebSocket JSON-RPC，三种消息类型：

```typescript
// 请求
{ type: "req", id: string, method: string, params: object }
// 响应
{ type: "res", id: string, ok: boolean, payload?: object, error?: object }
// 事件
{ type: "event", event: string, payload: object, seq?: number }
```

**认证方式**：
- Token-based：`OPENCLAW_GATEWAY_TOKEN` 环境变量
- WebSocket 连接时在 `connect.params.auth.token` 中携带
- HTTP：`Authorization: Bearer <token>`
- 非本地连接需要对 nonce 进行加密签名

### 2.3 Node 能力清单

| 能力 | 命令 | 平台支持 |
|------|------|---------|
| Shell 执行 | `system.run`, `system.which` | macOS, Linux, Windows (headless) |
| 拍照 | `camera.snap` | macOS, iOS, Android |
| 录像 (≤60s) | `camera.clip` | macOS, iOS, Android |
| 屏幕录制 (≤60s) | `screen.record` | macOS, iOS, Android |
| 可视化工作区 | `canvas.present/eval/snapshot` | macOS, iOS, Android |
| GPS 定位 | `location.get` | iOS, Android |
| 系统通知 | `system.notify` | macOS, iOS, Android |
| 语音唤醒 | Voice Wake + Talk Mode | macOS, iOS, Android |
| 短信 | `sms.send` | Android only |

### 2.4 安全模型 (exec-approvals)

| 安全级别 | 行为 | 适用场景 |
|---------|------|---------|
| `deny` | 禁止所有远程执行 | 最安全，纯聊天场景 |
| `allowlist` | 仅白名单命令可执行 | **默认模式**，推荐日常使用 |
| `ask` | 每条命令需要审批 | **推荐用于 Draft & Verify 模式** |
| `full` | 跳过所有审批 | 最不安全，仅限完全信任场景 |

> **重要**：架构图中 `defaults.security: "full"` 是最不安全的模式。LinkingChat 的 Draft & Verify 交互模式应该使用 `ask` 模式，让用户在手机端确认后再执行。

### 2.5 与 LinkingChat 的集成方案

**推荐方案：Electron 桌面端以独立进程方式运行 OpenClaw Node**

```typescript
// Electron main process 中
import { spawn } from 'child_process';

const openclawNode = spawn('openclaw', [
  'node', 'run',
  '--host', '127.0.0.1',
  '--port', '18789',
  '--display-name', 'LinkingChat Desktop'
], {
  env: {
    ...process.env,
    OPENCLAW_GATEWAY_TOKEN: token
  }
});
```

**选择独立进程（而非 npm 依赖内嵌）的理由**：

1. 符合 OpenClaw 的设计架构（Gateway + Node 分离）
2. Cloud Brain 本身已通过 WebSocket 与桌面端通信，协议一致
3. 安全模型（exec-approvals、配对）在独立进程模式下正常工作
4. OpenClaw 可独立更新，不影响 Electron 应用版本
5. OpenClaw 要求 Node.js 22+，而 Electron 内置的 Node 版本通常较旧

**注意事项**：
- **Windows 支持**：OpenClaw 官方推荐 WSL2，原生 Windows 支持不如 macOS 成熟。linkingChat 同时支持 Windows 和 macOS，需要提前验证 Windows 兼容性。
- **版本锁定**：OpenClaw 迭代极快，协议可能有 breaking changes，务必锁定版本。
- **设备身份**：已知 Bug [#4833](https://github.com/openclaw/openclaw/issues/4833) — `openclaw node run` 连接远程 Gateway 时可能因设备身份问题静默失败。

---

## 三、开源 IM 方案调研

### 3.1 候选项目对比

| 项目 | 后端语言 | 数据库 | Flutter SDK | 许可证 | WebSocket | 自定义消息类型 |
|------|---------|--------|------------|--------|-----------|-------------|
| **Spacebar** | TypeScript ✅ | PostgreSQL ✅ | ❌ 无 | AGPL ❌ | ✅ | 中等（需 fork） |
| **Rocket.Chat** | TypeScript ✅ | MongoDB ❌ | ✅ 官方 | MIT ✅ | DDP（非标准）❌ | 好（Apps Engine） |
| **Matrix/Synapse** | Python ❌ | PostgreSQL ✅ | ✅ 成熟 | AGPL ❌ | ✅ | 优秀（原生支持） |
| **Tinode** | Go ❌ | MySQL/PG/MongoDB ⚠️ | 🚨 Dart SDK 已归档 | GPL ❌ | ✅ | 有限 |
| **Revolt/Stoat** | Rust ❌ | MongoDB ❌ | ❌ 无 | AGPL ❌ | ✅ | 中等（需 fork Rust） |
| **Tailchat** | TypeScript ✅ | **MongoDB ❌** | ❌ React Native | Apache-2.0 ✅ | Socket.IO ✅ | 好（MiniStar 插件） |
| **Dendrite** | Go ❌ | PostgreSQL ✅ | ❌ 无（SDK=AGPL） | **AGPL ❌** | Matrix ✅ | 优秀（Matrix 原生） |
| **Conduit** | Rust ❌ | **RocksDB ❌** | ❌ 无（SDK=AGPL） | Apache-2.0 ✅ | Matrix ✅ | 优秀（Matrix 原生） |
| **Mattermost** | Go ❌ | PostgreSQL ✅ | ❌ 社区 | MIT ✅ | ✅ | 有限（Go 插件） |
| **Zulip** | Python ❌ | PostgreSQL ✅ | ✅ 官方 | Apache-2.0 ✅ | ✅ | 有限 |

### 3.2 核心结论

**没有任何现有开源 IM 平台同时满足 TypeScript + PostgreSQL + Flutter SDK + 宽松许可证。**

| 需求 | 匹配的项目 | 致命缺陷 |
|------|-----------|---------|
| TypeScript 后端 | Spacebar, Rocket.Chat | Spacebar=AGPL, Rocket.Chat=MongoDB |
| PostgreSQL | Spacebar, Mattermost, Zulip | Spacebar=AGPL, 其余非 TypeScript |
| Flutter SDK | Rocket.Chat, Matrix, Tinode, Zulip | 许可证或语言不匹配 |
| MIT/Apache 许可 | Rocket.Chat, Mattermost | 数据库或语言不匹配 |

### 3.3 各项目的参考价值

虽然不能直接采用，但每个项目在特定方面值得学习：

| 学什么 | 从哪个项目学 | 原因 |
|--------|------------|------|
| WebSocket Gateway 架构 | **Spacebar** (`src/gateway/`) | TypeScript，Discord 风格事件分发，心跳/重连 |
| PostgreSQL 聊天数据 Schema | **Mattermost** (`server/channels/store/sqlstore/`) | 生产级 PG schema，消息/频道/用户表设计 |
| TypeORM 实体设计 | **Spacebar** (`src/util/entities/`) | User/Message/Channel/Relationship 实体 |
| 可扩展消息协议设计 | **Matrix 规范** (extensible events MSC1767) | 命名空间化事件类型，设备控制可复用此模式 |
| Flutter 聊天 SDK API 设计 | ~~**Tinode Dart SDK**~~ (已归档) | ⚠️ SDK 已于 2025-11 归档，仅供协议层参考 |
| Flutter 聊天 UI 组件 | **Rocket.Chat Flutter SDK** | 消息列表、输入栏、文件选择器组件 |
| REST API 设计模式 | **Discord API 文档**（公开） | 端点命名、分页、限流、错误格式 |
| 推送通知集成 | **Tinode** (TNPG 服务) | FCM / APNs 模式 |
| 文件存储架构 | **Spacebar CDN** + **Revolt/Stoat Autumn** | 独立文件服务 + 预签名 URL + 元数据追踪 |
| 前端微内核插件架构 | **Tailchat MiniStar** | 桌面端 Electron 模块化设计参考 |
| Flutter DDD 分层架构 | **ValkyrieApp** | Application/Domain/Infrastructure/Presentation 四层 + BLoC + freezed |
| Extensible Events 消息扩展 | **Matrix MSC1767** | AI 消息多内容块 + 降级回退机制 |

---

## 四、脚手架选型

### 4.1 许可证筛选（硬约束）

| 许可证 | 含义 | 能否作为商业产品脚手架？ |
|--------|------|------------------------|
| **MIT** | 随便用，不要求开源 | ✅ 可以 |
| **Apache-2.0** | 类似 MIT，有专利授权 | ✅ 可以 |
| **AGPL-3.0** | 部署为网络服务也必须开源全部代码 | ❌ 致命 |
| **GPL-3.0** | 分发时必须开源 | ❌ 致命 |

### 4.2 候选脚手架评估

| 排名 | 项目 | Stars | 许可证 | WebSocket | 聊天功能 | JWT 认证 | PostgreSQL | 活跃度 |
|------|------|-------|--------|-----------|---------|---------|-----------|--------|
| 1 | **brocoders/nestjs-boilerplate** | ~4,200 | MIT | ❌ | ❌ | ✅ | ✅ | 2026.01 活跃 |
| 2 | **sentrionic/Valkyrie (v1)** | 331 | MIT | ✅ | ✅ 完整 Discord 克隆 | Sessions | ✅ | 2022.06 停更 |
| 3 | NarHakobyan/awesome-nest-boilerplate | ~2,800 | MIT | ❌ | ❌ | ✅ | ✅ | 2025.02 |
| 4 | mokuteki225/nest-websockets-chat-boilerplate | 112 | MIT | ✅ | ✅ 基础聊天室 | ✅ | ✅ | ~2022 |
| 5 | josephgoksu/prime-nestjs | 446 | MIT | ❌ | ❌ | ✅ RSA256 | ✅ | 活跃 |
| 6 | mahdi-vajdi/nestjs-chat | 6 | MIT | ✅ | ✅ 可扩展 | ✅ RSA | ✅ | 活跃 |
| 7 | notiz-dev/nestjs-prisma-starter | ~2,500 | MIT | ❌ | ❌ | ✅ | ✅ Prisma | 活跃 |
| 8 | hmake98/nestjs-starter | 32 | MIT | ❌ | ❌ | ✅ | ✅ Prisma | 活跃 |

### 4.3 推荐组合方案

#### 主脚手架：brocoders/nestjs-boilerplate（MIT, ⭐4200）

**已有能力（开箱即用）**：

| 能力 | 状态 | 对 linkingChat 的价值 |
|------|------|---------------------|
| 邮箱注册/登录 + 社交登录 (Apple/Google/Facebook) | ✅ | 直接覆盖 Q4 注册/登录需求 |
| JWT 认证 | ✅ | 直接覆盖 Q11 |
| 用户角色 (Admin/User) | ✅ | 可扩展为群主/管理员/普通成员 |
| 文件上传（本地 + Amazon S3） | ✅ | 直接覆盖 Q10 文件存储需求 |
| I18N 国际化 | ✅ | 直接覆盖 Q13 |
| TypeORM + PostgreSQL + Migration | ✅ | 核心数据层 |
| Swagger API 文档 | ✅ | 前后端协作 |
| Docker + docker-compose | ✅ | 直接覆盖 Q12 开发环境 |
| E2E + Unit 测试 | ✅ | 直接覆盖决策清单中的测试要求 |
| 邮件发送 (nodemailer) | ✅ | 注册验证、通知 |
| GitHub Actions CI | ✅ | 持续集成 |

**需要自建的部分**：WebSocket Gateway、聊天模块、好友系统、群组系统、设备控制协议。

> 这个脚手架能省掉的工作（认证、文件上传、i18n、Docker、测试框架、CI）至少占 MVP 总工作量的 30-40%。

#### 聊天层领域模型参考：sentrionic/Valkyrie v1（MIT, ⭐331）

这是唯一用 **NestJS + TypeScript + PostgreSQL + Socket.IO** 实现的完整 Discord 克隆（v1 分支）。

**可提取的设计模式**：

| 模块 | Valkyrie v1 中的实现 | 提取方式 |
|------|---------------------|---------|
| 好友系统 | Friend Request / Accept / Reject / Block | 提取 Entity + Service 逻辑 |
| 私聊 DM | Direct Message Channel + 消息 CRUD | 提取 Channel + Message Entity |
| 群组/Server | Server + Channel + Member + Role | 提取数据模型，简化 Role 体系 |
| WebSocket Gateway | Socket.IO 事件分发 + 房间管理 | 提取 Gateway 架构模式 |
| 文件上传 | 头像 / 消息附件 → S3 | 已由 brocoders 覆盖 |
| 通知系统 | 未读消息计数 + 实时通知 | 提取事件模型 |

> **注意**：不是 fork Valkyrie，而是从中提取设计模式和领域模型，移植到 brocoders 脚手架上。Valkyrie v1 已于 2022 年停更（作者用 Go 重写了 v2），但其 NestJS 版本的架构设计仍然有很高的参考价值。

#### WebSocket 扩展参考：mahdi-vajdi/nestjs-chat（MIT, ⭐6）

虽然 star 少，但架构质量最高：

| 亮点 | 说明 |
|------|------|
| Redis 适配器 | Socket.IO + Redis，支持水平扩展（多实例部署） |
| RSA JWT | 非对称加密 token，比 HMAC 更安全 |
| Clean Architecture | application / infrastructure / presentation 分层 |
| TypeORM + Migration | 与 brocoders 脚手架一致 |

### 4.4 许可证安全性确认

| 来源 | 许可证 | 用法 | 法律风险 |
|------|--------|------|---------|
| brocoders/nestjs-boilerplate | **MIT** | 直接 fork 作为项目基础 | ✅ 零风险 |
| sentrionic/Valkyrie v1 | **MIT** | 提取代码模式移植 | ✅ 零风险 |
| mahdi-vajdi/nestjs-chat | **MIT** | 参考架构设计 | ✅ 零风险 |
| OpenClaw | **MIT** | 独立进程运行，WebSocket 通信 | ✅ 零风险 |
| Spacebar | AGPL-3.0 | **仅阅读学习，绝不复制代码** | ✅ 阅读不传染 |
| Matrix 规范 | Apache-2.0 | 参考协议设计思路 | ✅ 零风险 |
| Discord API 文档 | 公开文档 | 参考 API 设计模式 | ✅ 零风险 |

---

## 五、推荐技术栈

基于以上调研确定的完整技术栈：

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| **Cloud Brain 后端** | NestJS + TypeScript + TypeORM + PostgreSQL + Redis | 基于 brocoders 脚手架 |
| **实时通信** | Socket.IO over WebSocket | JSON 协议，命名空间化事件类型 |
| **文件存储** | S3 兼容（开发: MinIO，生产: AWS S3 / 阿里 OSS） | brocoders 已内置 S3 支持 |
| **推送通知** | FCM (Android) + APNs (iOS) | |
| **移动端** | Flutter + web_socket_channel + Riverpod/Bloc | |
| **桌面端** | Electron + TypeScript | 社交 UI + OpenClaw Node 进程管理 |
| **设备执行** | OpenClaw (独立进程) | Electron 通过 WebSocket 与 OpenClaw Node 通信 |
| **LLM 路由** | 多供应商 (DeepSeek 轻量任务, Kimi 2.5 复杂任务) | |
| **共享类型** | TypeScript 协议包 (monorepo) + Dart 代码生成 | 前后端类型安全 |
| **测试** | Vitest / Jest | brocoders 已内置测试框架 |
| **CI/CD** | GitHub Actions | brocoders 已内置 |
| **容器化** | Docker + docker-compose | brocoders 已内置 |

---

## 六、执行路径

### Phase 0: 项目初始化

```
1. Fork brocoders/nestjs-boilerplate 作为 Cloud Brain 后端
2. 配置 monorepo 结构 (pnpm workspace 或 turborepo)：
   packages/
   ├── server/          ← brocoders 脚手架 (NestJS)
   ├── desktop/         ← Electron 桌面端
   ├── mobile/          ← Flutter 移动端
   └── shared/          ← 共享 TypeScript 类型定义
3. 确认开发环境：PostgreSQL + Redis + MinIO (Docker Compose)
4. 验证 brocoders 脚手架能跑通：注册、登录、文件上传
```

### Phase 1: 第一个 Sprint — 最小 PoC（Q15 确认的范围）

> **目标**：手机发一条文字指令 → 云端转发 → 桌面端执行 Shell 命令 → 结果返回手机显示

```
1. Cloud Brain: 添加 WebSocket Gateway 模块 (NestJS @WebSocketGateway)
   - 参考 mahdi-vajdi/nestjs-chat 的 Gateway 架构
   - 实现 device.command / device.result 事件类型
   - JWT 认证 over WebSocket

2. Desktop (Electron): 最小骨架
   - WebSocket 连接到 Cloud Brain
   - 接收 device.command 事件
   - 调用 OpenClaw Node 执行命令 (spawn openclaw node run)
   - 返回 device.result 事件

3. Mobile (Flutter): 最小骨架
   - 登录界面 (调用 Cloud Brain JWT API)
   - 命令输入界面
   - WebSocket 连接，发送 device.command，显示 device.result

不需要：好友系统、AI 功能、群聊、文件传输
```

### Phase 2: 社交基础层

```
1. 从 Valkyrie v1 提取并移植到 server/：
   - User Entity 扩展（头像、个人资料、在线状态）
   - Friend 模块（添加/删除/列表/屏蔽）
   - Conversation Entity（1对1 私聊）
   - Message Entity + CRUD（发送/撤回/搜索）

2. WebSocket 社交事件：
   - message.create / message.update / message.delete
   - friend.request / friend.accept / friend.reject
   - presence.update (在线/离线)
   - message.read (已读回执)

3. Flutter 移动端：
   - 好友列表 + 添加好友
   - 1对1 聊天界面
   - 消息列表（文字 + 图片 + 文件）

4. Electron 桌面端：
   - 社交 UI（类 Discord 布局）
   - 同步所有社交功能
```

### Phase 3: 社交扩展 + AI（全部三个 AI 模式）

```
1. 群聊模块
   - Group Entity + Member + Role
   - 群消息广播

2. 文件/媒体增强
   - 图片/文件上传到 S3
   - 语音消息录制 + 播放
   - 消息搜索（PostgreSQL 全文搜索）

3. 推送通知
   - FCM (Android) + APNs (iOS)
   - 离线消息队列 (Redis)

4. AI 模块（Q5 确认：三个模式全做）
   a. Draft & Verify（草稿确认）[P0]
      - LLM Router (DeepSeek / Kimi 2.5)
      - 草稿生成 → 用户确认 → 执行
      - 与 OpenClaw exec-approvals `ask` 模式对接
      - 数据表：draft_states

   b. The Whisper（耳语建议）[P1]
      - 收到新消息 → LLM 生成 3 条回复建议 → <800ms 推送到客户端
      - 超过 1000ms 客户端放弃显示
      - 使用 DeepSeek（低延迟）做建议生成
      - 数据表：ai_suggestions (type='whisper')

   c. Predictive Actions（预测执行）[P0]
      - 分析对话上下文（如 shell 错误）→ 生成动作卡片
      - 安全分级（safe/warning/dangerous）与黑名单制协同
      - 数据表：ai_suggestions (type='predictive')
```

### Phase 4: 生产化

```
1. 云端部署（从 localhost 迁移到服务器）
2. SSL/TLS 证书 + WSS
3. 性能优化（消息延迟 <2s，AI 建议 <800ms）
4. 安全审计（黑名单命令列表、JWT 过期策略、速率限制）
5. i18n 完善（中英双语）
```

---

## 七、风险与缓解

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| MVP 社交功能范围过大（12 项） | 🔴 高 | 严格按 Phase 分批交付，Phase 1 只做最小 PoC |
| OpenClaw Windows 支持不成熟 | 🟡 中 | Phase 1 提前在 Windows 上验证 OpenClaw Node |
| OpenClaw 快速迭代导致 breaking changes | 🟡 中 | 锁定 OpenClaw 版本，不追最新 |
| 2-3 人团队同时维护三端代码 | 🟡 中 | monorepo + 共享类型，前后端分工明确 |
| 自建 IM 协议的可靠性 | 🟡 中 | 参考成熟项目设计，从 Phase 1 开始写集成测试 |

---

## 附录 A：Tinode 调研结论（2026-02-11 补充）

> 团队同事提议使用 [tinode/chat](https://github.com/tinode/chat) 作为 IM 后端。经深度调研后结论如下。
> 完整调研报告见 `docs/dev-plan/research-tinode.md`。

### 结论：不采用 Tinode 做后端，但借鉴其协议设计

**不采用的原因**（按严重程度排序）：

| # | 原因 | 严重程度 |
|---|------|---------|
| 1 | Dart SDK 已归档（2025-11-18），仅有 Dart 2.12 alpha 版本，不兼容 Dart 3.x | 🚨 致命 |
| 2 | GPL-3.0 许可证：虽有 SaaS loophole，但限制分发场景 | 🚨 高 |
| 3 | Go 语言 vs 团队确认的 TypeScript everywhere | 🚨 高 |
| 4 | AI 三模式（Draft & Verify + Whisper + Predictive Actions）需要 gRPC 插件桥接，<800ms 延迟约束有风险 | ⚠️ 高 |
| 5 | 设备远程控制是 linkingChat 核心差异化功能，Tinode 无此概念 | ⚠️ 中 |

**从 Tinode 借鉴的设计**：

| 借鉴内容 | 应用方式 |
|---------|---------|
| Topic 类型体系 (me/fnd/usr/grp/chn) | 丰富 Conversation type 设计 |
| `{note}` kp/recv/read 事件 | WebSocket 输入状态 + 送达确认 + 已读回执设计 |
| 位图 ACL (JRWPASDON, Want+Given→Effective) | 未来群权限系统参考 |
| FireHose CONTINUE/DROP/RESPOND/REPLACE | AI 消息拦截器模式灵感 |
| seq/recv/read 三标记 | 消息送达追踪方案参考 |

---

## 附录 B：Gemini 推荐项目调研结论（2026-02-11 补充）

> 团队同事通过 Gemini 推荐了 Tailchat、Dendrite、Conduit 等项目。经深度调研后结论如下。
> 完整调研报告见 `docs/dev-plan/research-gemini-projects.md`。

### 结论：所有推荐项目均不适合作为 LinkingChat 核心后端

**原始报告存在的重大错误**：

| # | 错误 | 实际情况 |
|---|------|---------|
| 1 | Dendrite 许可证为 Apache-2.0 | **已变更为 AGPL-3.0**（2023-11） |
| 2 | Tailchat 为旗舰级推荐 | MongoDB only / Moleculer 非 NestJS / React Native 非 Flutter |
| 3 | Conduit 活跃开发中 | 已被 conduwuit → Tuwunel 取代，RocksDB only |

**从这些项目借鉴的设计**：

| 借鉴内容 | 来源 | 应用方式 |
|---------|------|---------|
| 前端微内核插件架构 | Tailchat MiniStar | Electron 桌面端模块化参考 |
| Extensible Events (MSC1767) | Matrix 规范 | AI 消息扩展协议设计 |
| Application Service 模式 | Matrix 规范 | 服务端事件拦截器设计参考 |
| to-device 消息机制 | Matrix 规范 | 设备控制指令推送参考 |

---

## 附录 C：参考资源

| 资源 | 链接 | 用途 |
|------|------|------|
| brocoders/nestjs-boilerplate | https://github.com/brocoders/nestjs-boilerplate | 主脚手架 |
| sentrionic/Valkyrie v1 | https://github.com/sentrionic/Valkyrie/tree/v1 | 聊天领域模型参考 |
| mahdi-vajdi/nestjs-chat | https://github.com/mahdi-vajdi/nestjs-chat | WebSocket 架构参考 |
| OpenClaw 文档 | https://docs.openclaw.ai | OpenClaw 集成参考 |
| OpenClaw GitHub | https://github.com/openclaw/openclaw | OpenClaw 源码 |
| Matrix 规范 | https://spec.matrix.org/latest/ | 消息协议设计参考 |
| Discord API 文档 | https://discord.com/developers/docs | REST API 设计参考 |
| Tinode 调研报告 | docs/dev-plan/research-tinode.md | Tinode 深度调研（许可证、协议、Flutter SDK、对比分析） |
| Tinode Dart SDK（已归档） | https://github.com/tinode/dart-sdk | ⚠️ 2025-11 归档，仅供参考 |
| Gemini 推荐项目调研报告 | docs/dev-plan/research-gemini-projects.md | Tailchat、Dendrite、Conduit、Matrix 评估 |
| Tailchat | https://github.com/msgbyte/tailchat | 微内核插件架构参考（MongoDB，不直接使用） |
| Dendrite | https://github.com/element-hq/dendrite | Matrix Go 服务端（AGPL-3.0，仅参考） |
| ValkyrieApp (Flutter) | https://github.com/sentrionic/ValkyrieApp | Flutter DDD 架构 + BLoC 模式参考 |
| Spacebar Server | https://github.com/spacebarchat/server | TypeORM Entity 设计参考（仅阅读） |
| Mattermost | https://github.com/mattermost/mattermost | PostgreSQL Schema 参考 |
