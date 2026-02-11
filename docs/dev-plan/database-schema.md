# 数据库 Entity 设计

> 基于 PostgreSQL + TypeORM，参考 Valkyrie v1 的领域模型 + brocoders 的 Hexagonal Architecture

---

## 一、Entity 关系总览

```
                    friends (self-join)
                   ┌──────┬──────┐
                   │userId│friendId│
                   └──────┴──────┘
                         │
  friend_requests        │
  ┌─────────┬──────────┐ │
  │senderId │receiverId│ │
  └─────────┴──────────┘ │
                         │
  ┌─────────────┐        │            ┌──────────────────┐
  │ users       │────────┘──────1:N──>│ devices          │
  │ id (PK)     │                     │ id (PK)          │
  │ username    │                     │ userId (FK)      │
  │ email       │                     │ name             │
  │ password    │                     │ platform         │
  │ avatar      │                     │ isOnline         │
  │ isOnline    │                     │ lastSeen         │
  └─────────────┘                     └──────────────────┘
       │
       │ 1:N (via conversation_members)
       v
  ┌──────────────────────┐           ┌──────────────────────┐
  │ conversation_members │           │ conversations        │
  │ id (PK)              │     N:1   │ id (PK)              │
  │ userId (FK)       ───┼──────────>│ type (dm|group)      │
  │ conversationId (FK)──┼──────────>│ name                 │
  │ role                 │           │ avatar               │
  │ lastReadAt           │           │ ownerId (FK)         │
  │ isOpen               │           │ lastActivityAt       │
  └──────────────────────┘           └──────────────────────┘
                                          │
                                          │ 1:N
                                          v
                                     ┌──────────────────────┐
                                     │ messages             │
                                     │ id (PK)              │
                                     │ conversationId (FK)  │
                                     │ senderId (FK)        │
                                     │ type (text|image|...)│
                                     │ content              │
                                     │ isRecalled           │
                                     └──────────────────────┘
                                          │
                                          │ 1:1 (optional)
                                          v
                                     ┌──────────────────────┐
                                     │ attachments          │
                                     │ id (PK)              │
                                     │ messageId (FK)       │
                                     │ url                  │
                                     │ mimeType             │
                                     │ fileName             │
                                     │ fileSize             │
                                     └──────────────────────┘

  ┌──────────────────────┐
  │ command_logs         │
  │ id (PK)              │
  │ userId (FK)          │
  │ deviceId (FK)        │
  │ type                 │
  │ action               │
  │ status               │
  │ result               │
  │ executionTimeMs      │
  └──────────────────────┘
```

---

## 二、Entity 详细定义

### 2.1 User Entity

**表名**: `users`
**来源**: brocoders 已有，需扩展

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `uuid` | PK, default uuid_generate_v4() | |
| `username` | `varchar(50)` | NOT NULL, UNIQUE | 显示名 |
| `email` | `varchar(255)` | NOT NULL, UNIQUE | 登录邮箱 |
| `password` | `text` | NOT NULL | bcrypt 哈希 |
| `avatar` | `text` | NULLABLE | 头像 URL (S3) |
| `bio` | `varchar(200)` | NULLABLE | 个人简介 |
| `isOnline` | `boolean` | DEFAULT false | 在线状态 |
| `lastSeenAt` | `timestamp` | NULLABLE | 最后在线时间 |
| `roleId` | `int` | FK -> roles.id | 用户角色 (已有) |
| `statusId` | `int` | FK -> statuses.id | 账号状态 (已有) |
| `createdAt` | `timestamp` | DEFAULT NOW() | |
| `updatedAt` | `timestamp` | DEFAULT NOW() | |

**关系**:
- `OneToMany -> Device[]` (用户的设备)
- `OneToMany -> ConversationMember[]` (参与的会话)
- `ManyToMany -> User[]` via `friends` (好友)
- `ManyToMany -> User[]` via `friend_requests` (好友请求)

### 2.2 Device Entity

