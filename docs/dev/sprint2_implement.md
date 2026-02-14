# Sprint 2：社交基础 + Bot 框架

> **目标**：从"设备遥控器"进化为"能聊天的遥控器" — 完成好友系统、1 对 1 聊天、在线状态、已读回执，以及多 Bot 框架（Phase 0-7）
>
> **前置条件**：[Sprint 1](./sprint1_implement.md) 已完成（全链路 PoC：手机 → 云 → 桌面 → 手机）
>
> **不包含**：群聊、AI 三模式、文件/图片/语音消息、推送通知、消息搜索、生产部署
>
> **延迟到后续 Sprint**：OpenClaw Node 集成（原 Phase 8）、Supervisor 通知汇总（原 Phase 9）— Sprint 1 的 child_process.exec() 继续工作
>
> **参考**：[database-schema.md](../dev-plan/database-schema.md) | [websocket-protocol.md](../dev-plan/websocket-protocol.md) | [reference-architecture-guide.md](../dev-plan/reference-architecture-guide.md)

---

## 范围调整说明

原计划 10 个 Phase（0-9），实际执行 **Phase 0-7**，延迟 Phase 8-9：

| Phase | 状态 | 原因 |
|-------|------|------|
| Phase 0-4（社交基础） | ✅ 执行 | 核心价值，Sprint 3 AI 功能的前置依赖 |
| Phase 5-7（Bot 框架） | ✅ 执行 | Bot CRUD + 自动创建 + UI，轻量且给用户"开箱即用"体验 |
| Phase 8（OpenClaw 集成） | ⏭ 延迟 | Sprint 1 的 child_process.exec() 已可用，替换为独立任务 |
| Phase 9（Supervisor 通知） | ⏭ 延迟 | 依赖完整 Bot 执行管线，需 AI 模块配合 |

---

## 实施策略

逐 Phase 推进，每个 Phase 实现 Server + Flutter + Desktop 全端：

```
Phase 0: Schema 扩展（单次 migration 创建所有社交 + Bot 表）
  ↓
Phase 1: 好友系统（REST + WS + Flutter + Desktop）
  ↓
Phase 2: 1 对 1 聊天（REST + ChatGateway + Flutter + Desktop）
  ↓
Phase 3: 在线状态（Redis presence + WS 广播）
  ↓
Phase 4: 已读回执（游标追踪 + 双勾 UI）
  ↓
Phase 5: Bot Model + CRUD（REST API + Zod 验证）
  ↓
Phase 6: 注册自动创建 Bot（Supervisor + Coding Bot + 欢迎消息）
  ↓
Phase 7: Bot 聊天 UI（置顶 + 通知卡片渲染）
```

### 详细实施文档

| Phase | 文档 | 任务数 |
|-------|------|--------|
| Phase 0 | [sprint2_phase0.md](./sprint2_phase0.md) | 11 |
| Phase 1 | [sprint2_phase1.md](./sprint2_phase1.md) | 10 |
| Phase 2 | [sprint2_phase2.md](./sprint2_phase2.md) | 12 |
| Phase 3 | [sprint2_phase3.md](./sprint2_phase3.md) | 7 |
| Phase 4 | [sprint2_phase4.md](./sprint2_phase4.md) | 5 |
| Phase 5 | [sprint2_phase5.md](./sprint2_phase5.md) | 6 |
| Phase 6 | [sprint2_phase6.md](./sprint2_phase6.md) | 5 |
| Phase 7 | [sprint2_phase7.md](./sprint2_phase7.md) | 7 |

---

## 线 A — 社交基础

### Phase 0: 数据库 Schema 扩展

