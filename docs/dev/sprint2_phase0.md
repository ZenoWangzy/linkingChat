> **状态：⏳ 待开始**

# Sprint 2 — Phase 0：数据库 Schema 扩展

> **负责人**：后端开发者
>
> **前置条件**：Sprint 1 全部完成（User / Device / Command / RefreshToken 四表已存在）
>
> **产出**：完整的社交 + Bot 数据模型，单次 migration 创建所有新表
>
> **参考**：[database-schema.md](../dev-plan/database-schema.md) | [sprint2_implement.md](./sprint2_implement.md) | [reference-architecture-guide.md](../dev-plan/reference-architecture-guide.md)

---

## 任务清单

| # | 任务 | 文件 | 依赖 |
|---|------|------|------|
| 0.1 | 扩展 User model（添加 status、lastSeenAt、deletedAt）| `apps/server/prisma/schema.prisma` | - |
| 0.2 | 新增 FriendRequest model | 同上 | 0.1 |
| 0.3 | 新增 Friendship model | 同上 | 0.1 |
| 0.4 | 新增 UserBlock model | 同上 | 0.1 |
| 0.5 | 新增 Converse + ConverseMember model | 同上 | 0.1 |
| 0.6 | 新增 Message + Attachment model | 同上 | 0.5 |
| 0.7 | 新增 Bot model | 同上 | 0.1 |
| 0.8 | 新增共享枚举到 packages/shared | `packages/shared/src/enums/` | - |
| 0.9 | 新增 Chat WS 事件类型到 ws-protocol | `packages/ws-protocol/src/` | - |
| 0.10 | 执行 migration | `prisma/migrations/002_social_and_bots/` | 0.1-0.7 |
| 0.11 | 更新 seed.ts | `apps/server/prisma/seed.ts` | 0.10 |

---

## Prisma 枚举定义

在 `schema.prisma` 顶部（现有枚举区域）新增以下枚举：

```prisma
// ========== 新增枚举 ==========

enum UserStatus {
  ONLINE
  IDLE
  DND
  OFFLINE
}

enum FriendRequestStatus {
  PENDING
  REJECTED
}

enum ConverseType {
  DM
  MULTI
  GROUP
}

enum MessageType {
  TEXT
  IMAGE
  FILE
  VOICE
  SYSTEM
  BOT_NOTIFICATION
}

enum BotType {
  REMOTE_EXEC
  SOCIAL_MEDIA
  CUSTOM
}
```

---

## 0.1 扩展 User model

在现有 User model 上新增 `status`、`lastSeenAt`、`deletedAt` 字段，以及所有社交关系字段。

```prisma
// apps/server/prisma/schema.prisma — User model（扩展后完整版）

model User {
  id          String     @id @default(cuid())
  email       String     @unique
  username    String     @unique
  password    String
  displayName String
  avatarUrl   String?

  // ===== Sprint 2 新增字段 =====
  status      UserStatus @default(OFFLINE)
  lastSeenAt  DateTime?
  deletedAt   DateTime?

  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  // ===== Sprint 1 原有关系 =====
  devices       Device[]
  refreshTokens RefreshToken[]

  // ===== Sprint 2 新增关系 =====

  // 好友请求
  sentFriendRequests     FriendRequest[] @relation("FriendRequestSender")
  receivedFriendRequests FriendRequest[] @relation("FriendRequestReceiver")

  // 好友关系（双向：较小 ID 放 A 端）
  friendshipsA Friendship[] @relation("FriendshipUserA")
  friendshipsB Friendship[] @relation("FriendshipUserB")

  // 拉黑
  blockedUsers   UserBlock[] @relation("Blocker")
  blockedByUsers UserBlock[] @relation("Blocked")

  // 会话成员
  converseMembers ConverseMember[]

  // 消息
  messages Message[]

  // Bot
  ownedBots Bot[] @relation("BotOwner")
  botUser   Bot?  @relation("BotUser")

  @@map("users")
}
```

**要点**：
- `status` 默认值为 `OFFLINE`，用户连接 WebSocket 后由 PresenceService 更新为 `ONLINE`
- `lastSeenAt` 记录最后活跃时间，断开连接时更新
- `deletedAt` 用于软删除用户账号，`null` 表示未删除
- `botUser` 是可选的一对一反向关系：只有 Bot 用户才有此关联（`Bot.userId @unique` → `User.botUser`）