**表名**: `devices`

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `uuid` | PK | |
| `userId` | `uuid` | FK -> users.id, NOT NULL | 所属用户 |
| `name` | `varchar(100)` | NOT NULL | 设备显示名 (e.g. "My MacBook") |
| `platform` | `enum` | NOT NULL | windows / macos / linux |
| `isOnline` | `boolean` | DEFAULT false | |
| `lastSeenAt` | `timestamp` | NULLABLE | |
| `socketId` | `varchar(100)` | NULLABLE | 当前 Socket.IO 连接 ID |
| `capabilities` | `jsonb` | DEFAULT '[]' | 设备能力列表 |
| `createdAt` | `timestamp` | DEFAULT NOW() | |
| `updatedAt` | `timestamp` | DEFAULT NOW() | |

**索引**: `(userId)`, `(userId, isOnline)`

### 2.3 Friend System (Join Tables)

**表名**: `friends` (双向好友关系)

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `userId` | `uuid` | PK (composite), FK -> users.id | |
| `friendId` | `uuid` | PK (composite), FK -> users.id | |
| `createdAt` | `timestamp` | DEFAULT NOW() | 成为好友时间 |

> 添加好友时双向写入：A->B 和 B->A

**表名**: `friend_requests` (单向请求)

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `uuid` | PK | |
| `senderId` | `uuid` | FK -> users.id, NOT NULL | 发送者 |
| `receiverId` | `uuid` | FK -> users.id, NOT NULL | 接收者 |
| `status` | `enum` | DEFAULT 'pending' | pending / accepted / rejected |
| `createdAt` | `timestamp` | DEFAULT NOW() | |

**索引**: `UNIQUE (senderId, receiverId)`

### 2.4 Conversation Entity

**表名**: `conversations`
**设计**: 参考 Valkyrie 统一 Channel 模型（DM 和群聊用同一张表）

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `uuid` | PK | |
| `type` | `enum` | NOT NULL | `dm` / `group` |
| `name` | `varchar(100)` | NULLABLE | 群名称 (DM 时为 null) |
| `avatar` | `text` | NULLABLE | 群头像 (DM 时为 null) |
| `ownerId` | `uuid` | FK -> users.id, NULLABLE | 群主 (DM 时为 null) |
| `lastActivityAt` | `timestamp` | DEFAULT NOW() | 最后活动时间 (用于排序) |
| `createdAt` | `timestamp` | DEFAULT NOW() | |
| `updatedAt` | `timestamp` | DEFAULT NOW() | |

**索引**: `(lastActivityAt DESC)`

### 2.5 ConversationMember Entity

**表名**: `conversation_members`

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `uuid` | PK | |
| `userId` | `uuid` | FK -> users.id, NOT NULL | |
| `conversationId` | `uuid` | FK -> conversations.id, NOT NULL, CASCADE | |
| `role` | `enum` | DEFAULT 'member' | owner / admin / member |
| `nickname` | `varchar(50)` | NULLABLE | 群内昵称 |
| `lastReadAt` | `timestamp` | NULLABLE | 最后已读时间 (用于未读计数 + 已读回执) |
| `isOpen` | `boolean` | DEFAULT true | DM 可见性 (关闭后不显示在列表) |
| `isMuted` | `boolean` | DEFAULT false | 是否免打扰 |
| `joinedAt` | `timestamp` | DEFAULT NOW() | |

**索引**: `UNIQUE (userId, conversationId)`, `(userId, isOpen)`

### 2.6 Message Entity

**表名**: `messages`

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `uuid` | PK | |
| `conversationId` | `uuid` | FK -> conversations.id, NOT NULL, CASCADE | |
| `senderId` | `uuid` | FK -> users.id, NOT NULL | |
| `type` | `enum` | NOT NULL | text / image / file / voice / system |
| `content` | `text` | NULLABLE | 文字内容 (或系统消息文案) |
| `replyToId` | `uuid` | FK -> messages.id, NULLABLE | 回复的消息 |
| `isRecalled` | `boolean` | DEFAULT false | 是否已撤回 |
| `createdAt` | `timestamp` | DEFAULT NOW() | |
| `updatedAt` | `timestamp` | DEFAULT NOW() | |

**索引**: `(conversationId, createdAt DESC)` — 分页查询核心索引

**分页策略**: 游标分页 (cursor-based)，使用 `createdAt` 作为游标，每页 35 条，DESC 排序。参考 Valkyrie 的实现。

### 2.7 Attachment Entity