**目标**：把 Sprint 1 的 3 个 model（User / Device / Command）扩展为完整的社交数据模型。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 0.1 | 扩展 User model（添加 status、deletedAt） | prisma/schema.prisma 更新 | UserStatus enum 可用 |
| 0.2 | 新增 FriendRequest model | friend_requests 表 | `@@unique([senderId, receiverId])` + `@@index([status])` 约束生效 |
| 0.3 | 新增 Friendship model | friendships 表 | `@@unique([userAId, userBId])` 约束生效 |
| 0.4 | 新增 UserBlock model | user_blocks 表 | 双向拉黑约束生效 |
| 0.5 | 新增 Converse + ConverseMember model | converses + converse_members 表 | ConverseType enum (DM / MULTI / GROUP) 可用 |
| 0.6 | 新增 Message + Attachment model | messages + attachments 表 | `@@index([converseId, createdAt])` 核心索引建立 |
| 0.7 | 执行 migration | prisma/migrations/002_social/ | `prisma migrate dev --name social` 成功 |

**关键文件**：

```
apps/server/prisma/schema.prisma          # 扩展 schema
apps/server/prisma/migrations/002_social/ # 新 migration
packages/shared/src/enums/               # 新增 MessageType, ConverseType, UserStatus 枚举
```

**Schema 要点**（参考 [database-schema.md](../dev-plan/database-schema.md)）：

```prisma
// Friendship — 双向查询：WHERE userAId = :me OR userBId = :me
// 较小 ID 放 A 端，保证唯一性
model Friendship {
  id       String   @id @default(cuid())
  userAId  String
  userBId  String
  createdAt DateTime @default(now())
  @@unique([userAId, userBId])
}

// Converse — 统一消息管道，DM/多人/群组频道都走这里
model Converse {
  id   String       @id @default(cuid())
  type ConverseType // DM | MULTI | GROUP
  name String?      // DM 时为空
}

// ConverseMember — 已读追踪用 lastSeenMessageId（消息 ID 游标）
model ConverseMember {
  converseId       String
  userId           String
  isOpen           Boolean  @default(true)
  lastSeenMessageId String?
  lastMessageId    String?
  @@id([converseId, userId])
}
```

**验收标准**：
- `prisma migrate dev` 成功，所有新表存在
- `prisma generate` 后 PrismaClient 类型包含所有新 model
- seed.ts 能插入测试数据（2 个用户 + 1 个好友关系 + 1 个 DM 会话）

---

### Phase 1: 好友系统

**目标**：完整的好友请求 → 接受 → 列表 → 删除 → 拉黑流程，REST API + WS 实时通知。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 1.1 | 创建 FriendsModule + FriendsService | `apps/server/src/friends/` | 模块可注入 |
| 1.2 | 实现 POST `/api/v1/friends/request` | 发送好友请求 | 不能重复请求；已是好友时返回 409 |
| 1.3 | 实现 POST `/api/v1/friends/accept/:requestId` | 接受请求 | 删除 FriendRequest + 创建 Friendship + 自动创建 DM Converse |
| 1.4 | 实现 POST `/api/v1/friends/reject/:requestId` | 拒绝请求 | FriendRequest.status → REJECTED |
| 1.5 | 实现 GET `/api/v1/friends` | 好友列表 | 返回双向查询结果，包含在线状态 |
| 1.6 | 实现 DELETE `/api/v1/friends/:userId` | 删除好友 | 删除 Friendship + 关闭 DM（isOpen=false） |
| 1.7 | 实现 POST `/api/v1/friends/block/:userId` | 拉黑 | 创建 UserBlock + 自动删除好友关系 |
| 1.8 | WS 事件推送 | BroadcastService 调用 | friend:request → 接收方，friend:accepted → 双方，friend:removed → 双方 |
| 1.9 | 好友请求列表 GET `/api/v1/friends/requests` | 待处理请求 | 分 sent / received 两部分 |
| 1.10 | 单元测试 | friends.service.spec.ts | 覆盖正常流程 + 边界情况（重复请求、自己加自己） |

**关键文件**：

```
apps/server/src/friends/
  ├── friends.module.ts
  ├── friends.controller.ts    # REST 端点
  ├── friends.service.ts       # 业务逻辑 (Result<T, E> 模式)
  └── dto/
      ├── send-request.dto.ts
      └── friend-response.dto.ts

packages/ws-protocol/src/payloads/chat.payloads.ts  # 新增 FriendRequestPayload, FriendPayload
```

**WS 事件流**：