---

## 0.2 FriendRequest model

好友请求表。接受后直接删除该行并创建 Friendship 行，不设 ACCEPTED 状态。

```prisma
// apps/server/prisma/schema.prisma

model FriendRequest {
  id         String              @id @default(cuid())
  senderId   String
  receiverId String
  status     FriendRequestStatus @default(PENDING)
  message    String?             // 验证消息（可选）
  createdAt  DateTime            @default(now())
  updatedAt  DateTime            @updatedAt

  sender   User @relation("FriendRequestSender", fields: [senderId], references: [id])
  receiver User @relation("FriendRequestReceiver", fields: [receiverId], references: [id])

  @@unique([senderId, receiverId])
  @@index([status])
  @@map("friend_requests")
}
```

**设计说明**：
- `@@unique([senderId, receiverId])`：同一对用户之间同时只能有一个好友请求
- `@@index([status])`：按状态筛选（查询待处理请求）时的性能优化
- `message` 字段允许发送者附带验证消息，如"我是你的同事小李"
- 接受请求的流程：DELETE FriendRequest + INSERT Friendship + INSERT Converse(DM) + INSERT ConverseMember x2

---

## 0.3 Friendship model

确认的好友关系表。较小 ID 始终放在 `userAId` 端以保证唯一性。

```prisma
// apps/server/prisma/schema.prisma

model Friendship {
  id        String   @id @default(cuid())
  userAId   String
  userBId   String
  createdAt DateTime @default(now())

  userA User @relation("FriendshipUserA", fields: [userAId], references: [id])
  userB User @relation("FriendshipUserB", fields: [userBId], references: [id])

  @@unique([userAId, userBId])
  @@map("friendships")
}
```

**设计说明**：
- **ID 排序约束**：业务层在插入时必须保证 `userAId < userBId`（字符串字典序比较）。这样查询"A 和 B 是否是好友"只需一次唯一索引查找
- **双向查询**：查询用户 X 的所有好友 → `WHERE userAId = X OR userBId = X`
- 不使用中间表或两行记录（A→B, B→A），单行记录更节省空间且避免不一致

```typescript
// 业务层排序示例（FriendsService 中）
function sortFriendIds(id1: string, id2: string): [string, string] {
  return id1 < id2 ? [id1, id2] : [id2, id1];
}
```

---

## 0.4 UserBlock model

用户拉黑关系表。

```prisma
// apps/server/prisma/schema.prisma

model UserBlock {
  id        String   @id @default(cuid())
  blockerId String
  blockedId String
  createdAt DateTime @default(now())

  blocker User @relation("Blocker", fields: [blockerId], references: [id])
  blocked User @relation("Blocked", fields: [blockedId], references: [id])

  @@unique([blockerId, blockedId])
  @@map("user_blocks")
}
```

**设计说明**：
- `@@unique([blockerId, blockedId])`：同一拉黑关系不可重复
- 拉黑时需同时删除对应的 Friendship 记录（如果存在）
- 拉黑是单向的：A 拉黑 B 后，B 无法向 A 发消息/好友请求，但 B 不知道自己被拉黑（返回通用错误）

---

## 0.5 Converse + ConverseMember model

统一消息管道。DM、多人私聊、群组频道的消息都通过 Converse 路由。

### Converse

```prisma
// apps/server/prisma/schema.prisma

model Converse {
  id        String       @id @default(cuid())
  type      ConverseType
  name      String?      // DM 时为空，MULTI/GROUP 有名称
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  members  ConverseMember[]
  messages Message[]

  @@map("converses")
}
```

### ConverseMember

```prisma
// apps/server/prisma/schema.prisma

model ConverseMember {
  converseId       String
  userId           String
  isOpen           Boolean  @default(true)   // DM 可见性（学 Valkyrie）
  lastSeenMessageId String?                  // 最后已读消息 ID（游标，学 nestjs-chat）
  lastMessageId    String?                   // 最后一条消息 ID（反范式优化，用于排序）
  joinedAt         DateTime @default(now())

  converse Converse @relation(fields: [converseId], references: [id])
  user     User     @relation(fields: [userId], references: [id])

  @@id([converseId, userId])
  @@map("converse_members")
}
```