**表名**: `attachments`

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `uuid` | PK | |
| `messageId` | `uuid` | FK -> messages.id, NOT NULL, CASCADE | |
| `url` | `text` | NOT NULL | S3 文件 URL |
| `mimeType` | `varchar(100)` | NOT NULL | MIME 类型 |
| `fileName` | `varchar(255)` | NULLABLE | 原始文件名 |
| `fileSize` | `bigint` | NULLABLE | 文件大小 (bytes) |
| `duration` | `int` | NULLABLE | 语音消息时长 (秒) |
| `width` | `int` | NULLABLE | 图片宽度 |
| `height` | `int` | NULLABLE | 图片高度 |
| `createdAt` | `timestamp` | DEFAULT NOW() | |

### 2.8 CommandLog Entity

**表名**: `command_logs`

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `uuid` | PK | |
| `userId` | `uuid` | FK -> users.id, NOT NULL | 发送命令的用户 |
| `deviceId` | `uuid` | FK -> devices.id, NOT NULL | 目标设备 |
| `type` | `enum` | NOT NULL | shell / file / app / automation |
| `action` | `text` | NOT NULL | 具体命令内容 |
| `args` | `jsonb` | NULLABLE | 命令参数 |
| `dangerLevel` | `enum` | NOT NULL | safe / warning / dangerous |
| `status` | `enum` | DEFAULT 'pending' | pending / dispatched / executing / success / error / cancelled |
| `result` | `jsonb` | NULLABLE | 执行结果 |
| `errorMessage` | `text` | NULLABLE | 错误信息 |
| `executionTimeMs` | `int` | NULLABLE | 执行耗时 (ms) |
| `createdAt` | `timestamp` | DEFAULT NOW() | |
| `completedAt` | `timestamp` | NULLABLE | 完成时间 |

**索引**: `(userId, createdAt DESC)`, `(deviceId, status)`

### 2.9 AiSuggestion Entity（Sprint 2+）

**表名**: `ai_suggestions`

> AI 建议记录，覆盖 Whisper 耳语建议和 Predictive Actions 预测动作。
> Q5 确认 MVP 三个 AI 模式全做，但此表在 Sprint 2+ 实现。

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `uuid` | PK | |
| `conversationId` | `uuid` | FK -> conversations.id, NOT NULL | 关联会话 |
| `triggerMessageId` | `uuid` | FK -> messages.id, NULLABLE | 触发建议的消息 (Whisper) |
| `userId` | `uuid` | FK -> users.id, NOT NULL | 目标用户 |
| `type` | `enum` | NOT NULL | `whisper` / `predictive` |
| `suggestions` | `jsonb` | NOT NULL | 建议内容数组（最多 3 条） |
| `selectedIndex` | `int` | NULLABLE | 用户选择了第几条 (null=未选择) |
| `dismissed` | `boolean` | DEFAULT false | 用户是否忽略 |
| `latencyMs` | `int` | NULLABLE | AI 生成耗时 (ms) |
| `provider` | `varchar(50)` | NOT NULL | 使用的 LLM 供应商 (deepseek / kimi) |
| `model` | `varchar(100)` | NULLABLE | 模型名称 |
| `createdAt` | `timestamp` | DEFAULT NOW() | |

**索引**: `(conversationId, createdAt DESC)`, `(userId, type, createdAt DESC)`

**建议内容格式 (suggestions jsonb)**:
```json
// Whisper 类型
[
  { "text": "好的，我马上处理", "confidence": 0.92 },
  { "text": "收到，稍后回复你", "confidence": 0.85 },
  { "text": "明白了", "confidence": 0.78 }
]

// Predictive 类型
[
  {
    "type": "shell",
    "action": "npm install missing-package",
    "description": "安装缺失的依赖",
    "dangerLevel": "safe",
    "confidence": 0.88
  }
]
```

### 2.10 DraftState Entity（Sprint 2+）

**表名**: `draft_states`

