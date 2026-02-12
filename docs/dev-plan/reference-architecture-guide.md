# LinkingChat 抄作业指南

> 从 Valkyrie v1、nestjs-chat、Tailchat 三个项目中提取的可复用设计模式。
> 按 LinkingChat 的技术栈（NestJS + Prisma + PostgreSQL + Socket.IO + React + Electron + RN/Flutter）适配。
>
> 日期：2026-02-12
> 数据来源：三个项目的深度代码审计

---

## 目录

1. [数据库 Schema 设计](#一数据库-schema-设计)
2. [WebSocket 架构](#二websocket-架构)
3. [认证系统](#三认证系统)
4. [好友系统](#四好友系统)
5. [消息系统](#五消息系统)
6. [群组/频道管理](#六群组频道管理)
7. [在线状态（Presence）](#七在线状态presence)
8. [通知 & 未读计数](#八通知--未读计数)
9. [文件上传](#九文件上传)
10. [插件/扩展系统](#十插件扩展系统)
11. [实时事件清单](#十一实时事件清单)
12. [错误处理模式](#十二错误处理模式)
13. [设计决策备忘](#十三设计决策备忘)

---

## 一、数据库 Schema 设计

> 综合 Valkyrie（PostgreSQL + TypeORM）、nestjs-chat（PostgreSQL + TypeORM + Schema 分离）、Tailchat（MongoDB 嵌入文档）的优点。

### 1.1 设计原则

| 原则 | 来源 | 说明 |
|------|------|------|
| **PostgreSQL Schema 分区** | nestjs-chat | 用 PG schema 隔离领域：`user`、`auth`、`chat`、`group`、`device` |
| **软删除** | nestjs-chat | 所有实体加 `deletedAt`，永不硬删除 |
| **CUID 主键** | Valkyrie（snowflake 思路） | 用 `cuid2` 替代自增 ID，分布式安全、URL 安全 |
| **JSONB 用于灵活字段** | Tailchat（MongoDB 嵌入） | 插件配置、消息 metadata 等用 JSONB，其余用关系表 |
| **独立关联表** | Valkyrie | 好友、成员、频道权限等用显式关联表，不用 M2M 隐式表 |

### 1.2 完整 Prisma Schema

```prisma
// ─── 用户领域 ─────────────────────────────────────

model User {
  id          String     @id @default(cuid())
  email       String     @unique
  username    String     @unique
  password    String     // argon2 hash（学 Valkyrie，比 bcrypt 快）
  displayName String
  avatarUrl   String?
  status      UserStatus @default(OFFLINE)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  deletedAt   DateTime?  // 软删除（学 nestjs-chat）

  // 关系
  sentRequests     FriendRequest[] @relation("SentRequests")
  receivedRequests FriendRequest[] @relation("ReceivedRequests")
  friendsA         Friendship[]    @relation("FriendA")
  friendsB         Friendship[]    @relation("FriendB")
  blocks           UserBlock[]     @relation("Blocker")
  blockedBy        UserBlock[]     @relation("Blocked")
  memberships      GroupMember[]
  messages         Message[]
  devices          Device[]
  dmParticipants   ConverseMember[]

  @@map("users")
}

enum UserStatus {
  ONLINE
  IDLE
  DND
  OFFLINE
}

// ─── 好友系统（学 Valkyrie 双表模式）─────────────

// 好友请求（pending 状态）
model FriendRequest {
  id         String              @id @default(cuid())
  senderId   String
  receiverId String
  status     FriendRequestStatus @default(PENDING)
  createdAt  DateTime            @default(now())

  sender   User @relation("SentRequests", fields: [senderId], references: [id])
  receiver User @relation("ReceivedRequests", fields: [receiverId], references: [id])

  @@unique([senderId, receiverId])
  @@map("friend_requests")
}

enum FriendRequestStatus {
  PENDING
  REJECTED
}

// 确认的好友关系（双向存储，学 Valkyrie）
model Friendship {
  id        String   @id @default(cuid())
  userAId   String
  userBId   String
  createdAt DateTime @default(now())

  userA User @relation("FriendA", fields: [userAId], references: [id])
  userB User @relation("FriendB", fields: [userBId], references: [id])

  @@unique([userAId, userBId])
  @@map("friendships")
}

// 拉黑（学 nestjs-chat，Valkyrie 缺少此功能）
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

// ─── 群组/频道（学 Tailchat 二级结构 + Valkyrie 关系表）────

model Group {
  id          String   @id @default(cuid())
  name        String
  iconUrl     String?
  description String?  @db.VarChar(120)
  inviteCode  String   @unique @default(cuid())
  ownerId     String
  config      Json     @default("{}") // 插件配置（学 Tailchat）
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  channels Channel[]
  members  GroupMember[]
  roles    GroupRole[]
  bans     GroupBan[]

  @@map("groups")
}

model Channel {
  id                  String      @id @default(cuid())
  name                String
  type                ChannelType @default(TEXT)
  parentId            String?     // 分类嵌套（学 Tailchat parentId）
  groupId             String
  converseId          String?     @unique // 关联到 Converse（学 Tailchat）
  sortOrder           Int         @default(0)
  pluginProvider      String?     // 插件面板用（学 Tailchat）
  meta                Json?       // 插件元数据
  lastActivityAt      DateTime    @default(now()) // 学 Valkyrie
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt

  group    Group    @relation(fields: [groupId], references: [id], onDelete: Cascade)
  parent   Channel? @relation("ChannelNesting", fields: [parentId], references: [id])
  children Channel[] @relation("ChannelNesting")

  @@index([groupId])
  @@map("channels")
}

enum ChannelType {
  TEXT     // 文字频道
  SECTION  // 分类/文件夹（学 Tailchat GROUP 类型）
  VOICE    // 语音频道（未来）
  PLUGIN   // 插件面板（学 Tailchat）
}

model GroupMember {
  userId   String
  groupId  String
  nickname String?   // 群内昵称（学 Valkyrie）
  color    String?   // 群内名字颜色
  roles    String[]  @default([]) // 角色 ID 列表（学 Tailchat）
  muteUntil DateTime? // 禁言到期时间（学 Tailchat）
  lastSeenAt DateTime @default(now()) // 用于未读计算（学 Valkyrie）
  joinedAt  DateTime  @default(now())

  user  User  @relation(fields: [userId], references: [id])
  group Group @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@id([userId, groupId])
  @@index([groupId])
  @@map("group_members")
}

model GroupRole {
  id          String   @id @default(cuid())
  groupId     String
  name        String
  permissions String[] @default([]) // 权限字符串列表（学 Tailchat）
  createdAt   DateTime @default(now())

  group Group @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@map("group_roles")
}

model GroupBan {
  userId  String
  groupId String
  reason  String?
  bannedAt DateTime @default(now())

  @@id([userId, groupId])
  @@map("group_bans")
}

// ─── 会话抽象（学 Tailchat Converse 模型）────────

model Converse {
  id        String       @id @default(cuid())
  type      ConverseType
  name      String?      // DM 可为空
  createdAt DateTime     @default(now())

  members  ConverseMember[]
  messages Message[]

  @@map("converses")
}

enum ConverseType {
  DM     // 1v1 私聊
  MULTI  // 多人私聊
  GROUP  // 群组文字频道
}

model ConverseMember {
  converseId        String
  userId            String
  isOpen            Boolean  @default(true) // DM 可见性（学 Valkyrie DMMember.isOpen）
  lastSeenMessageId String?  // 最后已读消息 ID（学 nestjs-chat）
  lastMessageId     String?  // 最后一条消息 ID（反范式优化，学 nestjs-chat）
  createdAt         DateTime @default(now())

  converse Converse @relation(fields: [converseId], references: [id], onDelete: Cascade)
  user     User     @relation(fields: [userId], references: [id])

  @@id([converseId, userId])
  @@index([userId])
  @@map("converse_members")
}

// ─── 消息 ────────────────────────────────────────

model Message {
  id         String      @id @default(cuid())
  content    String?     // 可为空（纯文件消息）
  type       MessageType @default(TEXT)
  converseId String
  authorId   String
  metadata   Json?       // AI 消息扩展字段
  createdAt  DateTime    @default(now())
  updatedAt  DateTime    @updatedAt
  deletedAt  DateTime?   // 软删除 = 撤回（学 nestjs-chat）

  converse    Converse     @relation(fields: [converseId], references: [id], onDelete: Cascade)
  author      User         @relation(fields: [authorId], references: [id])
  attachments Attachment[]

  @@index([converseId, createdAt])
  @@map("messages")
}

enum MessageType {
  TEXT
  IMAGE
  FILE
  VOICE
  SYSTEM
  AI_DRAFT       // Draft & Verify 草稿
  AI_WHISPER     // Whisper 建议
  AI_PREDICTIVE  // Predictive Action 卡片
}

model Attachment {
  id        String @id @default(cuid())
  messageId String
  url       String
  filename  String
  mimeType  String
  size      Int?

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@map("attachments")
}

// ─── 设备管理（OpenClaw 远控）─────────────────────

model Device {
  id         String       @id @default(cuid())
  name       String
  platform   String       // "darwin" | "win32" | "linux"
  status     DeviceStatus @default(OFFLINE)
  lastSeenAt DateTime?
  userId     String
  createdAt  DateTime     @default(now())

  user     User      @relation(fields: [userId], references: [id])
  commands Command[]

  @@index([userId])
  @@map("devices")
}

enum DeviceStatus {
  ONLINE
  OFFLINE
}

model Command {
  id          String        @id @default(cuid())
  type        String        // "shell" | "file" | "automation"
  payload     Json
  result      Json?
  status      CommandStatus @default(PENDING)
  deviceId    String
  issuerId    String
  createdAt   DateTime      @default(now())
  completedAt DateTime?

  device Device @relation(fields: [deviceId], references: [id])

  @@index([deviceId, createdAt])
  @@map("commands")
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
  id         String      @id @default(cuid())
  content    String
  status     DraftStatus @default(PENDING)
  userId     String
  converseId String
  triggerMessageId String?
  createdAt  DateTime    @default(now())
  resolvedAt DateTime?

  @@index([userId, status])
  @@map("ai_drafts")
}

enum DraftStatus {
  PENDING
  APPROVED
  REJECTED
  EXPIRED
}

model AiSuggestion {
  id        String         @id @default(cuid())
  type      SuggestionType
  content   String
  metadata  Json?
  messageId String
  userId    String
  createdAt DateTime       @default(now())

  @@index([messageId])
  @@index([userId, createdAt])
  @@map("ai_suggestions")
}

enum SuggestionType {
  WHISPER
  PREDICTIVE
}

// ─── 认证（学 nestjs-chat refresh token 模式）────

model RefreshToken {
  id         Int      @id @default(autoincrement())
  userId     String
  tokenHash  String   // bcrypt hash of refresh token
  identifier String   @unique // UUID v4, 对应 JWT jti
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  deletedAt  DateTime? // 软删除 = 吊销

  @@index([userId])
  @@map("refresh_tokens")
}
```

### 1.3 Schema 设计来源标注

| 表 | 主要参考 | 改进点 |
|---|---|---|
| `users` | Valkyrie | 加了 `deletedAt` 软删除、`status` enum |
| `friend_requests` + `friendships` | Valkyrie 双表 | 分离为两个表更清晰（Valkyrie 用 M2M 隐式表） |
| `user_blocks` | nestjs-chat | Valkyrie 缺少此功能 |
| `groups` | Valkyrie Guild | 加了 `config` JSONB（学 Tailchat 插件配置） |
| `channels` | Tailchat GroupPanel | 从 MongoDB 嵌入文档改为关系表，加了 `parentId` 嵌套 |
| `group_members` | Valkyrie Member | 加了 `roles[]`、`muteUntil`（学 Tailchat） |
| `group_roles` | Tailchat GroupRole | 从 MongoDB 嵌入改为独立表 |
| `converses` | Tailchat Converse | 统一 DM/多人/群组频道的消息管道 |
| `converse_members` | Valkyrie DMMember + nestjs-chat | 合并了 `isOpen`（Valkyrie）和 `lastSeenMessageId`（nestjs-chat） |
| `messages` | Valkyrie + nestjs-chat | 加了 `metadata` JSONB 和 AI 消息类型 |
| `attachments` | Valkyrie | 从 1:1 改为 1:N（支持多附件） |
| `refresh_tokens` | nestjs-chat | 直接复用其设计 |
| `devices` + `commands` | 全新设计 | 无参考，为 OpenClaw 远控设计 |
| `ai_drafts` + `ai_suggestions` | 全新设计 | 无参考，为 AI 三模式设计 |

---

## 二、WebSocket 架构

> 主要学 nestjs-chat 的 Redis adapter + 认证模式，辅以 Valkyrie 的 Room 策略和 Tailchat 的事件命名。

### 2.1 核心架构

```
客户端连接
  │
  ├── JWT token 在 handshake.auth.token 中传递
  │
  ▼
NestJS @WebSocketGateway({ namespace: '/chat' })
  │
  ├── handleConnection(): 验证 JWT → 加入所有房间
  │     ├── client.join(`u-${userId}`)          // 个人房间
  │     ├── client.join(converseId)              // 每个会话
  │     └── client.join(`g-${groupId}`)          // 每个群组（群级事件）
  │
  ├── @SubscribeMessage('xxx'): 处理客户端事件
  │     └── 返回值通过 Socket.IO ack 回调给客户端
  │
  └── BroadcastService: 任何 NestJS service 都能发事件
        ├── unicast(userId, event, data)
        ├── listcast(userIds[], event, data)
        └── roomcast(roomId, event, data)

Socket.IO Server
  │
  └── Redis Adapter（@socket.io/redis-adapter）
        ├── Pub: 发事件时发布到 Redis
        └── Sub: 接收其他实例的事件并转发给本地 socket
```

### 2.2 Gateway 实现模式（学 nestjs-chat）

```typescript
// src/modules/chat/chat.gateway.ts

@UseGuards(WsAuthGuard)
@WebSocketGateway({ namespace: '/chat', cors: true })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly broadcastService: BroadcastService,
    private readonly authService: AuthService,
    private readonly chatService: ChatService,
  ) {}

  afterInit(server: Server) {
    // 学 nestjs-chat: 把 server 引用存到 BroadcastService 中
    this.broadcastService.setServer(server);
  }

  async handleConnection(client: Socket) {
    try {
      // 1. 验证 JWT（学 nestjs-chat）
      const token = client.handshake.auth?.token;
      const payload = await this.authService.verifyAccessToken(token);
      client.data.userId = payload.sub;

      // 2. 加入所有房间（学 Valkyrie + Tailchat）
      client.join(`u-${payload.sub}`);

      const rooms = await this.chatService.getUserRoomIds(payload.sub);
      // rooms = { converseIds: [...], groupIds: [...] }
      rooms.converseIds.forEach(id => client.join(id));
      rooms.groupIds.forEach(id => client.join(`g-${id}`));

      // 3. 更新在线状态（用 Redis，不学 Valkyrie 存 DB）
      await this.presenceService.setOnline(payload.sub, client.id);
    } catch (e) {
      client.emit('error:auth', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    if (client.data.userId) {
      await this.presenceService.setOffline(client.data.userId, client.id);
    }
  }

  // 学 nestjs-chat: 所有事件用 ack 回调返回结果
  @SubscribeMessage('message.send')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SendMessageDto,
  ) {
    const result = await this.chatService.sendMessage(client.data.userId, data);
    return result; // Socket.IO ack 自动回传给客户端
  }
}
```

### 2.3 BroadcastService（学 nestjs-chat BroadcastProvider + Tailchat 通知方法）

```typescript
// src/common/broadcast/broadcast.service.ts

@Injectable()
export class BroadcastService {
  private server: Server;

  setServer(server: Server) {
    this.server = server;
  }

  // 学 Tailchat unicastNotify
  unicast(userId: string, event: string, data: unknown) {
    this.server.to(`u-${userId}`).emit(event, data);
  }

  // 学 Tailchat listcastNotify
  listcast(userIds: string[], event: string, data: unknown) {
    const rooms = userIds.map(id => `u-${id}`);
    this.server.to(rooms).emit(event, data);
  }

  // 学 Tailchat roomcastNotify
  roomcast(roomId: string, event: string, data: unknown) {
    this.server.to(roomId).emit(event, data);
  }

  // 学 Valkyrie: 排除发送者
  roomcastExcept(roomId: string, excludeSocketId: string, event: string, data: unknown) {
    this.server.to(roomId).except(excludeSocketId).emit(event, data);
  }
}
```

### 2.4 Redis Adapter 设置（学 nestjs-chat）

```typescript
// src/main.ts

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 学 nestjs-chat: 创建 Redis adapter
  const redisClient = new Redis({ host, port, db: 0 });
  const redisAdapter = createAdapter(redisClient, redisClient.duplicate());
  app.useWebSocketAdapter(new RedisIoAdapter(app, redisAdapter));

  await app.listen(3000);
}
```

---

## 三、认证系统

> 学 nestjs-chat 的 JWT RS256 双密钥对，不学 Valkyrie 的 session cookie（移动端不兼容）。

### 3.1 认证流程

```
注册/登录
  │
  ├── 验证邮箱 + 密码（argon2 hash）
  ├── 生成 Access Token（RS256, 1 天有效）
  ├── 生成 Refresh Token（RS256, 7 天有效, 带 jti）
  ├── 将 Refresh Token hash 存入 refresh_tokens 表
  └── 返回 { accessToken, refreshToken, user }

API 请求
  │
  ├── HTTP: Authorization: Bearer {accessToken}
  │     └── AuthGuard 验证签名 + 过期
  │
  └── WebSocket: handshake.auth.token = "Bearer {accessToken}"
        └── WsAuthGuard 验证签名 + 过期

Token 刷新
  │
  ├── POST /auth/refresh { refreshToken }
  ├── 验证签名 → 查 jti 对应的 hash → bcrypt 比对
  ├── 软删除旧 refresh_token 记录
  ├── 生成新的 access + refresh token 对
  └── 返回新 token 对
```

### 3.2 RS256 密钥对（学 nestjs-chat）

```bash
# 生成 access token 密钥对
openssl genrsa -out keys/access-private.pem 2048
openssl rsa -in keys/access-private.pem -pubout -out keys/access-public.pem

# 生成 refresh token 密钥对
openssl genrsa -out keys/refresh-private.pem 2048
openssl rsa -in keys/refresh-private.pem -pubout -out keys/refresh-public.pem
```

Access 和 Refresh 用**不同的密钥对**：只有 auth service 持有私钥，其他微服务只需公钥即可验证。

### 3.3 JWT Payload 定义

```typescript
// Access Token Payload（学 nestjs-chat）
interface AccessTokenPayload {
  sub: string;  // userId
  role: string; // user role
  iat: number;
  exp: number;
  aud: string;  // 'linkingchat-client'
  iss: string;  // 'linkingchat'
}

// Refresh Token Payload
interface RefreshTokenPayload {
  sub: string;  // userId
  jti: string;  // UUID v4, 对应 refresh_tokens.identifier
  iat: number;
  exp: number;
}
```

---

## 四、好友系统

> 完整学 Valkyrie 的流程，补充 nestjs-chat 的 block 功能。

### 4.1 REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/friends` | 获取好友列表 |
| GET | `/friends/requests` | 获取待处理请求（发出 + 收到，带 type 区分） |
| POST | `/friends/request/:userId` | 发送好友请求 |
| POST | `/friends/accept/:userId` | 接受请求 |
| POST | `/friends/reject/:userId` | 拒绝请求 |
| DELETE | `/friends/:userId` | 删除好友 |
| POST | `/users/block/:userId` | 拉黑（学 nestjs-chat） |
| DELETE | `/users/block/:userId` | 取消拉黑 |

### 4.2 好友请求流程（学 Valkyrie）

```
A 发送请求给 B:
  1. 检查 A ≠ B
  2. 检查不在黑名单中
  3. 检查没有已存在的请求或好友关系
  4. 写入 friend_requests (status=PENDING)
  5. WebSocket: unicast(B, 'friend.request.new', { from: A })

B 接受请求:
  1. 验证 friend_requests 中存在 A→B 且 status=PENDING
  2. 删除 friend_requests 记录
  3. 写入 friendships (A, B)  // 只存一条，A < B 保证唯一性
  4. 自动创建 DM Converse（如果不存在）
  5. WebSocket: unicast(A, 'friend.added', { friend: B })
  6. WebSocket: unicast(B, 'friend.added', { friend: A })

A 删除好友 B:
  1. 删除 friendships 记录
  2. WebSocket: unicast(B, 'friend.removed', { userId: A })
```

### 4.3 获取待处理请求的 SQL（学 Valkyrie）

```sql
-- type=1: 收到的请求, type=0: 发出的请求
SELECT u.id, u.username, u.avatar_url, u.status, 1 as "type"
FROM users u
JOIN friend_requests fr ON u.id = fr.sender_id
WHERE fr.receiver_id = $1 AND fr.status = 'PENDING'
UNION
SELECT u.id, u.username, u.avatar_url, u.status, 0 as "type"
FROM users u
JOIN friend_requests fr ON u.id = fr.receiver_id
WHERE fr.sender_id = $1 AND fr.status = 'PENDING'
ORDER BY username
```

---

## 五、消息系统

> 学 Valkyrie 的消息 CRUD + cursor 分页，学 nestjs-chat 的 ack 模式和 read tracking。

### 5.1 消息发送流程

```
客户端 emit('message.send', { converseId, content, type, files? }, ack)
  │
  ▼
Gateway: 验证 JWT → 调用 ChatService.sendMessage()
  │
  ├── 验证用户是 converse 成员
  ├── 如果有文件 → 上传到 S3 → 创建 Attachment 记录
  ├── 创建 Message 记录
  ├── 更新 Channel.lastActivityAt（如果是群组频道）
  ├── 更新 ConverseMember.lastMessageId（发送者）
  ├── 更新 ConverseMember.lastSeenMessageId（发送者，自己的消息自动已读）
  │
  ├── roomcast(converseId, 'message.new', messageData)  // 广播给频道
  │
  ├── 如果是 DM:
  │     ├── 更新 ConverseMember.isOpen = true（收方）  // 学 Valkyrie
  │     └── unicast(对方, 'dm.notification', { ... })
  │
  ├── 如果是群组频道:
  │     └── roomcast(`g-${groupId}`, 'channel.notification', { channelId })
  │
  └── ack({ success: true, message: messageData })  // 学 nestjs-chat ack 模式
```

### 5.2 Cursor 分页（学 Valkyrie）

```typescript
// 消息列表：按创建时间倒序，每页 35 条
async getMessages(converseId: string, cursor?: string): Promise<Message[]> {
  const query = this.prisma.message.findMany({
    where: {
      converseId,
      deletedAt: null,
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 35,
    include: {
      author: { select: { id: true, username: true, avatarUrl: true, status: true } },
      attachments: true,
    },
  });
  return query;
}
```

客户端加载更多时传入最后一条消息的 `createdAt` 作为 cursor。

### 5.3 已读追踪（学 nestjs-chat，改进 Valkyrie）

```
用户打开一个频道/会话:
  1. 获取消息列表
  2. 更新 ConverseMember.lastSeenMessageId = 最新消息 ID
  3. 广播 'message.seen' 给对话中其他成员
```

这比 Valkyrie 的 `lastSeen` 时间戳更精确——可以知道具体读到哪条消息。

---

## 六、群组/频道管理

> 学 Valkyrie 的 Guild CRUD，学 Tailchat 的二级频道结构和权限模型。

### 6.1 REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/groups` | 创建群组（含默认 general 频道）|
| GET | `/groups` | 获取我的群组列表 |
| PUT | `/groups/:id` | 编辑群组（owner only）|
| DELETE | `/groups/:id` | 删除群组（owner only）|
| POST | `/groups/:id/join` | 通过邀请码加入 |
| POST | `/groups/:id/leave` | 离开群组 |
| POST | `/groups/:id/invite` | 生成邀请链接 |
| POST | `/groups/:id/kick/:userId` | 踢人 |
| POST | `/groups/:id/ban/:userId` | 封禁 |
| GET | `/groups/:id/members` | 成员列表 |
| POST | `/groups/:id/channels` | 创建频道 |
| PUT | `/channels/:id` | 编辑频道 |
| DELETE | `/channels/:id` | 删除频道 |

### 6.2 创建群组（学 Valkyrie 事务模式）

```typescript
async createGroup(userId: string, name: string): Promise<Group> {
  return this.prisma.$transaction(async (tx) => {
    // 1. 创建群组
    const group = await tx.group.create({
      data: { name, ownerId: userId },
    });

    // 2. 创建默认 general 频道 + 对应的 Converse
    const converse = await tx.converse.create({
      data: { type: 'GROUP' },
    });
    await tx.channel.create({
      data: {
        name: 'general',
        type: 'TEXT',
        groupId: group.id,
        converseId: converse.id,
      },
    });

    // 3. 将创建者加为成员
    await tx.groupMember.create({
      data: { userId, groupId: group.id },
    });
    await tx.converseMember.create({
      data: { converseId: converse.id, userId },
    });

    return group;
  });
}
```

### 6.3 邀请系统（学 Valkyrie Redis TTL 模式）

```typescript
// 生成邀请链接
async createInvite(groupId: string, permanent = false): Promise<string> {
  const code = nanoid(8);
  const data = JSON.stringify({ groupId });

  if (permanent) {
    await this.redis.set(`invite:${code}`, data);
  } else {
    await this.redis.set(`invite:${code}`, data, 'EX', 86400); // 24h
  }
  return code;
}

// 使用邀请加入
async joinByInvite(userId: string, code: string): Promise<Group> {
  const data = await this.redis.get(`invite:${code}`);
  if (!data) throw new NotFoundException('Invite expired');

  const { groupId } = JSON.parse(data);
  // 检查: 未被 ban、未超过群组数量限制、不是已有成员
  // ... 加入群组 + 所有频道的 converse
}
```

### 6.4 权限系统（学 Tailchat，改进 Valkyrie 只有 owner 的简陋模型）

```typescript
// 权限定义（学 Tailchat 字符串枚举）
const PERMISSIONS = {
  MESSAGE_SEND:    'message.send',
  MESSAGE_DELETE:  'message.delete',
  INVITE_CREATE:   'invite.create',
  MEMBER_KICK:     'member.kick',
  MEMBER_BAN:      'member.ban',
  CHANNEL_MANAGE:  'channel.manage',
  GROUP_EDIT:      'group.edit',
  ROLE_MANAGE:     'role.manage',
} as const;

// 权限检查（学 Tailchat 级联解析）
function hasPermission(
  userId: string,
  group: Group & { roles: GroupRole[]; members: GroupMember[] },
  permission: string,
  channelPermissionMap?: Record<string, string[]>,
): boolean {
  // 1. Owner 拥有所有权限
  if (group.ownerId === userId) return true;

  // 2. 收集用户角色的权限
  const member = group.members.find(m => m.userId === userId);
  const rolePerms = member.roles
    .flatMap(roleId => group.roles.find(r => r.id === roleId)?.permissions ?? []);

  // 3. 频道级覆盖（如果有）
  if (channelPermissionMap?.[member.userId]?.includes(permission)) return true;

  // 4. 角色权限 + 默认权限
  return rolePerms.includes(permission) || group.fallbackPermissions.includes(permission);
}
```

---

## 七、在线状态（Presence）

> 不学 Valkyrie 存 DB 的方案（服务器崩溃 = 永远在线），改用 Redis + TTL。

### 7.1 Redis Presence 方案（学 Tailchat 改进）

```typescript
@Injectable()
export class PresenceService {
  constructor(private readonly redis: Redis) {}

  // 上线：HSET + 24h TTL（学 Tailchat）
  async setOnline(userId: string, socketId: string) {
    const key = `presence:${userId}`;
    await this.redis.hset(key, socketId, Date.now().toString());
    await this.redis.expire(key, 86400);
  }

  // 下线：HDEL + 检查是否还有其他连接
  async setOffline(userId: string, socketId: string): Promise<boolean> {
    const key = `presence:${userId}`;
    await this.redis.hdel(key, socketId);
    const remaining = await this.redis.hlen(key);
    if (remaining === 0) {
      await this.redis.del(key);
      return true; // 完全离线
    }
    return false; // 其他设备还在线
  }

  // 检查是否在线
  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.exists(`presence:${userId}`)) === 1;
  }

  // 批量检查
  async getOnlineStatuses(userIds: string[]): Promise<Record<string, boolean>> {
    const pipeline = this.redis.pipeline();
    userIds.forEach(id => pipeline.exists(`presence:${id}`));
    const results = await pipeline.exec();
    return Object.fromEntries(userIds.map((id, i) => [id, results[i][1] === 1]));
  }
}
```

### 7.2 上下线广播（学 Valkyrie）

```typescript
// 用户上线后，通知 TA 所有群组 + 好友
async broadcastPresence(userId: string, online: boolean) {
  const event = online ? 'presence.online' : 'presence.offline';

  // 获取所有相关群组和好友
  const groupIds = await this.getGroupIds(userId);
  const friendIds = await this.getFriendIds(userId);

  // 通知群组成员
  groupIds.forEach(gid => this.broadcastService.roomcast(`g-${gid}`, event, { userId }));

  // 通知好友
  this.broadcastService.listcast(friendIds, event, { userId });
}
```

---

## 八、通知 & 未读计数

> 学 Valkyrie 的 lastSeen vs lastActivity 模式 + nestjs-chat 的 lastSeenMessageId。

### 8.1 未读判断逻辑

```
频道级未读：
  channel.lastActivityAt > groupMember.lastSeenAt  →  hasUnread = true

消息级已读位置：
  converseMember.lastSeenMessageId  →  这条及之前的消息已读

群组级未读（学 Valkyrie）：
  ANY(channel.lastActivityAt) > groupMember.lastSeenAt  →  群组图标显示小红点
```

### 8.2 更新时机

| 事件 | 更新什么 |
|------|---------|
| 新消息发送 | `channel.lastActivityAt = NOW()` |
| 用户离开群组房间 | `groupMember.lastSeenAt = NOW()`（学 Valkyrie `leaveGuild` 事件） |
| 用户打开频道/获取消息 | `converseMember.lastSeenMessageId = 最新消息ID` |
| DM 新消息 | `converseMember.isOpen = true`（收方，学 Valkyrie） |
| 用户关闭 DM | `converseMember.isOpen = false` |

---

## 九、文件上传

> 学 Valkyrie 的 S3 + sharp 处理。

### 9.1 上传架构

```
客户端 → POST /upload (multipart/form-data) → NestJS FileInterceptor
  │
  ├── 头像：sharp 缩放 150x150 → 转 WebP → S3
  ├── 消息附件：原样上传 → S3
  └── 语音消息：原样上传 → S3

S3 路径约定（学 Valkyrie）：
  avatars/{userId}/{cuid}.webp
  groups/{groupId}/{cuid}.webp
  messages/{converseId}/{timestamp}-{filename}
```

### 9.2 Controller 模式（学 Valkyrie）

```typescript
@Post('/:converseId/messages')
@UseInterceptors(FileInterceptor('file'))
async sendMessage(
  @GetUser() userId: string,
  @Param('converseId') converseId: string,
  @Body() input: SendMessageDto,
  @UploadedFile() file?: Express.Multer.File,
) {
  // 至少需要 content 或 file 其中一个
  if (!input.content && !file) throw new BadRequestException();
  return this.chatService.sendMessage(userId, converseId, input, file);
}
```

---

## 十、插件/扩展系统

> 学 Tailchat 的前后端插件思路，适配到 NestJS 模块系统。

### 10.1 后端插件（NestJS Dynamic Module 模式）

不需要 Moleculer 的 TcService，NestJS 的模块系统天然支持插件化：

```typescript
// 插件接口定义
interface LinkingChatPlugin {
  name: string; // 'com.linkingchat.ai-whisper'
  module: Type<any>; // NestJS module class
}

// 插件注册
@Module({})
export class PluginModule {
  static register(plugins: LinkingChatPlugin[]): DynamicModule {
    return {
      module: PluginModule,
      imports: plugins.map(p => p.module),
    };
  }
}

// app.module.ts
@Module({
  imports: [
    PluginModule.register([
      { name: 'com.linkingchat.ai-whisper', module: AiWhisperModule },
      { name: 'com.linkingchat.ai-draft', module: AiDraftModule },
      { name: 'com.linkingchat.ai-predict', module: AiPredictModule },
    ]),
  ],
})
export class AppModule {}
```

### 10.2 前端扩展点（学 Tailchat buildRegList 模式）

```typescript
// packages/shared/src/plugin-registry.ts
// 纯 TypeScript，不依赖任何框架

export function buildRegList<T>(): [T[], (item: T) => void] {
  const list: T[] = [];
  const reg = (item: T) => { list.push(item); };
  return [list, reg];
}

// 定义扩展点
export const [chatInputButtons, regChatInputButton] = buildRegList<ChatInputButtonDef>();
export const [panelTypes, regPanelType] = buildRegList<PanelTypeDef>();
export const [messageRenderers, regMessageRenderer] = buildRegList<MessageRendererDef>();
export const [settingPages, regSettingPage] = buildRegList<SettingPageDef>();
```

AI 功能以插件形式注册到这些扩展点，核心 UI 不需要知道具体的 AI 实现。

### 10.3 After-Action Hook（学 Tailchat，用 NestJS EventEmitter）

```typescript
// 核心服务发出事件
@Injectable()
export class GroupService {
  constructor(private eventEmitter: EventEmitter2) {}

  async joinGroup(userId: string, groupId: string) {
    // ... 加入逻辑 ...
    this.eventEmitter.emit('group.joined', { userId, groupId });
  }
}

// 插件监听事件（学 Tailchat registerAfterActionHook）
@Injectable()
export class WelcomePlugin {
  @OnEvent('group.joined')
  async onGroupJoined({ userId, groupId }) {
    const config = await this.getGroupConfig(groupId);
    if (config.welcomeText) {
      await this.chatService.sendSystemMessage(groupId, config.welcomeText);
    }
  }
}
```

---

## 十一、实时事件清单

> 综合三个项目的事件设计。命名规则学 Tailchat：`{domain}.{entity}.{action}`。

### 11.1 客户端 → 服务端

| 事件名 | 数据 | 说明 |
|--------|------|------|
| `message.send` | `{ converseId, content, type }` | 发送消息 |
| `message.edit` | `{ messageId, content }` | 编辑消息 |
| `message.delete` | `{ messageId }` | 删除/撤回消息 |
| `typing.start` | `{ converseId }` | 开始打字 |
| `typing.stop` | `{ converseId }` | 停止打字 |
| `channel.join` | `{ channelId }` | 加入频道房间 |
| `channel.leave` | `{ channelId }` | 离开频道房间 |
| `guild.leave` | `{ groupId }` | 离开群组房间（更新 lastSeenAt） |
| `presence.heartbeat` | `{}` | 心跳保活 |
| `converse.list` | `{ cursor? }` | 获取会话列表 |
| `message.list` | `{ converseId, cursor? }` | 获取消息列表 |
| `device.command` | `{ deviceId, type, payload }` | 发送远程命令 |
| `ai.draft.respond` | `{ draftId, action }` | 确认/拒绝 AI 草稿 |

### 11.2 服务端 → 客户端

| 事件名 | 目标 | 说明 |
|--------|------|------|
| `message.new` | Room(converseId) | 新消息 |
| `message.updated` | Room(converseId) | 消息编辑 |
| `message.deleted` | Room(converseId) | 消息撤回 |
| `message.seen` | User(senderId) | 消息已读（学 nestjs-chat） |
| `typing.update` | Room(converseId) | 打字状态 |
| `channel.created` | Room(g-groupId) | 新频道 |
| `channel.updated` | Room(g-groupId) | 频道编辑 |
| `channel.deleted` | Room(g-groupId) | 频道删除 |
| `group.updated` | User(each member) | 群组信息变更 |
| `group.deleted` | User(each member) | 群组解散 |
| `member.joined` | Room(g-groupId) | 新成员加入 |
| `member.left` | Room(g-groupId) | 成员离开 |
| `member.kicked` | User(kickedUserId) | 被踢 |
| `friend.request.new` | User(receiverId) | 新好友请求 |
| `friend.added` | User(both) | 好友添加成功 |
| `friend.removed` | User(removedId) | 好友删除 |
| `presence.online` | Room(g-*) + User(friends) | 上线 |
| `presence.offline` | Room(g-*) + User(friends) | 下线 |
| `dm.notification` | User(recipientId) | DM 新消息通知 |
| `channel.notification` | Room(g-groupId) | 频道新消息通知 |
| `device.result` | User(issuerId) | 远程命令结果 |
| `device.status` | User(ownerId) | 设备上下线 |
| `ai.whisper` | User(targetId) | Whisper 建议（<800ms） |
| `ai.draft.new` | User(targetId) | 新的 Draft & Verify 草稿 |
| `ai.predict.new` | User(targetId) | 新的 Predictive Action 卡片 |
| `error.auth` | Client(socket) | 认证失败 |

---

## 十二、错误处理模式

> 学 nestjs-chat 的 Result monad，不用 throw exception 控制流。

### 12.1 Result 类型

```typescript
// packages/shared/src/result.ts

export class Result<T> {
  private constructor(
    private readonly _value: T | null,
    private readonly _error: AppError | null,
  ) {}

  static ok<T>(value: T): Result<T> {
    return new Result(value, null);
  }

  static error<T = never>(message: string, code?: ErrorCode): Result<T> {
    return new Result(null, new AppError(message, code));
  }

  isOk(): boolean { return this._error === null; }
  isError(): boolean { return this._error !== null; }
  get value(): T { /* throw if error */ }
  get error(): AppError { /* throw if ok */ }
}
```

### 12.2 统一响应格式

```typescript
// HTTP 和 WebSocket ack 都用同一个格式
interface StdResponse<T> {
  success: boolean;
  data: T | null;
  message: string;
  code?: ErrorCode;
}
```

---

## 十三、设计决策备忘

### 13.1 从各项目学到的最佳实践

| 实践 | 来源 | 说明 |
|------|------|------|
| 全局 SocketModule + BroadcastService | Valkyrie | 任何 service 都能发实时事件 |
| Redis adapter 水平扩展 | nestjs-chat + Tailchat | 多实例部署必需 |
| Ack 回调而非回复事件 | nestjs-chat | 简化客户端逻辑 |
| JWT RS256 双密钥对 | nestjs-chat | Access/Refresh 分离，安全性高 |
| DMMember.isOpen | Valkyrie | 关闭私聊不删数据，只隐藏 |
| lastSeen + lastActivity | Valkyrie | 简单的未读判断 |
| Converse 统一抽象 | Tailchat | DM/多人/群组频道共用消息管道 |
| 频道 parentId 嵌套 | Tailchat | Discord 风格的分类结构 |
| buildRegList 扩展点 | Tailchat | 零依赖的前端插件注册模式 |
| After-action hooks | Tailchat | 插件不侵入核心代码 |
| Bot as User | Tailchat | 机器人用同一套认证/消息管道 |
| 权限字符串 + 级联解析 | Tailchat | 比 Valkyrie 只有 owner 的模型灵活得多 |

### 13.2 从各项目学到的反面教训（不要抄）

| 反面教训 | 来源 | 为什么不要学 |
|---------|------|------------|
| Session cookie 认证 | Valkyrie | 移动端不兼容 |
| 在线状态存 PostgreSQL | Valkyrie | 服务器崩溃 = 永远在线 |
| 原始 SQL 散落各处 | Valkyrie | 用 Prisma 的类型安全查询替代 |
| 重复的 isChannelMember 检查 | Valkyrie | 抽成 Guard 或公共 service 方法 |
| 1:1 附件模型 | Valkyrie | 改为 1:N 支持多附件 |
| 无 block 功能 | Valkyrie | 从 nestjs-chat 补上 |
| 无测试 | Valkyrie + Tailchat | 从第一天就写测试 |
| Moleculer 框架 | Tailchat | 太小众，用 NestJS 替代 |
| MongoDB 嵌入文档 | Tailchat | 群组数据改为关系表 |
| MiniStar 运行时加载 | Tailchat | 太重，用编译时插件 + buildRegList 替代 |

### 13.3 为 AI 功能预留的架构扩展点

| 功能 | 架构适配 |
|------|---------|
| Draft & Verify | `MessageType.AI_DRAFT` + `ai_drafts` 表 + `ai.draft.new` / `ai.draft.respond` 事件 |
| Whisper | `ai_suggestions` 表 + `ai.whisper` 事件 + BullMQ 异步任务（LLM 调用） |
| Predictive Actions | `ai_suggestions` 表 + `ai.predict.new` 事件 + 命令安全分级 |
| OpenClaw 远控 | `devices` + `commands` 表 + `device.command` / `device.result` 事件 |
| Bot 集成 | 学 Tailchat：Bot 是特殊 User，用同一套认证和消息管道 |