```
用户 A 发送好友请求:
  POST /api/v1/friends/request { receiverId: B }
    → DB: INSERT friend_requests
    → WS: friend:request → u-{B}  (通知 B 收到请求)

用户 B 接受请求:
  POST /api/v1/friends/accept/:requestId
    → DB: DELETE friend_requests + INSERT friendships + INSERT converse(DM) + converse_members x2
    → WS: friend:accepted → u-{A} + u-{B}  (通知双方)
    → WS: converse:new → u-{A} + u-{B}  (通知双方新 DM 会话)
```

**验收标准**：
- A 发送好友请求 → B 实时收到 `friend:request` WS 事件
- B 接受后 → 双方实时收到 `friend:accepted` + `converse:new`
- 好友列表能正确显示双向关系
- 拉黑后好友关系自动删除

---

### Phase 2: 1 对 1 聊天

**目标**：基于 Converse 模型的 DM 消息收发，游标分页，实时推送。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 2.1 | 创建 ConversesModule + MessagesModule | `apps/server/src/converses/` + `apps/server/src/messages/` | 模块可注入 |
| 2.2 | 实现 GET `/api/v1/converses` | 会话列表 | 返回用户所有 isOpen=true 的会话 + 未读计数 |
| 2.3 | 实现 POST `/api/v1/messages` | 发送消息 | 消息存入 DB + WS 广播 `message:new` |
| 2.4 | 实现 GET `/api/v1/messages?converseId=&cursor=` | 消息历史 | 游标分页，35 条/页，createdAt DESC |
| 2.5 | 实现 PATCH `/api/v1/messages/:id` | 编辑消息 | 仅作者可编辑 + WS 广播 `message:updated` |
| 2.6 | 实现 DELETE `/api/v1/messages/:id` | 撤回消息 | 软删除 (deletedAt) + WS 广播 `message:deleted` |
| 2.7 | Chat Gateway (/chat 命名空间) | `apps/server/src/gateway/chat.gateway.ts` | JWT 认证 + converse:join/leave 房间管理 |
| 2.8 | WS 事件：message:typing | 输入状态广播 | 广播到 {converseId} 房间（排除发送者） |
| 2.9 | 未读消息计数 | ConversesService | 基于 lastSeenMessageId 计算未读数 |
| 2.10 | Flutter 聊天 UI | apps/mobile/lib/features/chat/ | 消息列表 + 输入框 + 发送按钮 |
| 2.11 | Desktop 聊天 UI | apps/desktop/src/renderer/pages/Chat.tsx | 左侧会话列表 + 右侧消息面板 |
| 2.12 | 单元 + E2E 测试 | messages.service.spec.ts + chat.e2e-spec.ts | 消息 CRUD + WS 广播测试 |

**关键文件**：

```
apps/server/src/converses/
  ├── converses.module.ts
  ├── converses.controller.ts   # GET /converses (会话列表 + 未读)
  └── converses.service.ts

apps/server/src/messages/
  ├── messages.module.ts
  ├── messages.controller.ts    # POST /messages, GET /messages?cursor=, PATCH, DELETE
  ├── messages.service.ts       # 游标分页逻辑
  └── dto/
      ├── create-message.dto.ts
      └── message-response.dto.ts

apps/server/src/gateway/
  └── chat.gateway.ts           # /chat 命名空间 (新增)
```

**游标分页实现要点**：

```typescript
// messages.service.ts
async findByConverse(converseId: string, cursor?: string, limit = 35) {
  return this.prisma.message.findMany({
    where: {
      converseId,
      deletedAt: null,
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { author: { select: { id: true, username: true, avatarUrl: true } } },
  });
}
```

**验收标准**：
- A 发消息 → B 实时收到 `message:new`（B 在聊天房间内）
- B 不在房间 → B 收到 `notification:new`（通过 u-{userId}）
- 消息历史可以正确翻页（向上滚动加载更多）
- 撤回消息后客户端显示"已撤回"占位

---

### Phase 3: 在线状态 (Presence)