**设计说明**：
- **统一管道**：所有消息流都经过 Converse，区分 DM / MULTI / GROUP 三种类型
  - **DM**：创建 `Converse(type=DM)` + 两个 `ConverseMember`
  - **MULTI**：多人私聊，创建 `Converse(type=MULTI)` + N 个 `ConverseMember`
  - **GROUP**：群组频道关联，`Channel.converseId → Converse.id`
- **`isOpen`**：DM 可见性控制。删除好友时设 `isOpen=false`，会话不在列表中显示但消息不丢失。重新添加好友时恢复 `isOpen=true`
- **`lastSeenMessageId`**：精确到消息粒度的已读追踪，用于未读计数计算
- **`lastMessageId`**：反范式冗余字段，用于会话列表排序（按最后一条消息时间），避免每次查询都 JOIN messages 表
- **复合主键 `@@id([converseId, userId])`**：一个用户在一个会话中只有一条成员记录

---

## 0.6 Message + Attachment model

消息表 + 附件表，1:N 关系。

### Message

```prisma
// apps/server/prisma/schema.prisma

model Message {
  id          String      @id @default(cuid())
  content     String?     // 可为空（纯文件消息）
  type        MessageType @default(TEXT)
  converseId  String
  authorId    String
  metadata    Json?       // AI 扩展字段、Bot 通知 metadata
  replyToId   String?     // 引用回复的消息 ID
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  deletedAt   DateTime?   // 软删除 = 消息撤回

  converse    Converse    @relation(fields: [converseId], references: [id])
  author      User        @relation(fields: [authorId], references: [id])
  replyTo     Message?    @relation("MessageReply", fields: [replyToId], references: [id])
  replies     Message[]   @relation("MessageReply")
  attachments Attachment[]

  @@index([converseId, createdAt])
  @@map("messages")
}
```

### Attachment

```prisma
// apps/server/prisma/schema.prisma

model Attachment {
  id           String  @id @default(cuid())
  messageId    String
  url          String
  filename     String
  mimeType     String
  size         Int?    // 文件大小 (bytes)
  width        Int?    // 图片/视频宽度 (px)
  height       Int?    // 图片/视频高度 (px)
  duration     Int?    // 音频/视频时长 (ms)
  thumbnailUrl String? // 缩略图 URL

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@map("attachments")
}
```

**设计说明**：
- **`@@index([converseId, createdAt])`**：消息分页查询的核心索引。游标分页以 `createdAt DESC` 排序，每页 35 条
- **`replyToId`**：支持引用回复，自引用关系。`replyTo` / `replies` 为 Prisma 自引用关系对
- **`metadata Json?`**：灵活扩展字段，用于：
  - `BOT_NOTIFICATION` 类型的通知卡片数据（cardType、title、actions 等）
  - AI 相关元信息（草稿 ID、建议 ID 等）
- **`deletedAt`**：软删除实现消息撤回。客户端判断 `deletedAt IS NOT NULL` 显示"已撤回"占位
- **Attachment `onDelete: Cascade`**：删除消息时级联删除附件（物理存储清理由后台任务处理）
- Sprint 2 阶段仅支持 TEXT 类型消息，IMAGE/FILE/VOICE 在 Sprint 4 实现

---

## 0.7 Bot model

多 Bot 框架。每个 Bot 映射到一个 OpenClaw agent config，作为特殊 User 存在于系统中。

```prisma
// apps/server/prisma/schema.prisma

model Bot {
  id          String   @id @default(cuid())
  name        String
  description String?
  avatarUrl   String?
  type        BotType  @default(REMOTE_EXEC)
  agentConfig Json     // { systemPrompt, llmProvider, tools[], maxTokens?, temperature? }
  ownerId     String
  isPinned    Boolean  @default(true)   // 是否固定置顶在聊天列表
  isDeletable Boolean  @default(true)   // Supervisor/Coding Bot 为 false，不可被删除
  userId      String   @unique          // 关联的 User 记录（Bot 即 User）
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  owner User @relation("BotOwner", fields: [ownerId], references: [id])
  user  User @relation("BotUser", fields: [userId], references: [id])

  @@index([ownerId])
  @@map("bots")
}
```

