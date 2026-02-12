# LinkingChat 技术路线终选：Fork Tailchat vs 全新自建

> 两条路线的完整对比分析，供团队最终决策。
>
> 日期：2026-02-12
> 前置文档：`fork-vs-build-analysis.md`、`tech-decisions-v2.md`、`research-gemini-projects.md`

---

## 〇、决策背景

团队面临三条可能的技术路线：

| 路线 | 描述 | 本文评价 |
|------|------|---------|
| **A: Fork Tailchat 直接用** | 接受 MongoDB + React Native + Moleculer，在上面加 AI 和 OpenClaw | 见 `fork-vs-build-analysis.md`，**可行** |
| **B: Fork Tailchat + 渐进重构** | Fork 后逐步替换技术栈（Moleculer→NestJS, MongoDB→PostgreSQL 等） | **不推荐**，见下方分析 |
| **C: 全新自建** | 从零搭建，Tailchat 仅做设计参考，使用最适合项目的技术栈 | **推荐**，见下方完整方案 |

---

## 一、为什么不推荐路线 B（Fork + 重构）

"先 fork 跑起来，再慢慢换技术栈"听起来两全其美，实际是**两头都亏**：

### 1.1 框架迁移不是"渐进"的

| 从 | 到 | 迁移代价 |
|----|----|---------|
| Moleculer Service Actions | NestJS Controller + Provider + DI | 两套框架的 service 定义、生命周期、中间件、装饰器**完全不同**。不是改 import 的事，是重写每一个 service |
| Mongoose Schema + Typegoose | Prisma Schema 或 TypeORM Entity | 所有 model 定义、查询语法、数据迁移脚本全部重做。Mongoose 的 `.populate()` vs Prisma 的 `include` 是不同的思维方式 |
| MongoDB 文档模型 | PostgreSQL 关系模型 | 嵌套文档要拍平成表 + 外键。聊天消息的 `reactions: [{userId, emoji}]` 嵌入式设计要改成 `message_reactions` 关联表 |
| MiniStar 插件系统 | 自定义插件或去掉 | MiniStar 是 Tailchat 自研的微内核框架，深度耦合在前端代码中 |

### 1.2 "忒修斯之船"的实际成本

```
周期 1: Fork Tailchat，能跑。团队开始学 Moleculer + MongoDB。
周期 2: 用 Moleculer 写了 AI 插件、OpenClaw 集成。系统在旧栈上越来越大。
周期 3: 开始把 Moleculer 迁移到 NestJS... 但 AI 插件依赖 Moleculer 的事件总线。
周期 4: 重写 AI 插件适配 NestJS。MongoDB 的消息数据要迁移到 PostgreSQL，需要写迁移脚本。
周期 5: 迁移导致了数据不一致 bug。同时新功能开发停滞。
周期 6: 团队心态：早知道还不如从零写...
```

**结论**：如果目标技术栈和 Tailchat 不同，**直接用目标技术栈从零建，比 fork 后再重构成本更低**。

---

## 二、路线 C：全新自建方案（推荐技术栈）