**目标**：基于 Redis 的在线/离线状态管理，好友间实时同步。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 3.1 | 创建 PresenceService | `apps/server/src/gateway/presence.service.ts` | Redis SET 管理在线用户 |
| 3.2 | 连接时标记上线 | handleConnection 中调用 PresenceService | Redis SADD `online:{userId}` |
| 3.3 | 断开时标记下线 | handleDisconnect 中调用 PresenceService | Redis SREM + 更新 User.status + User.lastSeenAt |
| 3.4 | WS 事件 presence:update | 客户端主动切换状态 | ONLINE / IDLE / DND |
| 3.5 | WS 广播 presence:changed | 通知好友 + 共同群成员 | 查询好友列表，逐个推送到 u-{friendId} |
| 3.6 | GET `/api/v1/users/online` | 批量查询在线状态 | 一次查询多个 userId 的状态 |
| 3.7 | 客户端状态显示 | 好友列表 + 聊天页面 | 绿色(ONLINE)、黄色(IDLE)、红色(DND)、灰色(OFFLINE) |

**Redis 数据结构**：

```
online_users    → SET { userId1, userId2, ... }     # 在线用户集合
user:status:{userId} → STRING "ONLINE|IDLE|DND"     # 用户状态, TTL 300s
```

**关键文件**：

```
apps/server/src/gateway/
  ├── presence.service.ts       # Redis-based presence 管理
  ├── chat.gateway.ts           # handleConnection/Disconnect 中调用
  └── broadcast.service.ts      # 新增 broadcastToFriends 方法
```

**验收标准**：
- 用户登录 → 好友列表中该用户显示绿点
- 用户断开连接 → 好友列表中 5 秒内显示灰点
- 手动切换 DND → 好友看到红色状态

---

### Phase 4: 已读回执

**目标**：精确到消息粒度的已读追踪，实时同步。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 4.1 | WS 事件 message:read（客户端 → 服务端） | 更新 ConverseMember.lastSeenMessageId | 客户端打开会话时自动发送 |
| 4.2 | WS 广播 message:read（服务端 → 客户端） | 通知对方已读 | 广播到 {converseId} 房间 |
| 4.3 | 未读计数更新 | ConversesService | 基于 lastSeenMessageId 重新计算 |
| 4.4 | 客户端已读标记 UI | 消息气泡下方 | 双勾 ✓✓（已读） vs 单勾 ✓（已送达） |
| 4.5 | 批量已读（打开会话时） | 一次性标记到最新消息 | 减少 WS 事件频率 |

**已读计算 SQL**：

```sql
-- 未读消息数（学 nestjs-chat）
SELECT COUNT(*) FROM messages m
WHERE m."converseId" = :converseId
  AND m."createdAt" > (
    SELECT m2."createdAt" FROM messages m2 WHERE m2.id = :lastSeenMessageId
  )
  AND m."authorId" != :userId;
```

**关键文件**：

```
apps/server/src/gateway/chat.gateway.ts        # @SubscribeMessage('message:read')
apps/server/src/converses/converses.service.ts  # 未读计数逻辑
```

**验收标准**：
- A 发消息给 B → A 看到单勾 ✓
- B 打开聊天窗口 → A 看到双勾 ✓✓
- 会话列表中未读数实时更新为 0

---

## 线 B — Bot 框架

### Phase 5: Bot Model + CRUD API

**目标**：建立多 Bot 数据模型，Bot 作为特殊 User 存在于系统中。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 5.1 | 新增 Bot model 到 Prisma schema | bots 表 + migration | BotType enum (REMOTE_EXEC / SOCIAL_MEDIA / CUSTOM) 可用 |
| 5.2 | 创建 BotsModule + BotsService | `apps/server/src/bots/` | 模块可注入 |
| 5.3 | 实现 Bot CRUD API | REST 端点 | POST/GET/PATCH/DELETE /api/v1/bots |
| 5.4 | Bot-User 关联逻辑 | BotsService | 创建 Bot 时自动创建对应 User 记录（Bot 即 User） |
| 5.5 | agentConfig JSON schema 定义 | packages/shared | Zod schema 验证 bot 配置 |
| 5.6 | 单元测试 | bots.service.spec.ts | Bot CRUD + User 关联测试 |

