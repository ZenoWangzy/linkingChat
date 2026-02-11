# WebSocket 协议设计

> 基于 NestJS + Socket.IO，双命名空间（/chat + /device），JWT 认证，Redis 适配器

---

## 一、协议概览

```
┌─────────────┐       WSS /chat        ┌───────────────────┐       WSS /chat        ┌─────────────┐
│ Flutter App  │ ◄─────────────────────► │  Cloud Brain      │ ◄─────────────────────► │ Electron    │
│ (Mobile)     │                         │  (NestJS)         │                         │ (Desktop)   │
│              │       WSS /device       │                   │       WSS /device       │             │
│              │ ◄─────────────────────► │                   │ ◄─────────────────────► │             │
└─────────────┘                         └───────────────────┘                         └─────────────┘
                                               │
                                          Redis Pub/Sub
                                         (Socket.IO Adapter)
```

### 设计原则

1. **REST-First Mutations**: 所有数据变更走 REST API，WebSocket 仅用于广播事件
2. **双命名空间**: `/chat` 和 `/device` 隔离，各自独立连接和认证
3. **标准 Envelope**: 所有 payload 使用统一信封格式
4. **Acknowledgement**: 需要确认的操作使用 Socket.IO callback
5. **命名规范**: `resource:action` 格式

---

## 二、连接与认证

### 2.1 连接方式

```typescript
// 客户端连接示例
const chatSocket = io('wss://api.linkingchat.com/chat', {
  auth: {
    token: jwtAccessToken,
    deviceType: 'mobile',       // 'mobile' | 'desktop' | 'web'
  },
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
});

const deviceSocket = io('wss://api.linkingchat.com/device', {
  auth: {
    token: jwtAccessToken,
    deviceId: 'device-uuid',
    deviceType: 'desktop',
  },
  transports: ['websocket'],
});
```

### 2.2 JWT 认证中间件

服务端在 `afterInit` 中注册 Socket.IO 中间件：

```typescript
// 认证流程
1. 客户端连接时在 handshake.auth.token 中携带 JWT
2. 中间件验证 token 有效性（签名 + 过期时间）
3. 从 token payload 提取 userId，查询用户信息
4. 将用户信息挂载到 socket.data.user
5. 验证失败则 next(new Error('...'))，Socket.IO 自动断开连接
```

### 2.3 连接后自动加入房间

```typescript
// handleConnection 中自动加入的房间
handleConnection(client: Socket) {
  const userId = client.data.userId;
  const deviceId = client.handshake.auth?.deviceId;

  // 个人房间：收取好友请求、通知等
  client.join(`user:${userId}`);

  // 设备房间（仅 /device 命名空间）
  if (deviceId) {
    client.join(`device:${deviceId}`);
  }
}
```

---

## 三、房间策略

| 房间类型 | 命名格式 | 命名空间 | 用途 |
|---------|---------|---------|------|
| 用户房间 | `user:{userId}` | /chat + /device | 个人事件：好友请求、设备状态、通知 |
| 会话房间 | `conversation:{convId}` | /chat | 消息事件：新消息、撤回、已读、输入中 |
| 设备房间 | `device:{deviceId}` | /device | 设备命令：command.execute 发送到特定设备 |

### 房间生命周期

```
用户连接 → 自动加入 user:{userId}
用户打开会话 → 客户端发送 conversation:join → 加入 conversation:{convId}
用户离开会话 → 客户端发送 conversation:leave → 离开 conversation:{convId}
用户断开连接 → Socket.IO 自动从所有房间移除
```

---

## 四、标准 Payload 格式

### 4.1 请求信封

```typescript
interface WsEnvelope<T> {
  requestId: string;       // UUID, 用于关联请求和响应
  timestamp: string;       // ISO 8601
  data: T;                 // 业务数据
}
```

### 4.2 响应信封