> Draft & Verify 状态机，追踪 AI 生成草稿的审批流程。

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `uuid` | PK | |
| `userId` | `uuid` | FK -> users.id, NOT NULL | 发起者 |
| `conversationId` | `uuid` | FK -> conversations.id, NULLABLE | 关联会话 (聊天草稿) |
| `deviceId` | `uuid` | FK -> devices.id, NULLABLE | 关联设备 (命令草稿) |
| `type` | `enum` | NOT NULL | `message` / `command` |
| `originalIntent` | `text` | NOT NULL | 用户原始意图 |
| `draftContent` | `text` | NOT NULL | AI 生成的草稿内容 |
| `status` | `enum` | DEFAULT 'pending' | `pending` / `approved` / `rejected` / `expired` |
| `provider` | `varchar(50)` | NOT NULL | 使用的 LLM |
| `latencyMs` | `int` | NULLABLE | AI 生成耗时 (ms) |
| `createdAt` | `timestamp` | DEFAULT NOW() | |
| `resolvedAt` | `timestamp` | NULLABLE | 审批/拒绝/过期时间 |
| `expiresAt` | `timestamp` | NOT NULL | 过期时间 (默认创建后 5 分钟) |

**索引**: `(userId, status)`, `(userId, createdAt DESC)`

---

## 三、关键设计决策

### 3.1 ID 策略

使用 PostgreSQL 原生 UUID (`uuid_generate_v4()`)，而非 Valkyrie 的 nanoid snowflake。理由：
- brocoders 脚手架已使用 UUID
- PostgreSQL 对 UUID 有原生优化
- 无需额外依赖

### 3.2 统一 Conversation 模型

参考 Valkyrie 的 Channel 设计，DM 和群聊使用同一张 `conversations` 表，通过 `type` 字段区分：
- `type = 'dm'`: 1对1 私聊，`name`/`avatar`/`ownerId` 为 null
- `type = 'group'`: 群聊，有群名/群头像/群主

好处：消息查询、未读计数、会话列表排序等逻辑统一，不需要区分处理。

### 3.3 已读回执实现

使用 `conversation_members.lastReadAt` 时间戳，对比 `messages.createdAt` 来计算未读消息数：

```sql
-- 获取用户的未读消息数
SELECT cm.conversationId, COUNT(m.id) as unreadCount
FROM conversation_members cm
LEFT JOIN messages m ON m.conversationId = cm.conversationId
  AND m.createdAt > cm.lastReadAt
  AND m.senderId != cm.userId
WHERE cm.userId = :userId AND cm.isOpen = true
GROUP BY cm.conversationId;
```

### 3.4 消息撤回

使用 soft delete 模式：`isRecalled = true`。客户端显示"该消息已被撤回"占位，保留消息记录用于审计。

### 3.5 消息搜索

MVP 阶段使用 PostgreSQL 全文搜索：

```sql
-- 在 messages 表上创建 GIN 索引
CREATE INDEX idx_messages_content_search ON messages USING GIN(to_tsvector('simple', content));

-- 搜索
SELECT * FROM messages
WHERE conversationId = :convId
  AND to_tsvector('simple', content) @@ plainto_tsquery('simple', :query)
ORDER BY createdAt DESC
LIMIT 20;
```

> 中文搜索需要安装 `pg_jieba` 或 `zhparser` 扩展。MVP 阶段可以先用 `simple` 配置 + `LIKE` 模糊搜索。

### 3.6 通知/未读追踪

参考 Valkyrie 的 `lastSeen` 模式：
- **会话级**: `conversation_members.lastReadAt` vs `conversations.lastActivityAt` → 计算红点
- **消息发送时**: 更新 `conversations.lastActivityAt`
- **用户阅读时**: 更新 `conversation_members.lastReadAt`，通过 WebSocket 广播 `message:read` 事件

---

## 四、Migration 执行顺序

```
001_create_extensions.ts        -- uuid-ossp extension
002_create_users_table.ts       -- users (扩展已有)
003_create_devices_table.ts     -- devices
004_create_friends_tables.ts    -- friends + friend_requests
005_create_conversations.ts     -- conversations + conversation_members
006_create_messages.ts          -- messages + attachments
007_create_command_logs.ts      -- command_logs
008_create_indexes.ts           -- 复合索引
--- Sprint 2+ ---
009_create_ai_suggestions.ts    -- ai_suggestions (Whisper + Predictive Actions)
010_create_draft_states.ts      -- draft_states (Draft & Verify 状态机)
```