### 2.1 技术栈总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        LinkingChat 技术栈                        │
├──────────┬──────────────────────────────────────────────────────┤
│ 移动端    │ React Native (Expo) + TypeScript                    │
│ 桌面端    │ Electron + React + TypeScript                       │
│ Web 端   │ React + Vite + TypeScript （与桌面端共享代码）         │
│ 云端     │ NestJS + TypeScript + Prisma + PostgreSQL + Redis    │
│ 实时通信  │ Socket.IO + Redis Adapter                           │
│ 任务队列  │ BullMQ + Redis                                      │
│ 文件存储  │ S3 兼容（MinIO 开发 / AWS S3 生产）                   │
│ 设备执行  │ OpenClaw Node（Electron 子进程）                      │
│ LLM      │ 多供应商路由（DeepSeek + Kimi 2.5）                   │
│ Monorepo │ Turborepo + pnpm workspace                          │
│ 测试     │ Vitest + Supertest (E2E)                             │
│ CI/CD    │ GitHub Actions                                       │
│ 容器化    │ Docker + docker-compose                              │
└──────────┴──────────────────────────────────────────────────────┘
```

### 2.2 为什么选这些（逐项理由）

#### 后端：NestJS + Prisma + PostgreSQL

| 选择 | 理由 |
|------|------|
| **NestJS** | Node.js 生态最成熟的后端框架。内置 DI、模块系统、WebSocket Gateway、Guards、Interceptors。社区大，文档全，好招人。对比 Moleculer（小众、文档少、招不到人）是碾压级优势 |
| **Prisma** | 类型安全 ORM，schema 即文档，migration 自动生成，开发体验远好于 TypeORM/Mongoose。`prisma generate` 自动产出 TypeScript 类型，前后端共享零成本 |
| **PostgreSQL** | 关系型数据在权限、好友关系、群组成员这些场景天然适合。全文搜索（`tsvector`）开箱即用，不需要额外引入 Elasticsearch。消息存储用 PG 完全够用（Discord 用的是 Cassandra，但 LinkingChat 用户量级不需要） |
| **Redis** | 三个用途：① Socket.IO adapter（水平扩展）② BullMQ 队列后端 ③ 缓存（在线状态、会话信息） |
| **BullMQ** | AI 任务（LLM 调用可能需要数秒）、OpenClaw 命令执行跟踪、离线消息推送——都需要可靠的异步任务队列。BullMQ 是 Node.js 生态最成熟的方案 |

#### 前端：React + Vite + Tailwind + shadcn/ui

| 选择 | 理由 |
|------|------|
| **React 19** | 生态最大，与 Electron 和 React Native 共享知识。团队不需要学三套 UI 框架 |
| **Vite** | 开发服务器秒启动，HMR 极快。对比 Tailchat 的 Webpack 5 是代差级提升 |
| **Tailwind CSS** | 原子化 CSS，不需要维护样式文件。与 shadcn/ui 配合直接获得高质量组件 |
| **shadcn/ui** | 基于 Radix UI，无障碍访问开箱即用。组件代码直接复制到项目里，完全可控（不是 npm 黑盒） |
| **Zustand** | 极简状态管理，比 Redux 轻很多。Tailchat 也用的 Zustand，验证了在 IM 场景的可行性 |
| **TanStack Query** | 服务端状态管理（消息列表、好友列表等）。自带缓存、分页、乐观更新。无限滚动加载消息列表是核心场景 |

#### 移动端：React Native (Expo) 替代 Flutter

这是与 `tech-decisions-v2.md` 最大的分歧。理由如下：

| 维度 | Flutter | React Native (Expo) |
|------|---------|-------------------|
| 语言 | **Dart**（团队需要额外学） | **TypeScript**（与后端/前端/桌面端一致） |
| 代码共享 | 与 TS 后端零共享，需要代码生成 | 共享 Zod schemas、API 客户端、WebSocket 协议类型、业务逻辑 |
| 知识迁移 | React 开发者要学全新框架 | React 开发者直接上手 |
| "TypeScript everywhere" | 违反这项已确认的决策 | **完全符合** |
| UI 一致性 | 自绘引擎，跨平台像素级一致 | 原生组件，平台差异需处理 |
| 性能 | 更好（编译为原生代码） | 足够好（Expo 已优化很多） |
| 生态 | 成长中，部分原生库缺失 | 成熟，几乎所有原生功能都有库 |

**核心论点**：LinkingChat 的 "TypeScript everywhere" 决策 + 2-3 人小团队 = React Native 的代码共享优势 > Flutter 的性能优势。**一个人可以同时写后端和移动端**，不需要 Dart 专家。

> 如果团队已经有熟练的 Flutter/Dart 开发者且不愿放弃，可以保留 Flutter，代价是移动端开发者相对独立于后端开发。

#### 桌面端：Electron + 共享 React 代码

| 选择 | 理由 |
|------|------|
| **Electron** | 已确认的决策，不变。需要 Node.js 子进程能力（运行 OpenClaw Node） |
| **共享 React** | Web 前端和 Electron 渲染进程用同一套 React 代码，通过条件编译区分平台特性 |

#### Monorepo：Turborepo + pnpm

```
linkingchat/
├── apps/
│   ├── server/          # NestJS Cloud Brain
│   ├── web/             # React + Vite (Web 前端)
│   ├── desktop/         # Electron (主进程 + 引用 web/)
│   └── mobile/          # React Native (Expo)
├── packages/
│   ├── shared/          # 共享类型、Zod schemas、常量
│   ├── ws-protocol/     # WebSocket 消息定义 + 编解码
│   ├── api-client/      # 类型安全 REST API 客户端
│   └── ui/              # 共享 React 组件（web + desktop 用）
├── turbo.json
├── pnpm-workspace.yaml
├── docker-compose.yml
└── package.json
```

**`packages/shared/` 是核心胶水**——一处定义，四端使用：

```typescript
// packages/shared/src/schemas/message.ts
import { z } from 'zod';