```typescript
interface WsResponse<T> {
  requestId?: string;      // 关联的请求 ID
  success: boolean;
  data?: T;                // 成功时的数据
  error?: WsError;         // 失败时的错误
  timestamp: string;
}

interface WsError {
  code: string;            // 机器可读: AUTH_EXPIRED, DEVICE_OFFLINE, COMMAND_TIMEOUT
  message: string;         // 人类可读
}
```

---

## 五、/chat 命名空间 — 事件清单

### 5.1 客户端 → 服务端

| 事件名 | Payload | ACK | 说明 |
|--------|---------|-----|------|
| `conversation:join` | `{ conversationId: string }` | - | 加入会话房间 |
| `conversation:leave` | `{ conversationId: string }` | - | 离开会话房间 |
| `message:typing` | `{ conversationId: string, isTyping: boolean }` | - | 输入状态变化 |
| `message:read` | `{ conversationId: string, lastReadMessageId: string }` | - | 标记已读 |
| `presence:update` | `{ isOnline: boolean }` | - | 在线状态变更 |

> **注意**: `message:send`, `message:recall` 等变更操作通过 REST API 完成。REST handler 内部调用 SocketService 推送事件。

### 5.2 服务端 → 客户端

| 事件名 | Payload | Target | 触发条件 |
|--------|---------|--------|---------|
| `message:new` | `MessageResponse` | `conversation:{convId}` | REST: POST /messages |
| `message:updated` | `MessageResponse` | `conversation:{convId}` | REST: PATCH /messages/:id |
| `message:recalled` | `{ messageId, conversationId }` | `conversation:{convId}` | REST: POST /messages/:id/recall |
| `message:typing` | `{ conversationId, userId, username, isTyping }` | `conversation:{convId}` | WS: message:typing |
| `message:read` | `{ conversationId, userId, lastReadAt }` | `conversation:{convId}` | WS: message:read |
| `conversation:new` | `ConversationResponse` | `user:{userId}` (each member) | REST: POST /conversations |
| `conversation:updated` | `ConversationResponse` | `user:{userId}` (each member) | REST: PATCH /conversations/:id |
| `friend:request` | `{ requestId, senderId, senderName, senderAvatar }` | `user:{receiverId}` | REST: POST /friends/request |
| `friend:accepted` | `{ userId, username, avatar }` | `user:{userId}` (both) | REST: POST /friends/accept |
| `friend:removed` | `{ userId }` | `user:{userId}` (both) | REST: DELETE /friends/:id |
| `presence:changed` | `{ userId, isOnline, lastSeenAt }` | 好友+共同会话成员 | WS: presence:update / disconnect |
| `notification:new` | `{ type, conversationId, messagePreview }` | `user:{userId}` | 新消息通知 (不在会话房间的成员) |

### 5.3 AI 事件（Sprint 2+，Q5 确认三个模式全做）

> 以下事件在 `/chat` 命名空间内，用于三个 AI 交互模式。
> 设计灵感来自 Tinode 的 FireHose 拦截器模式（CONTINUE/DROP/RESPOND/REPLACE）。

#### Client → Server

| 事件名 | Payload | ACK | 说明 |
|--------|---------|-----|------|
| `ai:draft:approve` | `{ draftId: string }` | `{ success, executedResult? }` | 批准 AI 草稿并执行 |
| `ai:draft:reject` | `{ draftId: string, reason?: string }` | - | 拒绝 AI 草稿 |
| `ai:draft:edit` | `{ draftId: string, editedContent: string }` | `{ success }` | 编辑后批准 |
| `ai:predictive:execute` | `{ suggestionId: string, actionIndex: number }` | `{ commandId }` | 执行预测动作 |
| `ai:predictive:dismiss` | `{ suggestionId: string }` | - | 忽略预测动作 |
| `ai:whisper:select` | `{ suggestionId: string, selectedIndex: number }` | - | 选择耳语建议 |

#### Server → Client

