# Neural Link 技术调研报告

> 调研日期：2026-02-11
> 目的：为 Neural Link 项目的技术选型和架构设计提供参考

---

## 一、开源社交 / IM 平台（可直接参考的项目）

### 1.1 生产级项目（成熟、大规模使用）

| 项目 | Stars | 技术栈 | 特点 | 参考价值 |
|------|-------|--------|------|---------|
| [Rocket.Chat](https://github.com/RocketChat/Rocket.Chat) | 42k+ | **Node.js + TypeScript + Meteor + MongoDB** | 企业级 IM，支持频道/DM/文件/视频，有 React 前端和 React Native 移动端 | **后端架构参考首选** — 同为 Node.js/TS 技术栈，插件系统和 SDK 设计值得学习 |
| [Element / Matrix](https://github.com/element-hq/element-web) | 11k+ | **React + TypeScript + Matrix 协议** | 去中心化 IM，支持桥接 Slack/Discord/Telegram | Matrix 协议设计很优秀，但去中心化对 Neural Link 不必要 |
| [Mattermost](https://github.com/mattermost/mattermost) | 31k+ | **Go + React + PostgreSQL** | 企业 Slack 替代品，完整的频道/搜索/文件/推送 | **PostgreSQL 消息存储设计** 值得参考（我们也用 PG） |

### 1.2 Discord 克隆 / 替代品

| 项目 | Stars | 技术栈 | 特点 | 参考价值 |
|------|-------|--------|------|---------|
| [Revolt / Stoat](https://github.com/revoltchat) | 2k+ | **Rust 后端 + MongoDB + Redis + RabbitMQ**，前端 TypeScript (Preact/SolidJS) | 最像 Discord 的开源替代品，UI 几乎一致 | **UI/UX 设计参考** — 频道布局、消息列表、成员面板等 |
| [Spacebar](https://github.com/spacebarchat/server) | 4k+ | **TypeScript 后端**，Discord API 完全兼容 | 反向工程实现了 Discord 后端，可直接用 Discord 客户端连接 | **最重要参考** — TypeScript 实现的 Discord 后端，WebSocket 协议、API 设计、数据模型都可以直接学习 |
| [discord-clone (nayak-nirmalya)](https://github.com/nayak-nirmalya/discord-clone) | 1k+ | **Next.js + TypeScript + Socket.io + Prisma + MySQL** | 全栈 Discord 克隆，含频道/DM/文件/语音(LiveKit) | 代码简洁，适合快速理解 Discord 核心功能的实现方式 |

### 1.3 Flutter + Node.js 聊天项目

| 项目 | 技术栈 | 参考价值 |
|------|--------|---------|
| [flutter_chat_app_with_nodejs](https://github.com/RodrigoBertotti/flutter_chat_app_with_nodejs) | **Flutter + Node.js + MySQL + WebSocket** (TypeORM) | 与我们的技术栈最接近，可用 PostgreSQL 替换 MySQL（TypeORM 支持）|
| [chat_app (gabryelferreira)](https://github.com/gabryelferreira/chat_app) | **Flutter + Node.js + Socket.io + MongoDB + Firebase Messaging** | Flutter ↔ Node.js 的 WebSocket 通信实现参考 |
| [Flutter-Chat-App (tushar-prabhu)](https://github.com/tushar-prabhu/Flutter-Chat-App) | **Flutter + Node.js + WebSocket** | 极简实现，适合理解 Flutter WebSocket 通信基础 |

---

## 二、Discord 架构深度研究

### 2.1 Discord 核心技术架构

```
客户端 (Web/Desktop/Mobile)
    │
    ├── WebSocket Gateway ──── 实时消息、状态更新、typing 指示器
    │    (Elixir/BEAM)          分片设计，每个 shard ~5000 用户
    │
    ├── REST API ──────────── 历史消息查询、频道管理、用户操作
    │    (Python monolith)
    │
    ├── Voice Server ─────── WebRTC 音视频
    │    (C++ media engine)    850+ 服务器，13 个区域
    │
    └── CDN (Cloudflare) ──── 图片、文件、头像等静态资源
```

### 2.2 关键设计决策（对 Neural Link 的启示）

| Discord 的做法 | 对 Neural Link 的建议 |
|---------------|---------------------|
| **WebSocket Gateway 分片** — 每 shard 约 5000 用户 | MVP 阶段不需要分片，但协议设计要预留 shard_id 字段 |
| **Pub/Sub 消息分发** — 用 Kafka/RabbitMQ 解耦发送和投递 | MVP 可简化：直接在内存中维护 userId → WebSocket 映射，后期加 Redis Pub/Sub |
| **消息存储 ScyllaDB** — 从 MongoDB 迁移到 ScyllaDB | 我们用 **PostgreSQL** 即可，初期数据量不大；消息表按 conversation_id 分区 |
| **REST API + WebSocket 并行** — 查询走 REST，实时走 WS | **强烈建议采用**：历史消息/好友列表/登录等走 REST API，实时消息/状态走 WebSocket |
| **文件存储 GCS + Cloudflare CDN** | MVP 建议用 **S3 兼容存储**（AWS S3 / 阿里 OSS），URL 签名访问 |
| **WebSocket 认证** — 连接后发 Identify 消息，携带 token | 建议采用同样模式：WS 连接建立后，首条消息为 AUTH，携带 JWT |
| **心跳机制** — 服务端要求客户端定期发送 heartbeat | 采用：每 30s ping/pong，3 次未响应标记离线 |
| **Gateway Intents** — 客户端声明订阅哪些事件类型 | 后期可加，MVP 不需要 |

### 2.3 Discord WebSocket 协议结构（简化版）

```typescript
// Discord 的 Gateway 消息结构
interface GatewayPayload {
  op: number;       // opcode: 0=Dispatch, 1=Heartbeat, 2=Identify, ...
  d: any;           // data
  s?: number;       // sequence number (用于断线重连)
  t?: string;       // event name (如 "MESSAGE_CREATE")
}

// Neural Link 建议采用类似结构
interface NLGatewayMessage {
  op: number;       // 0=Event, 1=Heartbeat, 2=Auth, 3=HeartbeatACK
  d: any;           // payload data
  s?: number;       // sequence (断线重连)
  t?: string;       // event type: "MESSAGE_CREATE" | "TASK_RESULT" | "DRAFT_READY" | ...
}
```

### 2.4 推荐参考的 Spacebar 项目

[Spacebar Server](https://github.com/spacebarchat/server) 是用 **TypeScript** 从零实现的 Discord 后端，与 Discord API 完全兼容。它是我们最直接的参考：

- **协议层**：完整实现了 Discord 的 WebSocket Gateway 协议
- **数据模型**：TypeORM + 支持 PostgreSQL / MySQL / SQLite
- **REST API**：完整的 Discord REST API 实现
- **认证**：JWT token 机制
- **权限系统**：Discord 的位运算权限模型

> **建议**：深入阅读 Spacebar 的 `src/gateway/` 和 `src/api/` 目录，作为 Neural Link 后端的参考蓝本。

---

## 三、OpenClaw 调研（核心依赖）

### 3.1 OpenClaw 是什么

| 属性 | 内容 |
|------|------|
| **仓库** | [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) |
| **Stars** | **68,000+** |
| **性质** | 开源 AI 个人助手，本地优先架构 |
| **创始人** | Peter Steinberger (PSPDFKit 创始人) |
| **安装** | `npm install -g openclaw@latest`（需 Node ≥ 22）|
| **运行方式** | 本地守护进程（daemon），通过 Gateway 统一管理 |
| **历史** | Clawdbot → Moltbot → OpenClaw (2026.01.30 改名) |

### 3.2 OpenClaw 核心能力

| 能力 | 描述 | 对 Neural Link 的价值 |
|------|------|---------------------|
| **Shell 执行** | 读写文件、运行 Shell 命令、执行脚本 | **直接可用** — 桌面端远程执行的核心能力 |
| **浏览器控制** | 管理 Chromium 实例，CDP 协议控制 | P1 功能，MVP 可先不集成 |
| **消息桥接** | WhatsApp/Telegram/Discord/Slack/iMessage/Teams/Signal | 有趣但不是 Neural Link 的核心需求 |
| **AI Agent** | 模型无关，支持多 provider，本地/云端 LLM | **高度契合** — 与 Neural Link 的 LLM Router 目标一致 |
| **工具/技能系统** | 100+ 预配置 AgentSkills | 可选择性使用其中的 Shell/File 相关 skills |
| **安全模式** | `exec.ask: "on"` 需用户确认 | **必须启用** — 与 Draft & Verify 模式一致 |
| **Tailscale 远程** | 通过 Tailscale 暴露 Gateway，支持远程访问 | 备选方案，但我们用自己的 WSS 通道 |

### 3.3 集成方案分析

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **A. npm 依赖引入** | 简单，直接 `require('openclaw')` | OpenClaw 是 CLI 工具 + daemon，不是 library；API 不稳定 | ⭐⭐ |
| **B. 独立进程 + IPC** | 解耦好，OpenClaw 独立升级 | 需要用户额外安装 OpenClaw；进程管理复杂 | ⭐⭐⭐ |
| **C. Fork 核心代码** | 完全控制，可深度定制 | 维护成本高，跟不上上游更新 | ⭐⭐ |
| **D. 参考思路自研** | 最轻量，无外部依赖 | 需要自己实现 Shell/File 执行层 | ⭐⭐⭐⭐ |
| **E. 混合方案** | Electron 内嵌 OpenClaw Gateway，通过内部 API 调用 | 技术可行但较复杂 | ⭐⭐⭐ |

> **推荐方案 D**：MVP 阶段自研一个轻量的 TaskExecutor 模块（Shell + File），参考 OpenClaw 的工具接口设计。原因：
> 1. OpenClaw 太重（68k stars 的大型项目，功能远超我们需求）
> 2. 我们只需要 Shell 执行 + 文件操作，几百行代码就够了
> 3. 后期如需更强的 Agent 能力，再考虑集成 OpenClaw

### 3.4 类似项目对比

| 项目 | Stars | 定位 | 与 Neural Link 的关系 |
|------|-------|------|---------------------|
| [OpenClaw](https://github.com/openclaw/openclaw) | 68k | AI 个人助手 + 本地执行 | 可参考工具/技能系统设计 |
| [Open Interpreter](https://github.com/openinterpreter/open-interpreter) | 62k | 自然语言 → 代码执行 | 可参考安全执行模型（沙箱、确认机制） |
| [Claw Desktop](https://claw.so/) | - | OpenClaw 桌面客户端 | UI 参考 — 任务面板、执行状态展示 |
| [Mission Control](https://github.com/crshdn/mission-control) | - | OpenClaw Agent 编排仪表盘 | 多 Agent 协作界面参考 |

---

## 四、Monorepo 架构参考

### 4.1 推荐的 Monorepo 结构

没有找到同时包含 Flutter + Electron + Node.js 的现成 monorepo 模板。建议基于以下项目组合：

| 参考项目 | 用途 |
|---------|------|
| [electron-vite-monorepo](https://github.com/buqiyuan/electron-vite-monorepo) | Electron + Turborepo + pnpm 的基础结构 |
| [pnpm-monorepo-template](https://github.com/jkomyno/pnpm-monorepo-template) | TypeScript + pnpm workspace + Vitest 的标准配置 |
| [modern-typescript-monorepo-example](https://github.com/bakeruk/modern-typescript-monorepo-example) | TypeScript + pnpm + Turborepo + Docker 部署 |

### 4.2 建议的目录结构

```
neural-link/
├── apps/
│   ├── mobile/          # Flutter App (独立于 pnpm workspace)
│   ├── desktop/         # Electron + TypeScript
│   └── cloud/           # Node.js + TypeScript 后端
├── packages/
│   ├── shared-types/    # 共享 TypeScript 类型定义（WS 协议、API 类型）
│   ├── shared-utils/    # 共享工具函数
│   └── ws-protocol/     # WebSocket 协议实现（客户端+服务端）
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
└── apps/mobile/pubspec.yaml  # Flutter 由 Dart 工具链管理
```

> **关键点**：Flutter 项目不能被 pnpm 管理，但可以通过 Turborepo 的 pipeline 统一编排构建命令。`packages/shared-types/` 中的 TypeScript 类型可以通过代码生成工具转为 Dart 类型。

---

## 五、关键技术决策建议（基于调研结论）

### 5.1 解答追问文档中的阻塞问题

| 问题 | 建议方案 | 依据 |
|------|---------|------|
| **消息协议 (Q9)** | 自研 WebSocket 协议，参考 Discord/Spacebar 的 opcode 设计；REST API 处理非实时请求 | Discord 和 Spacebar 都采用 REST + WS 双通道 |
| **文件存储 (Q10)** | S3 兼容存储（阿里 OSS / AWS S3），上传返回签名 URL | Discord 用 GCS + CDN，Rocket.Chat 用 S3 |
| **认证方案 (Q11)** | JWT — 登录返回 token，WS 连接后首条消息携带 token 认证 | Discord/Spacebar 都用这个模式 |
| **设备配对 (Q6)** | 同账号自动关联（MVP），后期加扫码配对 | 最简方案，Discord 也是同账号多端 |
| **安全边界 (Q8)** | 分级制 — 低危直接执行，高危桌面端弹窗确认 + 手机端确认 | Open Interpreter 的 `auto_run` vs 确认模式可参考 |

### 5.2 第一个 Sprint 技术栈建议

```
Cloud:    Node.js + TypeScript + Express + ws (WebSocket) + PostgreSQL + Prisma
Desktop:  Electron + TypeScript + React + ws
Mobile:   Flutter + Dart + web_socket_channel
Protocol: 自研 WS 协议 (参考 Discord Gateway) + REST API (参考 Spacebar)
Auth:     JWT (jsonwebtoken)
Build:    pnpm workspace + Turborepo
Test:     Vitest
```

---

## 六、信息源汇总

### 开源 IM 平台
- [Rocket.Chat](https://github.com/RocketChat/Rocket.Chat) — Node.js/TS 企业 IM
- [Mattermost](https://github.com/mattermost/mattermost) — Go + PostgreSQL 企业 IM
- [Element / Matrix](https://github.com/element-hq/element-web) — 去中心化 IM

### Discord 克隆
- [Revolt / Stoat](https://github.com/revoltchat) — Rust 后端 Discord 替代
- [Spacebar](https://github.com/spacebarchat/server) — **TypeScript Discord 后端重实现**（最重要参考）
- [discord-clone](https://github.com/nayak-nirmalya/discord-clone) — Next.js 全栈 Discord 克隆
- [Quiet](https://github.com/TryQuiet/quiet) — P2P 隐私 IM (Tor + IPFS)

### Discord 架构文章
- [How Discord Handles Millions of Messages](https://medium.com/@pikachuzombie2/how-discord-handles-millions-of-messages-in-real-time-and-doesnt-crash-2-2579820959e0)
- [How Discord Serves 15 Million Users](https://blog.bytebytego.com/p/how-discord-serves-15-million-users)
- [Discord Real-Time Architecture](https://medium.com/@yadavmpadiyar/%EF%B8%8F-scaling-up-5-discord-real-time-architecture-at-internet-scale-bef4be6b7198)
- [Building Distributed Messaging like Discord](https://www.almabetter.com/bytes/articles/build-a-distributed-messaging-system-like-discord)
- [Discord Voice with WebRTC](https://discord.com/blog/how-discord-handles-two-and-half-million-concurrent-voice-users-using-webrtc)

### AI 执行层
- [OpenClaw](https://github.com/openclaw/openclaw) — 68k stars，AI 个人助手
- [OpenClaw 文档](https://docs.openclaw.ai/) — 工具/技能系统、浏览器控制
- [OpenClaw npm](https://www.npmjs.com/package/openclaw)
- [Open Interpreter](https://github.com/openinterpreter/open-interpreter) — 62k stars，自然语言代码执行
- [Mission Control](https://github.com/crshdn/mission-control) — OpenClaw Agent 编排仪表盘

### Flutter + Node.js 聊天
- [flutter_chat_app_with_nodejs](https://github.com/RodrigoBertotti/flutter_chat_app_with_nodejs) — Flutter + Node.js + WebSocket
- [chat_app](https://github.com/gabryelferreira/chat_app) — Flutter + Node.js + Socket.io

### Monorepo 参考
- [electron-vite-monorepo](https://github.com/buqiyuan/electron-vite-monorepo) — Electron + Turborepo + pnpm
- [pnpm-monorepo-template](https://github.com/jkomyno/pnpm-monorepo-template) — TypeScript + pnpm + Turborepo + Vitest
- [modern-typescript-monorepo-example](https://github.com/bakeruk/modern-typescript-monorepo-example) — TypeScript + pnpm + Turborepo

---

*本报告基于 2026-02-11 的公开信息整理，项目活跃度和 star 数可能有变化。*