export const MessageSchema = z.object({
  id: z.string().cuid(),
  content: z.string().max(4000),
  channelId: z.string().cuid(),
  authorId: z.string().cuid(),
  type: z.enum(['TEXT', 'IMAGE', 'FILE', 'VOICE', 'SYSTEM', 'AI_DRAFT', 'AI_WHISPER']),
  createdAt: z.date(),
});

export type Message = z.infer<typeof MessageSchema>;
// → server 用于请求校验
// → web/desktop 用于类型约束
// → mobile 用于类型约束
// → ws-protocol 用于事件载荷类型
```

### 2.3 对比 Tailchat 的技术选型

| 层级 | Tailchat | 路线 C（自建） | 改进点 |
|------|---------|-------------|--------|
| 后端框架 | Moleculer（小众） | **NestJS**（主流） | 生态大 10x，文档全，好招人 |
| ORM | Mongoose + Typegoose | **Prisma** | 类型安全，migration 自动化，schema 即文档 |
| 数据库 | MongoDB | **PostgreSQL** | 关系查询强，全文搜索内置，事务可靠 |
| 前端构建 | Webpack 5 | **Vite** | 开发体验代差级提升 |
| 前端 CSS | Less | **Tailwind CSS** | 无需维护样式文件，与 shadcn/ui 配合 |
| 前端组件 | Ant Design 4 | **shadcn/ui (Radix)** | 可控性更高，bundle 更小 |
| 插件系统 | MiniStar 微内核 | **NestJS 模块系统** | NestJS 的 DynamicModule + Providers 天然支持插件化，不需要额外框架 |
| 移动端 | React Native 0.71 | **React Native (Expo)** | Expo 简化 90% 的原生配置，OTA 更新 |
| 任务队列 | 无 | **BullMQ** | AI 异步任务、OpenClaw 命令追踪必需 |
| 类型共享 | 无跨端共享 | **Zod + monorepo** | 一处定义，全端类型安全 |
| 测试 | 无 | **Vitest + Supertest** | 从第一天就有 |

---

## 三、路线 A（Fork Tailchat）完整方案

> 上一份文档 `fork-vs-build-analysis.md` 已覆盖核心分析。这里补充执行层面的细节。

### 3.1 技术栈（接受 Tailchat 现有栈）

```
┌─────────────────────────────────────────────────────────────────┐
│                  LinkingChat（Fork Tailchat 版）                  │
├──────────┬──────────────────────────────────────────────────────┤
│ 移动端    │ React Native 0.71（Tailchat 现有）                   │
│ 桌面端    │ Electron（Tailchat 现有）                             │
│ Web 端   │ React 18 + Webpack 5 + MiniStar 插件（Tailchat 现有） │
│ 云端     │ Node.js + Moleculer + Mongoose + MongoDB + Redis     │
│ 实时通信  │ Socket.IO + Redis Adapter                           │
│ 文件存储  │ MinIO                                                │
│ 设备执行  │ OpenClaw Node（新增，Electron 子进程）                  │
│ LLM      │ 多供应商路由（新增，Moleculer service）                 │
│ 测试     │ 无（需自行补充）                                       │
│ 容器化    │ Docker + docker-compose + Traefik                    │
└──────────┴──────────────────────────────────────────────────────┘
```

### 3.2 执行步骤

**Phase 0: 验证 & 熟悉（前置）**

```
1. Fork msgbyte/tailchat
2. docker-compose up 跑通全部服务
3. 团队分工通读：
   - 开发者 A: server/services/core/ (gateway, chat, group, user)
   - 开发者 B: client/web/src/ + client/desktop/
   - 开发者 C: client/mobile/ + server/plugins/