| 事件名 | Payload | Target | 触发条件 |
|--------|---------|--------|---------|
| `ai:whisper:suggestions` | `WhisperPayload` | `user:{userId}` | 收到新消息后 <800ms 推送 |
| `ai:draft:created` | `DraftPayload` | `user:{userId}` | 用户发送意图后 AI 生成草稿 |
| `ai:draft:expired` | `{ draftId: string }` | `user:{userId}` | 草稿超时未审批（5 分钟） |
| `ai:predictive:action` | `PredictivePayload` | `user:{userId}` | AI 分析上下文后推送动作卡片 |

#### Payload 类型定义

```typescript
// Whisper 耳语建议
interface WhisperPayload {
  suggestionId: string;
  conversationId: string;
  triggerMessageId: string;          // 触发建议的消息
  suggestions: Array<{
    text: string;
    confidence: number;              // 0-1
  }>;
  latencyMs: number;                 // AI 生成耗时，>1000ms 客户端应忽略
  provider: string;
}

// Draft & Verify 草稿
interface DraftPayload {
  draftId: string;
  conversationId?: string;           // 聊天草稿
  deviceId?: string;                 // 命令草稿
  type: 'message' | 'command';
  originalIntent: string;            // 用户原始输入
  draftContent: string;              // AI 生成的草稿
  expiresAt: string;                 // ISO 8601，默认 5 分钟后
}

// Predictive Actions 预测动作
interface PredictivePayload {
  suggestionId: string;
  conversationId: string;
  actions: Array<{
    type: 'shell' | 'file' | 'app';
    action: string;                  // 具体命令
    description: string;             // 人类可读描述
    dangerLevel: 'safe' | 'warning' | 'dangerous';
    confidence: number;
  }>;
}
```

#### Whisper 建议流程

```
User B 发消息给 User A
       │
Cloud Brain 收到 message:new 事件
       │
       ├── 并行：正常广播 message:new 给 conversation room
       │
       └── 异步：调用 LLM (DeepSeek，低延迟模型)
             │
             ├── <800ms → WS: ai:whisper:suggestions → User A
             │            客户端展示建议气泡
             │
             └── >1000ms → 放弃，不推送
                            客户端不展示
```

### 5.4 事件流程示例（原有）

**发送消息**:
```
Mobile                    Cloud Brain                 Desktop
  │                           │                          │
  ├── POST /api/v1/messages ─>│                          │
  │   { conversationId,       │                          │
  │     type: "text",         │                          │
  │     content: "Hello" }    │                          │
  │                           ├── DB: INSERT message     │
  │                           ├── DB: UPDATE conversation │
  │                           │     .lastActivityAt      │
  │<── 201 { message } ──────│                          │
  │                           │                          │
  │                           ├── WS: message:new ──────>│ (conversation room)
  │<── WS: message:new ──────│                          │ (conversation room)
  │                           │                          │
  │                           ├── WS: notification:new ─>│ (不在 room 的成员)
  │                           │      (via user:{userId})  │
```

**已读回执**:
```
Desktop                   Cloud Brain                 Mobile
  │                           │                          │
  ├── WS: message:read ──────>│                          │
  │   { conversationId,       │                          │
  │     lastReadMessageId }   ├── DB: UPDATE             │
  │                           │   conversation_members   │
  │                           │   .lastReadAt            │
  │                           │                          │
  │                           ├── WS: message:read ─────>│ (conversation room)
  │<── WS: message:read ─────│                          │ (conversation room)
```

---

## 六、/device 命名空间 — 事件清单

### 6.1 客户端 → 服务端

| 事件名 | 发送方 | Payload | ACK | 说明 |
|--------|--------|---------|-----|------|
| `device:register` | Desktop | `{ deviceId, name, platform, capabilities }` | `{ success }` | 设备上线注册 |
| `device:heartbeat` | Desktop | `{ deviceId, cpuUsage?, memoryUsage?, timestamp }` | - | 心跳 (30s) |
| `device:command:send` | Mobile | `DeviceCommandPayload` | `{ commandId, status: 'dispatched' }` | 发送命令 |
| `device:command:cancel` | Mobile | `{ commandId }` | `{ success }` | 取消命令 |
| `device:result:complete` | Desktop | `DeviceResultPayload` | - | 命令执行完成 |
| `device:result:progress` | Desktop | `{ commandId, progress, output? }` | - | 进度更新 |