**设计说明**：
- **Bot 即 User**：每个 Bot 关联一个 User 记录。这样 Bot 可以像普通用户一样出现在好友列表、会话列表中，消息的 `authorId` 可以是 Bot 的 User ID
- **`userId @unique`**：一对一关系，一个 Bot 只对应一个 User
- **`isPinned`**：默认置顶。系统默认的 Supervisor 和 Coding Bot 始终置顶，用户创建的自定义 Bot 也默认置顶（可修改）
- **`isDeletable`**：系统默认 Bot（Supervisor、Coding Bot）设为 `false`，用户不可删除。用户自建的 Bot 可删除
- **`agentConfig Json`**：OpenClaw agent 配置，结构如下：

```typescript
interface BotAgentConfig {
  systemPrompt: string;              // Agent system prompt
  llmProvider: 'deepseek' | 'kimi';  // 默认 LLM 提供商
  llmModel?: string;                 // 具体模型名
  tools: string[];                   // 可用工具列表 ["system.run", "camera.snap", ...]
  maxTokens?: number;
  temperature?: number;
}
```

---

## 0.8 共享枚举（packages/shared）

在 `packages/shared` 中创建 TypeScript 枚举，供三端（Server / Desktop / Mobile）共用。这些枚举与 Prisma 枚举值一一对应。

```typescript
// packages/shared/src/enums/index.ts

/** 用户在线状态 */
export enum UserStatus {
  ONLINE = 'ONLINE',
  IDLE = 'IDLE',
  DND = 'DND',
  OFFLINE = 'OFFLINE',
}

/** 好友请求状态 */
export enum FriendRequestStatus {
  PENDING = 'PENDING',
  REJECTED = 'REJECTED',
}

/** 会话类型 */
export enum ConverseType {
  /** 1 对 1 私聊 */
  DM = 'DM',
  /** 多人私聊 */
  MULTI = 'MULTI',
  /** 群组频道 */
  GROUP = 'GROUP',
}

/** 消息类型 */
export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  FILE = 'FILE',
  VOICE = 'VOICE',
  /** 系统消息（加入群组、好友添加等） */
  SYSTEM = 'SYSTEM',
  /** Bot 通知卡片消息 */
  BOT_NOTIFICATION = 'BOT_NOTIFICATION',
}

/** Bot 类型 */
export enum BotType {
  /** 远程执行（MVP 唯一类型） */
  REMOTE_EXEC = 'REMOTE_EXEC',
  /** 社媒运营 (v1.x) */
  SOCIAL_MEDIA = 'SOCIAL_MEDIA',
  /** 自定义 (v2.0) */
  CUSTOM = 'CUSTOM',
}
```

确保在 `packages/shared/src/index.ts` 中导出：

```typescript
// packages/shared/src/index.ts — 新增导出
export * from './enums/index';
```

**要点**：
- TypeScript 枚举使用字符串值（`= 'ONLINE'`），与 Prisma 枚举值完全对应
- 客户端使用这些枚举进行类型安全的比较和渲染，无需硬编码字符串
- Prisma 枚举定义在 `schema.prisma` 中（数据库层），TypeScript 枚举在 `packages/shared` 中（应用层），两者手动保持同步

---

## 0.9 Chat WS 事件类型（packages/ws-protocol）

为 Sprint 2 社交功能新增 Chat 事件的 Payload 类型定义和事件名常量。

### 事件名常量

```typescript
// packages/ws-protocol/src/events.ts — 新增 CHAT_EVENTS

export const CHAT_EVENTS = {
  // Client → Server
  CONVERSE_JOIN:   'converse:join',
  CONVERSE_LEAVE:  'converse:leave',
  MESSAGE_TYPING:  'message:typing',
  MESSAGE_READ:    'message:read',
  PRESENCE_UPDATE: 'presence:update',

  // Server → Client
  MESSAGE_NEW:       'message:new',
  MESSAGE_UPDATED:   'message:updated',
  MESSAGE_DELETED:   'message:deleted',
  FRIEND_REQUEST:    'friend:request',
  FRIEND_ACCEPTED:   'friend:accepted',
  FRIEND_REMOVED:    'friend:removed',
  CONVERSE_NEW:      'converse:new',
  CONVERSE_UPDATED:  'converse:updated',
  PRESENCE_CHANGED:  'presence:changed',
  NOTIFICATION_NEW:  'notification:new',
  BOT_NOTIFICATION:  'bot:notification',
} as const;
```

### Payload 类型定义