4. 输出内部架构 cheat sheet
5. 配置 Vitest，从 chat.service 和 user.service 开始补测试
```

**Phase 1: 最小 PoC**

```
1. 新增 Moleculer Service: device.service.ts
   - 设备注册 (device.register)
   - 命令下发 (device.command)
   - 结果回传 (device.result)

2. Electron 桌面端新增：
   - OpenClaw Node 子进程管理模块
   - 接收 device.command → 调用 OpenClaw → 返回 device.result

3. RN 移动端（或 Web 端先行验证）：
   - 设备选择器 UI
   - 命令输入 + 结果显示
```

**Phase 2: AI 功能（以 Tailchat 插件形式开发）**

```
服务端插件：
  server/plugins/com.linkingchat.llm-router/     — LLM 多供应商路由
  server/plugins/com.linkingchat.ai-draft/        — Draft & Verify 状态机
  server/plugins/com.linkingchat.ai-whisper/      — Whisper 建议生成
  server/plugins/com.linkingchat.ai-predict/      — Predictive Actions

客户端插件：
  client/web/plugins/com.linkingchat.ai-ui/       — AI 功能 UI 组件
```

**Phase 3: 品牌定制 + 上线**

```
1. UI 主题/logo/名称改为 LinkingChat
2. 删除不需要的 Tailchat 插件（genshin 主题、music、sakana 等）
3. 离线推送改为 FCM/APNs
4. 部署 + SSL + 性能优化
```

---

## 四、两条路线终极对比

### 4.1 维度对比

| 维度 | A: Fork Tailchat | C: 全新自建 |
|------|:---:|:---:|
| **起步速度** | ⭐⭐⭐⭐⭐ 社交功能开箱即有 | ⭐⭐ 从零搭建 |
| **架构质量** | ⭐⭐⭐ Moleculer 可用但非主流 | ⭐⭐⭐⭐⭐ NestJS + Prisma 是当前最佳实践 |
| **代码控制力** | ⭐⭐ 别人的代码 + 架构假设 | ⭐⭐⭐⭐⭐ 每行代码都是自己的 |
| **团队上手** | ⭐⭐ 需学 Moleculer + MongoDB + 理解 58MB 代码 | ⭐⭐⭐⭐ NestJS 资料多，Prisma 上手快 |
| **招人/扩团队** | ⭐⭐ Moleculer 几乎没人会 | ⭐⭐⭐⭐⭐ NestJS 是最热门 Node.js 框架 |
| **TypeScript 共享** | ⭐⭐ 无 monorepo 类型共享 | ⭐⭐⭐⭐⭐ Zod schema 全端共享 |
| **测试基础** | ⭐ 无测试，需补 | ⭐⭐⭐⭐ 从第一天就有 |
| **AI 功能开发** | ⭐⭐⭐ 插件系统可用，但受 Moleculer 约束 | ⭐⭐⭐⭐ NestJS 模块原生支持，无框架限制 |
| **长期维护** | ⭐⭐ 上游停更，技术债累积 | ⭐⭐⭐⭐⭐ 清晰架构，持续演进 |
| **社交功能工作量** | ⭐⭐⭐⭐⭐ 省 ~75% | ⭐⭐ 全部自己写 |

### 4.2 风险对比

| 风险 | A: Fork Tailchat | C: 全新自建 |
|------|---|---|
| 社交功能做不完 | 低（已有） | **高（12 项功能，2-3 人团队）** |
| 架构不合适需要重写 | **高（Moleculer 限制 + 别人的设计假设）** | 低（自己选的架构） |
| AI 功能延迟不达标 | 中（Socket.IO 额外开销 + Moleculer 事件总线开销） | 低（可精确控制通信链路） |
| 招不到人/新人上手慢 | **高（Moleculer + 复杂代码库）** | 低（NestJS 主流） |
| 上游项目出问题 | **高（单人项目已停更）** | 无 |
| 开发周期超预期 | 中 | **中高** |

### 4.3 适合什么样的团队

| 路线 | 适合的团队 |
|------|---------|
| **A: Fork Tailchat** | 急于出 demo、能接受技术债、团队愿意学 Moleculer、不在乎长期维护成本 |
| **C: 全新自建** | 追求架构质量、计划长期迭代、团队有 NestJS/React 经验、愿意前期多投入 |

---

## 五、我的推荐

### 如果只能选一条路：选 C（全新自建）

理由排序：

1. **LinkingChat 的核心价值是 AI + OpenClaw，不是聊天功能。** 社交 IM 是载体，不是差异化。不应该为了省载体的开发时间，在核心功能上背负别人的技术约束。

2. **Moleculer 是最大的隐患。** 不是说它不好，而是它太小众。遇到问题 Stack Overflow 上搜不到答案，GitHub issues 没人回，新成员加入团队要花很长时间学。NestJS 的生态大 10 倍以上。

3. **"TypeScript everywhere" 的真正价值在全新自建时才能体现。** Turborepo + pnpm + Zod schema 全端共享，一个 TypeScript 开发者可以无缝在 server / web / desktop / mobile 之间切换。Fork Tailchat 做不到这点。

4. **社交功能有捷径。** `tech-decisions-v2.md` 已经选好了参考项目（Valkyrie 领域模型 + nestjs-chat WebSocket 架构 + brocoders 脚手架），不是完全从零写，而是**站在已验证的设计上组装**。

5. **前期慢，后期快。** 自建的前 2 个 Sprint 肯定比 fork 慢，但从 Phase 2（AI 功能）开始，自建的开发速度会超过 fork——因为不需要在别人的架构约束里绕路。

### 如果团队急于出 demo：选 A（Fork Tailchat）

`fork-vs-build-analysis.md` 已有完整分析和执行计划。核心前提是**接受 MongoDB + React Native + Moleculer**，不要试图 fork 之后再重构技术栈。

---

## 六、决策树（帮团队快速选择）

```
Q1: 团队是否急于在 1-2 周内有可运行的三端 demo？
│
├── 是 → Q2: 能否接受 MongoDB + Moleculer + React Native？
│         ├── 能接受 → 路线 A: Fork Tailchat
│         └── 不能接受 → 路线 C: 全新自建（没有捷径）
│
└── 否 → Q3: 团队是否重视长期架构质量和可维护性？
          ├── 是 → 路线 C: 全新自建
          └── 否 → 路线 A: Fork Tailchat