### 6.2 服务端 → 客户端

| 事件名 | 目标 | Payload | 说明 |
|--------|------|---------|------|
| `device:command:execute` | `device:{deviceId}` | `DeviceCommandPayload` | 指示桌面端执行命令 |
| `device:command:ack` | `user:{userId}` | `{ commandId, status }` | 命令已分发确认 |
| `device:result:delivered` | `user:{userId}` | `DeviceResultPayload` | 命令结果推送到手机 |
| `device:result:progress` | `user:{userId}` | `{ commandId, progress, output? }` | 进度转发 |
| `device:status:changed` | `user:{userId}` | `DeviceStatusPayload` | 设备上线/下线 |

### 6.3 Payload 类型定义

```typescript
// DeviceCommandPayload — 手机端发送
interface DeviceCommandPayload {
  commandId: string;              // UUID
  targetDeviceId: string;         // 目标设备 ID
  type: 'shell' | 'file' | 'app' | 'automation';
  action: string;                 // 具体命令, e.g. "ls -la /tmp"
  args?: Record<string, unknown>;
  timeout?: number;               // 超时 ms, 默认 30000
  dangerLevel: 'safe' | 'warning' | 'dangerous';
}

// DeviceResultPayload — 桌面端回报
interface DeviceResultPayload {
  commandId: string;
  status: 'success' | 'error' | 'partial' | 'cancelled';
  data?: {
    output?: string;              // stdout
    exitCode?: number;
  };
  error?: {
    code: string;
    message: string;
  };
  executionTimeMs: number;
}

// DeviceStatusPayload
interface DeviceStatusPayload {
  deviceId: string;
  name: string;
  platform: 'windows' | 'macos' | 'linux';
  online: boolean;
  lastSeenAt: string;
}
```

### 6.4 命令执行流程

```
Mobile                    Cloud Brain                   Desktop (Electron)
  │                           │                              │
  ├── WS: device:command:send │                              │
  │   { targetDeviceId,       │                              │
  │     type: "shell",        │                              │
  │     action: "ls -la" }    │                              │
  │                           │                              │
  │   ACK: { commandId,       │                              │
  │<──  status: dispatched }──│                              │
  │                           ├── DB: INSERT command_log     │
  │                           │     status = 'dispatched'    │
  │                           │                              │
  │                           ├── WS: device:command:execute │
  │                           │   → device:{deviceId} room ─>│
  │                           │                              │
  │                           │                              ├── OpenClaw Node:
  │                           │                              │   system.run("ls -la")
  │                           │                              │
  │                           │  WS: device:result:progress  │
  │ WS: device:result:progress│<─────────────────────────────│ (optional)
  │<──────────────────────────│                              │
  │                           │                              │
  │                           │  WS: device:result:complete  │
  │                           │<─────────────────────────────│
  │                           ├── DB: UPDATE command_log     │
  │                           │     status = 'success'       │
  │                           │     result = { output }      │
  │                           │                              │
  │ WS: device:result:delivered                              │
  │<──────────────────────────│                              │
```

---

## 七、Socket.IO 服务端配置

### 7.1 Gateway 配置

```typescript
@WebSocketGateway({
  namespace: '/chat',  // 或 '/device'
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,    // 心跳间隔
  pingTimeout: 60000,     // 心跳超时
  maxHttpBufferSize: 1e6, // 1MB 最大消息
})
```

### 7.2 Redis 适配器

```typescript
// 用于多实例水平扩展
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';

const pubClient = new Redis(process.env.REDIS_URL);
const subClient = pubClient.duplicate();
server.adapter(createAdapter(pubClient, subClient));
```