```typescript
// packages/ws-protocol/src/payloads/chat.payloads.ts

// ========== 好友相关 ==========

/** friend:request 事件的 payload */
export interface FriendRequestPayload {
  requestId: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  senderAvatarUrl?: string;
  message?: string;        // 验证消息
  createdAt: string;       // ISO 8601
}

/** friend:accepted / friend:removed 事件的 payload */
export interface FriendPayload {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  status?: string;         // UserStatus
}

// ========== 消息相关 ==========

/** message:new / message:updated 事件的 payload */
export interface MessageResponse {
  id: string;
  content?: string;
  type: string;            // MessageType
  converseId: string;
  authorId: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
  };
  metadata?: Record<string, unknown>;
  replyToId?: string;
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
  deletedAt?: string;      // ISO 8601, null if not deleted
}

// ========== 会话相关 ==========

/** converse:new / converse:updated 事件的 payload */
export interface ConverseResponse {
  id: string;
  type: string;            // ConverseType
  name?: string;
  members: Array<{
    userId: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
  }>;
  lastMessage?: MessageResponse;
  unreadCount?: number;
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}

// ========== 输入状态 ==========

/** message:typing 事件的 payload */
export interface TypingPayload {
  converseId: string;
  userId: string;
  username: string;
  isTyping: boolean;
}

// ========== 在线状态 ==========

/** presence:changed 事件的 payload */
export interface PresencePayload {
  userId: string;
  status: string;          // UserStatus
  lastSeenAt?: string;     // ISO 8601
}
```

确保在 `packages/ws-protocol/src/index.ts` 中导出：

```typescript
// packages/ws-protocol/src/index.ts — 新增导出
export * from './payloads/chat.payloads';
// events.ts 中已导出 DEVICE_EVENTS，现在也导出 CHAT_EVENTS
export { DEVICE_EVENTS, CHAT_EVENTS } from './events';
```

**要点**：
- Payload 类型与 `ServerToClientEvents` / `ClientToServerEvents` 接口配合使用
- 日期字段统一使用 ISO 8601 字符串格式（`string`），而非 `Date` 对象，因为 JSON 序列化后是字符串
- `MessageResponse` 嵌入 `author` 对象，避免客户端额外请求用户信息
- `ConverseResponse` 嵌入 `members` 和 `lastMessage`，用于会话列表渲染

---

## 0.10 执行 migration

确保所有 model 和枚举都已正确添加到 `schema.prisma` 后，执行 migration。

```bash
cd apps/server

# 生成 migration（开发环境）
npx prisma migrate dev --name social_and_bots

# 验证生成结果
ls prisma/migrations/
# 应看到:
#   001_init/                    (Sprint 1 已有)
#   <timestamp>_social_and_bots/ (Sprint 2 新增)

# 验证类型生成
npx prisma generate
# ✅ Generated Prisma Client

# 验证所有新 model 在 PrismaClient 类型中可用
npx ts-node -e "
  import { PrismaClient } from '@prisma/client';
  const prisma = new PrismaClient();
  // 以下属性应存在且无 TS 错误
  prisma.friendRequest;
  prisma.friendship;
  prisma.userBlock;
  prisma.converse;
  prisma.converseMember;
  prisma.message;
  prisma.attachment;
  prisma.bot;
  console.log('All models accessible');
  prisma.\$disconnect();
"
```

**要点**：
- migration 文件名为 `social_and_bots`，对应 Sprint 2 Phase 0 的全部 schema 变更
- 如果 migration 失败（字段冲突等），先 `npx prisma migrate reset`（仅开发环境！会清空数据）再重新 migrate
- `prisma generate` 后确保 IDE 能自动补全所有新 model 的字段

---

## 0.11 更新 seed.ts

创建测试种子数据：2 个测试用户、1 个好友关系、1 个 DM 会话 + 2 个成员、若干测试消息。