**Bot Model 要点**：

```prisma
model Bot {
  id          String   @id @default(cuid())
  name        String
  description String?
  avatarUrl   String?
  type        BotType  @default(REMOTE_EXEC)
  agentConfig Json     // { systemPrompt, llmProvider, tools[], ... }
  ownerId     String
  isPinned    Boolean  @default(true)
  isDeletable Boolean  @default(true)   // Supervisor/Coding Bot 为 false
  userId      String   @unique   // 关联的 User 记录
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  owner User @relation("BotOwner", fields: [ownerId], references: [id])
  user  User @relation("BotUser", fields: [userId], references: [id])

  @@index([ownerId])
  @@map("bots")
}

enum BotType {
  REMOTE_EXEC    // 远程执行（MVP 唯一类型）
  SOCIAL_MEDIA   // 社媒运营 (v1.x)
  CUSTOM         // 自定义 (v2.0)
}
```

**agentConfig JSON 结构**：

```typescript
interface BotAgentConfig {
  systemPrompt: string;            // Agent system prompt
  llmProvider: 'deepseek' | 'kimi'; // 默认 LLM
  llmModel?: string;               // 具体模型名
  tools: string[];                  // 可用工具列表 ["system.run", "camera.snap", ...]
  maxTokens?: number;
  temperature?: number;
}
```

**关键文件**：

```
apps/server/src/bots/
  ├── bots.module.ts
  ├── bots.controller.ts        # CRUD /api/v1/bots
  ├── bots.service.ts           # Bot + User 联创逻辑
  └── dto/
      ├── create-bot.dto.ts
      └── bot-response.dto.ts

packages/shared/src/schemas/bot.schema.ts   # agentConfig Zod 验证
```