### 7.3 Nginx 代理配置

```nginx
# proxy_read_timeout 必须 > pingInterval + pingTimeout (85s)
location /socket.io/ {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
```

---

## 八、TypeScript 类型安全

### 8.1 共享接口 (packages/shared)

```typescript
// 服务端和客户端共享同一套接口

interface ClientToServerEvents {
  // Chat
  'conversation:join':  (data: { conversationId: string }) => void;
  'conversation:leave': (data: { conversationId: string }) => void;
  'message:typing':     (data: { conversationId: string; isTyping: boolean }) => void;
  'message:read':       (data: { conversationId: string; lastReadMessageId: string }) => void;
  'presence:update':    (data: { isOnline: boolean }) => void;

  // AI (Sprint 2+)
  'ai:draft:approve':       (data: { draftId: string }, ack: (res: WsResponse) => void) => void;
  'ai:draft:reject':        (data: { draftId: string; reason?: string }) => void;
  'ai:draft:edit':          (data: { draftId: string; editedContent: string }, ack: (res: WsResponse) => void) => void;
  'ai:predictive:execute':  (data: { suggestionId: string; actionIndex: number }, ack: (res: WsResponse) => void) => void;
  'ai:predictive:dismiss':  (data: { suggestionId: string }) => void;
  'ai:whisper:select':      (data: { suggestionId: string; selectedIndex: number }) => void;

  // Device
  'device:register':       (data: DeviceRegisterPayload, ack: (res: WsResponse) => void) => void;
  'device:heartbeat':      (data: DeviceHeartbeatPayload) => void;
  'device:command:send':   (data: WsEnvelope<DeviceCommandPayload>, ack: (res: WsResponse) => void) => void;
  'device:command:cancel': (data: { commandId: string }, ack: (res: WsResponse) => void) => void;
  'device:result:complete':(data: WsEnvelope<DeviceResultPayload>) => void;
  'device:result:progress':(data: { commandId: string; progress: number; output?: string }) => void;
}

interface ServerToClientEvents {
  // Chat
  'message:new':          (data: MessageResponse) => void;
  'message:updated':      (data: MessageResponse) => void;
  'message:recalled':     (data: { messageId: string; conversationId: string }) => void;
  'message:typing':       (data: { conversationId: string; userId: string; isTyping: boolean }) => void;
  'message:read':         (data: { conversationId: string; userId: string; lastReadAt: string }) => void;
  'conversation:new':     (data: ConversationResponse) => void;
  'conversation:updated': (data: ConversationResponse) => void;
  'friend:request':       (data: FriendRequestPayload) => void;
  'friend:accepted':      (data: FriendPayload) => void;
  'friend:removed':       (data: { userId: string }) => void;
  'presence:changed':     (data: { userId: string; isOnline: boolean; lastSeenAt?: string }) => void;
  'notification:new':     (data: NotificationPayload) => void;

  // AI (Sprint 2+)
  'ai:whisper:suggestions': (data: WhisperPayload) => void;
  'ai:draft:created':       (data: DraftPayload) => void;
  'ai:draft:expired':       (data: { draftId: string }) => void;
  'ai:predictive:action':   (data: PredictivePayload) => void;

  // Device
  'device:command:execute':  (data: DeviceCommandPayload) => void;
  'device:command:ack':      (data: { commandId: string; status: string }) => void;
  'device:result:delivered': (data: DeviceResultPayload) => void;
  'device:result:progress':  (data: { commandId: string; progress: number; output?: string }) => void;
  'device:status:changed':   (data: DeviceStatusPayload) => void;

  // System
  'system:error': (data: WsError) => void;
}
```

### 8.2 服务端使用

```typescript
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

interface SocketData {
  user: { id: string; username: string; };
  userId: string;
  deviceId?: string;
  deviceType: 'mobile' | 'desktop' | 'web';
}
```

IDE 自动补全 emit 的事件名和 payload 类型，编译时捕获错误。