```typescript
// apps/server/prisma/seed.ts

import { PrismaClient, ConverseType, MessageType, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ===== 1. 创建测试用户 =====
  const passwordHash = await argon2.hash('Test1234!');

  const alice = await prisma.user.upsert({
    where: { email: 'alice@linkingchat.com' },
    update: {},
    create: {
      email: 'alice@linkingchat.com',
      username: 'alice',
      password: passwordHash,
      displayName: 'Alice',
      status: UserStatus.OFFLINE,
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@linkingchat.com' },
    update: {},
    create: {
      email: 'bob@linkingchat.com',
      username: 'bob',
      password: passwordHash,
      displayName: 'Bob',
      status: UserStatus.OFFLINE,
    },
  });

  console.log(`  Created users: ${alice.username} (${alice.id}), ${bob.username} (${bob.id})`);

  // ===== 2. 创建好友关系 =====
  // 较小 ID 放 userAId 端
  const [userAId, userBId] = alice.id < bob.id
    ? [alice.id, bob.id]
    : [bob.id, alice.id];

  const friendship = await prisma.friendship.upsert({
    where: {
      userAId_userBId: { userAId, userBId },
    },
    update: {},
    create: {
      userAId,
      userBId,
    },
  });

  console.log(`  Created friendship: ${friendship.id}`);

  // ===== 3. 创建 DM 会话 =====
  // 检查是否已存在 DM 会话
  const existingConverse = await prisma.converse.findFirst({
    where: {
      type: ConverseType.DM,
      AND: [
        { members: { some: { userId: alice.id } } },
        { members: { some: { userId: bob.id } } },
      ],
    },
  });

  const converse = existingConverse ?? await prisma.converse.create({
    data: {
      type: ConverseType.DM,
      members: {
        create: [
          { userId: alice.id },
          { userId: bob.id },
        ],
      },
    },
  });

  console.log(`  Created DM converse: ${converse.id}`);

  // ===== 4. 创建测试消息 =====
  const existingMessages = await prisma.message.count({
    where: { converseId: converse.id },
  });

  if (existingMessages === 0) {
    const msg1 = await prisma.message.create({
      data: {
        content: 'Hi Bob! Welcome to LinkingChat.',
        type: MessageType.TEXT,
        converseId: converse.id,
        authorId: alice.id,
      },
    });

    const msg2 = await prisma.message.create({
      data: {
        content: 'Hey Alice! Thanks, this looks great.',
        type: MessageType.TEXT,
        converseId: converse.id,
        authorId: bob.id,
      },
    });

    const msg3 = await prisma.message.create({
      data: {
        content: 'Let me try sending a command to my desktop.',
        type: MessageType.TEXT,
        converseId: converse.id,
        authorId: alice.id,
      },
    });

    // 更新 ConverseMember 的 lastMessageId
    await prisma.converseMember.update({
      where: {
        converseId_userId: { converseId: converse.id, userId: alice.id },
      },
      data: {
        lastMessageId: msg3.id,
        lastSeenMessageId: msg3.id,  // Alice 已读所有消息
      },
    });

    await prisma.converseMember.update({
      where: {
        converseId_userId: { converseId: converse.id, userId: bob.id },
      },
      data: {
        lastMessageId: msg3.id,
        lastSeenMessageId: msg2.id,  // Bob 只读到自己发的最后一条
      },
    });

    console.log(`  Created ${3} test messages`);
  } else {
    console.log(`  Messages already exist, skipping`);
  }

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

执行种子数据：

```bash
cd apps/server
npx prisma db seed
# 或
npx ts-node prisma/seed.ts
```

确保 `package.json` 中配置了 seed 命令：

```json
// apps/server/package.json
{
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  }
}
```

**要点**：
- 使用 `upsert` 保证种子数据可重复执行（幂等性）
- 密码统一使用 `Test1234!`，方便开发环境登录测试
- `lastSeenMessageId` 设置模拟了"Bob 有 1 条未读"的场景，用于验证未读计数逻辑
- seed 不创建 Bot 数据 — Bot 由 Phase 6（注册自动创建 Bot）在注册流程中自动生成

---

## 完成标准

- [ ] `prisma migrate dev` 成功，所有新表（friend_requests、friendships、user_blocks、converses、converse_members、messages、attachments、bots）在数据库中存在
- [ ] `prisma generate` 生成的 PrismaClient 包含所有新 model 的类型定义
- [ ] seed.ts 执行成功，数据库中有 2 个测试用户 + 1 个好友关系 + 1 个 DM 会话 + 3 条测试消息
- [ ] `pnpm build` 在 packages/shared 和 packages/ws-protocol 中编译通过
- [ ] 新枚举可从 `@linkingchat/shared` 导入：`import { UserStatus, ConverseType, MessageType } from '@linkingchat/shared'`
- [ ] Chat 事件类型可从 `@linkingchat/ws-protocol` 导入：`import { CHAT_EVENTS, MessageResponse, FriendRequestPayload } from '@linkingchat/ws-protocol'`