**REST API**：

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/v1/bots` | 创建 Bot（自动创建关联 User） |
| GET | `/api/v1/bots` | 当前用户的 Bot 列表 |
| GET | `/api/v1/bots/:id` | Bot 详情 |
| PATCH | `/api/v1/bots/:id` | 更新 Bot 配置 |
| DELETE | `/api/v1/bots/:id` | 删除 Bot（需 isDeletable=true，软删除 Bot + 关联 User，保留历史消息） |

**验收标准**：
- 创建 Bot 时自动生成关联 User 记录
- Bot 列表 API 正确返回当前用户的所有 Bot
- agentConfig 验证不通过时返回 400
- Supervisor / Coding Bot（isDeletable=false）不可被删除，返回 403

---

### Phase 6: 注册自动创建 Bot

**目标**：用户注册后系统自动创建 Supervisor + Coding Bot，实现"开箱即用"体验。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 6.1 | 定义默认 Bot 模板 | seed/bot-templates.ts | Supervisor + Coding Bot 的 agentConfig |
| 6.2 | 注册流程钩子 | AuthService.register() 中调用 BotsService | 注册成功后自动创建 2 个 Bot |
| 6.3 | 自动创建 DM Converse | Bot 与用户间的 DM 会话 | Bot 聊天框立即可用 |
| 6.4 | 欢迎消息 | MessagesService | Supervisor: 欢迎引导；Coding Bot: 设备连接引导 |
| 6.5 | 测试 | auth.e2e-spec.ts 扩展 | 注册后自动创建 2 个 Bot + 2 个 DM + 欢迎消息 |

**默认 Bot 模板**：

```typescript
const DEFAULT_BOTS = [
  {
    name: 'Supervisor',
    description: '你的智能助手管家，通知汇总 + 调度中心',
    type: BotType.REMOTE_EXEC,
    isPinned: true,
    agentConfig: {
      systemPrompt: 'You are Supervisor, the user\'s intelligent assistant manager...',
      llmProvider: 'deepseek',
      tools: [],
    },
    welcomeMessage: '你好！我是 Supervisor，你的智能管家。有任何问题可以问我。',
  },
  {
    name: 'Coding Bot',
    description: '远程代码执行助手，连接你的桌面设备',
    type: BotType.REMOTE_EXEC,
    isPinned: true,
    agentConfig: {
      systemPrompt: 'You are Coding Bot, a remote code execution assistant...',
      llmProvider: 'deepseek',
      tools: ['system.run', 'system.which'],
    },
    welcomeMessage: '你好！我是 Coding Bot。请先在桌面端登录以连接你的设备。',
  },
];
```

**验收标准**：
- 新用户注册后，聊天列表自动显示 Supervisor 和 Coding Bot（固定置顶）
- 每个 Bot 聊天框内有欢迎消息
- Bot 不可被删除好友、不可被拉黑

---

### Phase 7: Bot 聊天 UI

**目标**：Bot 作为独立联系人拥有专属聊天窗口，BOT_NOTIFICATION 类型消息以卡片形式渲染。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 7.1 | Bot 聊天列表置顶 | 会话列表排序逻辑 | isPinned=true 的 Bot 永远在顶部 |
| 7.2 | Bot 聊天界面 | 与普通 DM 共用消息组件 | Bot 头像 + 标识角标 |
| 7.3 | BOT_NOTIFICATION 消息类型 | MessageType enum 扩展 | 通知卡片组件（标题 + 描述 + 操作按钮） |
| 7.4 | 通知卡片渲染器 | 前端组件 | 根据 message.metadata 渲染不同样式的卡片 |
| 7.5 | Bot 消息路由 | 发消息到 Bot → 路由到对应 agentConfig | MessagesService 中判断收件人是否为 Bot |
| 7.6 | Flutter Bot UI | apps/mobile/lib/features/chat/ | 聊天列表置顶 + 卡片渲染 |
| 7.7 | Desktop Bot UI | apps/desktop/src/renderer/components/ | 同上 |

**BOT_NOTIFICATION 消息 metadata 结构**：

```typescript
interface BotNotificationMetadata {
  cardType: 'task_complete' | 'error' | 'info' | 'action_required';
  title: string;
  description?: string;
  sourceBotId?: string;       // 触发来源 Bot
  sourceBotName?: string;
  actions?: Array<{
    label: string;
    action: string;           // 'view_result' | 'retry' | 'navigate'
    payload?: Record<string, unknown>;
  }>;
  executionTimeMs?: number;
  timestamp: string;
}
```

**UI 渲染示例**：

```
Supervisor 聊天框:
  ┌────────────────────────────────────────┐
  │ ✅ Coding Bot 完成了测试任务            │  ← cardType: 'task_complete'
  │ 3 分钟前 · 耗时 45s · [查看结果]       │
  └────────────────────────────────────────┘

  用户: 结果怎么样？
  Supervisor: 所有测试通过，共 12 个用例。

  ┌────────────────────────────────────────┐
  │ ❌ Coding Bot 执行失败                  │  ← cardType: 'error'
  │ `npm test` 退出码 1                    │
  │ [查看错误日志] [重试]                   │
  └────────────────────────────────────────┘
```

**验收标准**：
- Bot 始终置顶在会话列表，不可被用户移除
- BOT_NOTIFICATION 消息以卡片样式渲染（非纯文本）
- 卡片上的操作按钮可点击（查看结果、重试等）

---

### Phase 8: OpenClaw Node 集成

**目标**：将 Sprint 1 的 `child_process.exec()` 替换为 OpenClaw Node，获得更丰富的执行能力和安全模型。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 8.1 | OpenClaw Node 进程管理 | `apps/desktop/src/main/services/openclaw.service.ts` | spawn / 健康检查 / 重启 |
| 8.2 | OpenClaw WebSocket 客户端 | 桌面端连接 OpenClaw Node | JSON-RPC 通信 |
| 8.3 | 命令执行桥接 | device:command:execute → openclaw system.run | 替换 child_process.exec |
| 8.4 | 安全模式配置 | exec-approvals: ask | 需要用户确认的命令弹出审批对话框 |
| 8.5 | 能力上报 | device:register payload 中包含 capabilities | 上报 OpenClaw Node 支持的能力列表 |
| 8.6 | 回退逻辑 | OpenClaw 不可用时回退到 child_process.exec | 保证基本功能不中断 |
| 8.7 | Windows 兼容性验证 | 在 Windows 上测试 OpenClaw Node | 记录已知问题和 workaround |

**关键实现**：

```typescript
// apps/desktop/src/main/services/openclaw.service.ts
import { spawn, ChildProcess } from 'child_process';