```

```
⚠️ 无论如何不要选路线 B（Fork + 重构）。
   这条路结合了 fork 的学习成本和自建的开发工作量，是最差的选择。
```

---

## 附录：路线 C 的 Prisma Schema 草案（核心模型）

> 展示 Prisma 的 DX，也作为数据模型参考。

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── 用户 ────────────────────────────────────────

model User {
  id          String   @id @default(cuid())
  email       String   @unique
  username    String   @unique
  displayName String
  avatarUrl   String?
  status      UserStatus @default(OFFLINE)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  sentRequests     FriendRequest[] @relation("SentRequests")
  receivedRequests FriendRequest[] @relation("ReceivedRequests")
  memberships      Member[]
  messages         Message[]
  devices          Device[]
  directMessages   DMParticipant[]
}

enum UserStatus {
  ONLINE
  IDLE
  DND
  OFFLINE
}

// ─── 好友 ────────────────────────────────────────

model FriendRequest {
  id        String              @id @default(cuid())
  senderId  String
  receiverId String
  status    FriendRequestStatus @default(PENDING)
  createdAt DateTime            @default(now())

  sender   User @relation("SentRequests", fields: [senderId], references: [id])
  receiver User @relation("ReceivedRequests", fields: [receiverId], references: [id])

  @@unique([senderId, receiverId])
}

enum FriendRequestStatus {
  PENDING
  ACCEPTED
  REJECTED
  BLOCKED
}

// ─── 群组 / 频道 ─────────────────────────────────

model Group {
  id          String   @id @default(cuid())
  name        String
  iconUrl     String?
  inviteCode  String   @unique @default(cuid())
  ownerId     String
  createdAt   DateTime @default(now())

  channels Channel[]
  members  Member[]
}

model Channel {
  id        String      @id @default(cuid())
  name      String
  type      ChannelType @default(TEXT)
  groupId   String
  createdAt DateTime    @default(now())

  group    Group     @relation(fields: [groupId], references: [id], onDelete: Cascade)
  messages Message[]

  @@index([groupId])
}

enum ChannelType {
  TEXT
  VOICE
  VIDEO
}

model Member {
  id      String     @id @default(cuid())
  role    MemberRole @default(GUEST)
  userId  String
  groupId String
  joinedAt DateTime  @default(now())

  user  User  @relation(fields: [userId], references: [id])
  group Group @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@unique([userId, groupId])
  @@index([groupId])
}

enum MemberRole {
  ADMIN
  MODERATOR
  GUEST
}

// ─── 消息 ────────────────────────────────────────

model Message {
  id        String      @id @default(cuid())
  content   String
  type      MessageType @default(TEXT)
  fileUrl   String?
  deleted   Boolean     @default(false)
  authorId  String
  channelId String
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  author  User    @relation(fields: [authorId], references: [id])
  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)

  @@index([channelId, createdAt])
}

enum MessageType {
  TEXT
  IMAGE
  FILE
  VOICE
  SYSTEM
  AI_DRAFT       // Draft & Verify 草稿消息
  AI_WHISPER     // Whisper 建议
  AI_PREDICTIVE  // Predictive Action 操作卡片
}

// ─── 私聊 ────────────────────────────────────────

model DirectConversation {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  participants DMParticipant[]
  messages     DirectMessage[]
}

model DMParticipant {
  id             String @id @default(cuid())
  userId         String
  conversationId String

  user         User               @relation(fields: [userId], references: [id])
  conversation DirectConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([userId, conversationId])
  @@index([conversationId])
}

model DirectMessage {
  id             String      @id @default(cuid())
  content        String
  type           MessageType @default(TEXT)
  fileUrl        String?
  deleted        Boolean     @default(false)
  authorId       String
  conversationId String
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  conversation DirectConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
}

// ─── 设备管理（OpenClaw 远控）─────────────────────

model Device {
  id          String       @id @default(cuid())
  name        String       // "我的 MacBook Pro"
  platform    String       // "darwin" | "win32" | "linux"
  status      DeviceStatus @default(OFFLINE)
  lastSeenAt  DateTime?
  userId      String
  createdAt   DateTime     @default(now())

  user     User      @relation(fields: [userId], references: [id])
  commands Command[]

  @@index([userId])
}

enum DeviceStatus {
  ONLINE
  OFFLINE
}

model Command {
  id         String        @id @default(cuid())
  type       String        // "shell" | "file" | "automation"
  payload    Json          // 命令详情
  result     Json?         // 执行结果
  status     CommandStatus @default(PENDING)
  deviceId   String
  issuerId   String        // 发起命令的用户
  createdAt  DateTime      @default(now())
  completedAt DateTime?

  device Device @relation(fields: [deviceId], references: [id])

  @@index([deviceId, createdAt])
}

enum CommandStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

// ─── AI 功能 ─────────────────────────────────────

model AiDraft {
  id          String      @id @default(cuid())
  messageId   String?     // 关联的触发消息
  content     String      // AI 生成的草稿内容
  status      DraftStatus @default(PENDING)
  userId      String
  channelId   String
  createdAt   DateTime    @default(now())
  resolvedAt  DateTime?

  @@index([userId, status])
}

enum DraftStatus {
  PENDING     // 等待用户确认
  APPROVED    // 用户确认发送
  REJECTED    // 用户拒绝
  EXPIRED     // 超时未处理
}

model AiSuggestion {
  id        String         @id @default(cuid())
  type      SuggestionType
  content   String
  metadata  Json?          // 额外上下文（如 Predictive Action 的命令详情）
  messageId String         // 触发建议的消息
  userId    String         // 目标用户
  createdAt DateTime       @default(now())

  @@index([messageId])
  @@index([userId, createdAt])
}

enum SuggestionType {
  WHISPER     // 回复建议
  PREDICTIVE  // 预测操作
}
```

> 这个 schema 跑一行 `npx prisma migrate dev` 就能生成完整的 PostgreSQL 表结构 + TypeScript 类型。
> 对比 Tailchat 的 Mongoose 手写 schema，开发效率差距明显。