export class OpenClawService {
  private process: ChildProcess | null = null;

  async start(token: string): Promise<void> {
    this.process = spawn('openclaw', [
      'node', 'run',
      '--host', '127.0.0.1',
      '--port', '18790',
      '--display-name', 'LinkingChat Desktop',
    ], {
      env: { ...process.env, OPENCLAW_GATEWAY_TOKEN: token },
    });

    this.process.on('exit', (code) => {
      // 异常退出时自动重启（最多 3 次）
    });
  }

  async executeCommand(command: string, timeout = 30000): Promise<CommandResult> {
    // WebSocket JSON-RPC 调用 system.run
    // { type: "req", id: cuid(), method: "system.run", params: { command, timeout } }
  }

  async stop(): Promise<void> {
    this.process?.kill('SIGTERM');
  }
}
```

**验收标准**：
- Electron 启动时自动 spawn OpenClaw Node 子进程
- 命令通过 OpenClaw 执行，结果正确返回
- OpenClaw 崩溃后 3 秒内自动重启
- OpenClaw 不可用时回退到 child_process.exec，日志记录回退原因

---

### Phase 9: Supervisor 通知汇总

**目标**：所有 Bot 的关键事件汇总到 Supervisor 聊天流中，以 BOT_NOTIFICATION 卡片形式展示。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 9.1 | Bot 事件监听 | `apps/server/src/bots/bot-event.listener.ts` | 监听所有 Bot 的执行结果 |
| 9.2 | Supervisor 通知生成 | 将 Bot 事件转化为 BOT_NOTIFICATION 消息 | 写入 Supervisor 的 DM Converse |
| 9.3 | WS 推送通知 | bot:notification 事件 | 推送到 u-{userId} |
| 9.4 | 通知聚合策略 | 5 秒内同一 Bot 的多个事件合并为一条 | 避免通知风暴 |
| 9.5 | 触发来源标注 | 跨 Bot 触发时标注来源 | 卡片显示 "[来自 Coding Bot 的协作]" |

**事件流**：

```
Coding Bot 执行完命令:
  device:result:complete
    → BotEventListener 捕获
    → 生成 BOT_NOTIFICATION 消息
    → 写入 Supervisor 的 DM Converse
    → WS: message:new → Supervisor 聊天房间
    → WS: bot:notification → u-{userId}（通知用户）
```

**验收标准**：
- Coding Bot 完成任务 → Supervisor 聊天框自动出现完成通知卡片
- 连续执行 3 个命令 → 通知卡片合并为"完成 3 个任务"
- 卡片中的 [查看结果] 按钮跳转到 Coding Bot 聊天框

---

## 交付物总览

| 交付物 | 描述 | 对应 Phase |
|--------|------|-----------|
| 好友系统 | 请求 / 接受 / 删除 / 拉黑 + WS 实时通知 | Phase 1 |
| 1 对 1 聊天 | DM 消息 CRUD + 游标分页 + 实时推送 | Phase 2 |
| /chat 命名空间 | WebSocket 社交事件网关 | Phase 2 |
| 在线状态 | Redis presence + WS 广播 | Phase 3 |
| 已读回执 | lastSeenMessageId + 双勾 UI | Phase 4 |
| Bot 框架 | Bot CRUD + Bot-User 关联 | Phase 5 |
| 开箱即用 Bot | 注册自动创建 Supervisor + Coding Bot | Phase 6 |
| Bot 聊天 UI | 置顶 + 通知卡片渲染 | Phase 7 |
| OpenClaw 集成 | 替换 child_process.exec | Phase 8 |
| Supervisor 通知 | 全 Bot 事件汇总 | Phase 9 |

## 新增 REST API 端点

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/v1/friends/request` | 发送好友请求 |
| POST | `/api/v1/friends/accept/:requestId` | 接受好友请求 |
| POST | `/api/v1/friends/reject/:requestId` | 拒绝好友请求 |
| GET | `/api/v1/friends` | 好友列表 |
| GET | `/api/v1/friends/requests` | 待处理请求列表 |
| DELETE | `/api/v1/friends/:userId` | 删除好友 |
| POST | `/api/v1/friends/block/:userId` | 拉黑用户 |
| GET | `/api/v1/converses` | 会话列表 + 未读 |
| POST | `/api/v1/messages` | 发送消息 |
| GET | `/api/v1/messages?converseId=&cursor=` | 消息历史（游标分页） |
| PATCH | `/api/v1/messages/:id` | 编辑消息 |
| DELETE | `/api/v1/messages/:id` | 撤回消息（软删除） |
| POST | `/api/v1/bots` | 创建 Bot |
| GET | `/api/v1/bots` | Bot 列表 |
| GET | `/api/v1/bots/:id` | Bot 详情 |
| PATCH | `/api/v1/bots/:id` | 更新 Bot 配置 |
| DELETE | `/api/v1/bots/:id` | 删除 Bot |
| GET | `/api/v1/users/online` | 批量查询在线状态 |

## 新增 WS 事件（/chat 命名空间）

| 事件名 | 方向 | 说明 |
|--------|------|------|
| `converse:join` | C→S | 加入会话房间 |
| `converse:leave` | C→S | 离开会话房间 |
| `message:new` | S→C | 新消息广播 |
| `message:updated` | S→C | 消息编辑广播 |
| `message:deleted` | S→C | 消息撤回广播 |
| `message:typing` | 双向 | 输入状态 |
| `message:read` | 双向 | 已读回执 |
| `friend:request` | S→C | 好友请求通知 |
| `friend:accepted` | S→C | 好友接受通知 |
| `friend:removed` | S→C | 好友删除通知 |
| `converse:new` | S→C | 新会话通知 |
| `presence:update` | C→S | 状态切换 |
| `presence:changed` | S→C | 状态变更广播 |
| `bot:notification` | S→C | Bot 事件通知 |

## 里程碑检查点

| 检查点 | 验收内容 | 对应 Phase |
|--------|---------|-----------|
| **M1** | Schema 扩展完成：所有社交 + Bot 表建立，seed 数据可插入 | Phase 0 |
| **M2** | 好友系统可用：请求 → 接受 → 列表 → WS 通知全通 | Phase 1 |
| **M3** | 聊天可用：DM 收发 + 分页 + 实时推送 + 输入状态 | Phase 2 |
| **M4** | 状态 + 已读：好友上下线实时显示 + 消息双勾 | Phase 3-4 |
| **M5** | Bot 可用：注册后自动创建 Bot + Bot 聊天框 + 欢迎消息 | Phase 5-7 |

---

## Sprint 2 不做的事

| 功能 | 原因 | 何时做 |
|------|------|--------|
| OpenClaw Node 集成 | Sprint 1 的 child_process.exec() 已可用 | 独立任务或 Sprint 3 |
| Supervisor 通知汇总 | 需要 AI 模块 + 完整 Bot 执行管线 | Sprint 3 |
| 群聊 / 频道 | 社交基础先稳固 1 对 1 | Sprint 3 |
| AI 三模式 (Draft / Whisper / Predictive) | 需要先有稳定的消息系统 | Sprint 3 |
| LLM Router | AI 模块前置依赖 | Sprint 3 |
| 文件 / 图片 / 语音消息 | Sprint 2 只做纯文本消息 | Sprint 4 |
| 推送通知 (FCM / APNs) | Sprint 2 依赖 WebSocket 实时连接 | Sprint 4 |
| 消息搜索 | 需要 PostgreSQL 全文搜索配置 | Sprint 4 |
| i18n | Sprint 2 硬编码中文 | Sprint 4 |
| 生产部署 | 仍然跑 localhost | Sprint 4 |
| Bot 间通信 | MVP Bot 各自独立 | Sprint 3（Predictive Actions + 多 Agent） |

**完成后进入 → [Sprint 3](./sprint3_implement.md)**
