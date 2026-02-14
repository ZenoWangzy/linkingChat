> **状态：待开发**

# Sprint 2 — Phase 3：在线状态系统（Online Presence）

> **负责人**：后端开发者 + 全端跟进
>
> **前置条件**：Phase 2（1 对 1 聊天）已完成 — ChatGateway(/chat) 可用、BroadcastService 已就绪；Phase 1（好友系统）已完成 — FriendsService 可查询好友列表；Redis 已配置（ioredis + Socket.IO Redis Adapter）；User model 含 `status UserStatus` 字段（ONLINE/IDLE/DND/OFFLINE）和 `lastSeenAt` 字段
>
> **产出**：Redis-based 在线/离线状态管理 + 好友实时状态同步 + 批量状态查询 API + Flutter/Desktop 状态指示器 UI
>
> **参考**：[sprint2_implement.md](./sprint2_implement.md) Phase 3 | [websocket-protocol.md](../dev-plan/websocket-protocol.md) | [database-schema.md](../dev-plan/database-schema.md)

---

## 任务清单

| # | 任务 | 产出文件 | 依赖 |
|---|------|---------|------|
| 3.1 | PresenceService — Redis SET 管理 | `apps/server/src/gateway/presence.service.ts` | Redis 已配置、PrismaService |
| 3.2 | 连接时标记在线 | `apps/server/src/gateway/chat.gateway.ts` handleConnection 修改 | 3.1 |
| 3.3 | 断开时标记离线 | `apps/server/src/gateway/chat.gateway.ts` handleDisconnect 修改 | 3.1 |
| 3.4 | WS 事件 presence:update（C→S） | `apps/server/src/gateway/chat.gateway.ts` 新增 handler | 3.1 |
| 3.5 | WS 广播 presence:changed（S→C） | `apps/server/src/gateway/chat.gateway.ts` broadcastPresenceChange 方法 | 3.1, Phase 1 FriendsService |
| 3.6 | GET `/api/v1/users/online` | `apps/server/src/users/users.controller.ts` 新增端点 | 3.1 |
| 3.7 | 客户端状态指示器 UI（Flutter + Desktop） | Flutter `FriendListPage` + Desktop `FriendList` 组件 | 3.5, 3.6 |

---

## Redis 数据结构设计

在线状态的核心数据全部存储在 Redis 中，利用其高性能读写和原子操作。数据库（PostgreSQL）仅在用户真正上线/离线时同步更新，作为持久化备份。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Key                         │ Type   │ 说明                               │
├──────────────────────────────┼────────┼────────────────────────────────────│
│ online_users                 │ SET    │ 所有在线用户 ID 集合               │
│                              │        │ { userId1, userId2, ... }          │
│                              │        │                                    │
│ user:status:{userId}         │ STRING │ 用户当前状态                       │
│                              │        │ "ONLINE" | "IDLE" | "DND"          │
│                              │        │ TTL 300s，心跳时刷新               │
│                              │        │                                    │
│ user:sockets:{userId}        │ SET    │ 用户的所有活跃 socket ID           │
│                              │        │ { socketId1, socketId2 }           │
│                              │        │ 支持多设备同时在线                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

**设计要点**：

- `online_users` SET 支持 `SISMEMBER` O(1) 判断在线、`SMEMBERS` 批量读取
- `user:status:{userId}` 使用 TTL 300s 作为被动过期机制 — 如果客户端意外断开且服务端未检测到（极端情况），5 分钟后自动清除
- `user:sockets:{userId}` 追踪多设备连接 — 桌面端 + 手机端同时在线时，只有所有 socket 都断开才标记离线

---

## 3.1 PresenceService — Redis SET 管理

核心服务，封装所有在线状态的 Redis 操作和数据库同步逻辑。

```typescript
// apps/server/src/gateway/presence.service.ts

import { Injectable, Inject, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  /** Redis Key 常量 */
  private static readonly ONLINE_USERS_KEY = 'online_users';
  private static readonly STATUS_PREFIX = 'user:status:';
  private static readonly SOCKETS_PREFIX = 'user:sockets:';
  private static readonly STATUS_TTL = 300; // 5 分钟

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 标记用户在线
   *
   * 1. 将 userId 添加到 online_users SET
   * 2. 将 socketId 添加到 user:sockets:{userId} SET
   * 3. 设置 user:status:{userId} 为 ONLINE（TTL 300s）
   * 4. 更新数据库 User.status = ONLINE
   */
  async setOnline(userId: string, socketId: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.sadd(PresenceService.ONLINE_USERS_KEY, userId);
    pipeline.sadd(`${PresenceService.SOCKETS_PREFIX}${userId}`, socketId);
    pipeline.set(
      `${PresenceService.STATUS_PREFIX}${userId}`,
      'ONLINE',
      'EX',
      PresenceService.STATUS_TTL,
    );
    await pipeline.exec();

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'ONLINE' },
    });

    this.logger.debug(`User ${userId} marked ONLINE (socket: ${socketId})`);
  }

  /**
   * 标记用户离线（单个 socket 断开）
   *
   * 1. 从 user:sockets:{userId} 移除该 socketId
   * 2. 检查剩余 socket 数量
   * 3. 如果没有剩余 socket → 真正离线：
   *    - 从 online_users SET 移除
   *    - 删除 user:status:{userId}
   *    - 更新数据库 User.status = OFFLINE, lastSeenAt = now()
   */
  async setOffline(userId: string, socketId: string): Promise<void> {
    await this.redis.srem(
      `${PresenceService.SOCKETS_PREFIX}${userId}`,
      socketId,
    );

    const remaining = await this.redis.scard(
      `${PresenceService.SOCKETS_PREFIX}${userId}`,
    );

    if (remaining === 0) {
      // 所有设备都已断开 — 真正离线
      const pipeline = this.redis.pipeline();
      pipeline.srem(PresenceService.ONLINE_USERS_KEY, userId);
      pipeline.del(`${PresenceService.STATUS_PREFIX}${userId}`);
      pipeline.del(`${PresenceService.SOCKETS_PREFIX}${userId}`);
      await pipeline.exec();

      await this.prisma.user.update({
        where: { id: userId },
        data: { status: 'OFFLINE', lastSeenAt: new Date() },
      });

      this.logger.debug(`User ${userId} marked OFFLINE (all sockets closed)`);
    } else {
      this.logger.debug(
        `User ${userId} socket ${socketId} disconnected, ${remaining} socket(s) remaining`,
      );
    }
  }

  /**
   * 主动切换状态（ONLINE / IDLE / DND）
   *
   * 用户手动设置"忙碌"或"勿扰"模式。不会改变 online_users SET 成员关系 —
   * 因为用户仍然在线连接着，只是状态标识不同。
   */
  async updateStatus(
    userId: string,
    status: 'ONLINE' | 'IDLE' | 'DND',
  ): Promise<void> {
    await this.redis.set(
      `${PresenceService.STATUS_PREFIX}${userId}`,
      status,
      'EX',
      PresenceService.STATUS_TTL,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { status },
    });

    this.logger.debug(`User ${userId} status updated to ${status}`);
  }

  /**
   * 心跳刷新 — 延长 status key 的 TTL
   *
   * 客户端定期发送心跳时调用，防止 status key 过期。
   * 不改变状态值本身，仅续期。
   */
  async refreshTtl(userId: string): Promise<void> {
    const key = `${PresenceService.STATUS_PREFIX}${userId}`;
    const exists = await this.redis.exists(key);
    if (exists) {
      await this.redis.expire(key, PresenceService.STATUS_TTL);
    }
  }

  /**
   * 判断用户是否在线
   *
   * O(1) 时间复杂度，通过 Redis SET 的 SISMEMBER 实现。
   */
  async isOnline(userId: string): Promise<boolean> {
    return (
      (await this.redis.sismember(
        PresenceService.ONLINE_USERS_KEY,
        userId,
      )) === 1
    );
  }

  /**
   * 批量查询多个用户的在线状态
   *
   * 使用 Redis pipeline 批量 GET，避免逐个查询的 N 次网络往返。
   * 未找到 status key 的用户视为 OFFLINE。
   *
   * @returns Map<userId, status>，status 为 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE'
   */
  async getStatuses(
    userIds: string[],
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const pipeline = this.redis.pipeline();
    userIds.forEach((id) =>
      pipeline.get(`${PresenceService.STATUS_PREFIX}${id}`),
    );
    const results = await pipeline.exec();

    const map = new Map<string, string>();
    userIds.forEach((id, i) => {
      // pipeline.exec() 返回 [error, result][] 数组
      const [err, value] = results![i];
      map.set(id, err ? 'OFFLINE' : (value as string) || 'OFFLINE');
    });

    return map;
  }

  /**
   * 获取单个用户的状态
   */
  async getStatus(userId: string): Promise<string> {
    const status = await this.redis.get(
      `${PresenceService.STATUS_PREFIX}${userId}`,
    );
    return status || 'OFFLINE';
  }

  /**
   * 获取在线用户总数（监控用）
   */
  async getOnlineCount(): Promise<number> {
    return this.redis.scard(PresenceService.ONLINE_USERS_KEY);
  }
}
```

### Module 注册

PresenceService 需要注册到 GatewayModule 中，并 export 给 UsersModule 使用（3.6 REST 端点需要）。

```typescript
// apps/server/src/gateway/gateway.module.ts — 修改

import { Module } from '@nestjs/common';
import { DeviceGateway } from './device.gateway';
import { ChatGateway } from './chat.gateway';
import { PresenceService } from './presence.service';
import { BroadcastService } from './broadcast.service';
import { DevicesModule } from '../devices/devices.module';
import { FriendsModule } from '../friends/friends.module';

@Module({
  imports: [DevicesModule, FriendsModule],
  providers: [
    DeviceGateway,
    ChatGateway,
    BroadcastService,
    PresenceService,
  ],
  exports: [BroadcastService, PresenceService],
})
export class GatewayModule {}
```

**要点**：
- 所有 Redis 操作尽量使用 `pipeline`，减少网络往返
- `setOffline` 中先检查剩余 socket 数量，确保多设备场景下不会误标离线
- `STATUS_TTL = 300` 作为兜底机制 — 正常情况下心跳会持续续期，异常断连时 5 分钟后自动清理
- DB 更新放在 Redis 操作之后，Redis 是实时查询的权威源，DB 是持久化备份

---

## 3.2 连接时标记在线

在 ChatGateway 的 `handleConnection` 中集成 PresenceService。当用户连接到 `/chat` 命名空间时，标记为在线并通知好友。

```typescript
// apps/server/src/gateway/chat.gateway.ts — handleConnection 修改

async handleConnection(client: TypedSocket) {
  const userId = client.data.userId;

  // 1. 加入用户个人房间（用于定向推送）
  client.join(`u-${userId}`);

  // 2. 检查是否为该用户的首个连接（首次上线）
  const wasOnline = await this.presenceService.isOnline(userId);

  // 3. 在 Redis 中注册在线状态
  await this.presenceService.setOnline(userId, client.id);

  // 4. 如果是首次上线（之前没有任何 socket），广播给好友
  if (!wasOnline) {
    await this.broadcastPresenceChange(userId, 'ONLINE');
  }

  this.logger.log(
    `[Chat] Client connected: ${client.id} | userId=${userId} | wasOnline=${wasOnline}`,
  );
}
```

**要点**：
- 通过 `wasOnline` 判断是否为首次连接，避免多设备场景下重复广播
- 例如：用户已在桌面端登录（socket A），此时手机端也连接了（socket B），不需要再广播一次 ONLINE
- `client.join('u-{userId}')` 确保用户加入个人房间，后续 BroadcastService 可以向这个房间推送消息

---

## 3.3 断开时标记离线

在 ChatGateway 的 `handleDisconnect` 中，调用 PresenceService 移除断开的 socket。只有当用户的所有 socket 都断开时，才广播离线状态。

```typescript
// apps/server/src/gateway/chat.gateway.ts — handleDisconnect 修改

async handleDisconnect(client: TypedSocket) {
  const userId = client.data.userId;

  // 1. 在 Redis 中移除此 socket
  await this.presenceService.setOffline(userId, client.id);

  // 2. 检查用户是否仍有活跃连接
  const stillOnline = await this.presenceService.isOnline(userId);

  // 3. 如果所有设备都断开了，广播离线状态
  if (!stillOnline) {
    await this.broadcastPresenceChange(userId, 'OFFLINE');
  }

  this.logger.log(
    `[Chat] Client disconnected: ${client.id} | userId=${userId} | stillOnline=${stillOnline}`,
  );
}
```

**数据库同步时机**：

`PresenceService.setOffline()` 内部已经处理了数据库更新 —— 当 `remaining === 0` 时，会同步设置 `User.status = 'OFFLINE'` 和 `User.lastSeenAt = new Date()`。因此 Gateway 层不需要额外的 DB 操作。

**异常处理**：

```typescript
// 建议包裹 try-catch 避免 Redis 异常阻塞断开流程
async handleDisconnect(client: TypedSocket) {
  const userId = client.data.userId;

  try {
    await this.presenceService.setOffline(userId, client.id);

    const stillOnline = await this.presenceService.isOnline(userId);
    if (!stillOnline) {
      await this.broadcastPresenceChange(userId, 'OFFLINE');
    }
  } catch (error) {
    this.logger.error(
      `Failed to handle disconnect for user ${userId}: ${error.message}`,
      error.stack,
    );
  }

  this.logger.log(`[Chat] Client disconnected: ${client.id} | userId=${userId}`);
}
```

---

## 3.4 WS 事件 presence:update（C→S）

客户端主动切换状态（例如用户手动设置为"忙碌"或"勿扰"）。服务端更新 Redis + DB，然后广播给好友。

### ChatGateway handler

```typescript
// apps/server/src/gateway/chat.gateway.ts — 新增 handler

@SubscribeMessage('presence:update')
async handlePresenceUpdate(
  @ConnectedSocket() client: TypedSocket,
  @MessageBody() data: { status: 'ONLINE' | 'IDLE' | 'DND' },
): Promise<WsResponse> {
  const userId = client.data.userId;
  const validStatuses = ['ONLINE', 'IDLE', 'DND'];

  // 1. 参数校验 — 不允许通过此事件设置 OFFLINE（离线由断连触发）
  if (!data.status || !validStatuses.includes(data.status)) {
    return {
      success: false,
      error: {
        code: 'INVALID_STATUS',
        message: `Status must be one of: ${validStatuses.join(', ')}`,
      },
      timestamp: new Date().toISOString(),
    };
  }

  try {
    // 2. 更新 Redis + DB
    await this.presenceService.updateStatus(userId, data.status);

    // 3. 广播给好友
    await this.broadcastPresenceChange(userId, data.status);

    this.logger.log(
      `[Chat] User ${userId} updated status to ${data.status}`,
    );

    return {
      success: true,
      data: { status: data.status },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    this.logger.error(
      `Failed to update presence for user ${userId}: ${error.message}`,
    );
    return {
      success: false,
      error: { code: 'PRESENCE_UPDATE_FAILED', message: error.message },
      timestamp: new Date().toISOString(),
    };
  }
}
```

### ws-protocol 类型补充

```typescript
// packages/ws-protocol/src/events.ts — 新增事件定义

// Client → Server
export const PRESENCE_UPDATE = 'presence:update';

// Server → Client
export const PRESENCE_CHANGED = 'presence:changed';
```

```typescript
// packages/ws-protocol/src/payloads/presence.payloads.ts — 新增

/** C→S: 客户端主动切换状态 */
export interface PresenceUpdatePayload {
  status: 'ONLINE' | 'IDLE' | 'DND';
}

/** S→C: 广播给好友的状态变更通知 */
export interface PresenceChangedPayload {
  userId: string;
  status: 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE';
  lastSeenAt: string; // ISO 8601
}
```

### Flutter WS 事件名同步

```dart
// apps/mobile/lib/core/constants/ws_events.dart — 新增

// Client → Server
static const presenceUpdate  = 'presence:update';

// Server → Client
static const presenceChanged = 'presence:changed';
```

---

## 3.5 WS 广播 presence:changed（S→C）

当用户状态变更时（上线、离线、主动切换），向该用户的所有好友推送 `presence:changed` 事件。

### ChatGateway 广播方法

```typescript
// apps/server/src/gateway/chat.gateway.ts — 新增 private 方法

/**
 * 向用户的所有好友广播状态变更
 *
 * 流程：
 * 1. 通过 FriendsService 获取好友 ID 列表
 * 2. 遍历好友列表，向每个好友的个人房间推送 presence:changed
 *
 * 使用 BroadcastService.emitToUser 确保消息通过 Redis Adapter 跨实例送达。
 */
private async broadcastPresenceChange(
  userId: string,
  status: string,
): Promise<void> {
  try {
    // 1. 获取好友 ID 列表
    const friendIds = await this.friendsService.getFriendIds(userId);

    if (friendIds.length === 0) {
      return;
    }

    // 2. 构建 payload
    const payload: PresenceChangedPayload = {
      userId,
      status: status as 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE',
      lastSeenAt: new Date().toISOString(),
    };

    // 3. 向每个好友推送
    for (const friendId of friendIds) {
      this.broadcastService.emitToUser(friendId, 'presence:changed', payload);
    }

    this.logger.debug(
      `Presence change broadcast: user=${userId} status=${status} → ${friendIds.length} friend(s)`,
    );
  } catch (error) {
    this.logger.error(
      `Failed to broadcast presence change for user ${userId}: ${error.message}`,
    );
  }
}
```

### ChatGateway 构造函数更新

确保 ChatGateway 注入了 PresenceService 和 FriendsService：

```typescript
// apps/server/src/gateway/chat.gateway.ts — constructor 修改

@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  namespace: Namespace;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messagesService: MessagesService,
    private readonly conversesService: ConversesService,
    private readonly broadcastService: BroadcastService,
    private readonly presenceService: PresenceService,      // 新增
    private readonly friendsService: FriendsService,         // 新增
  ) {}

  // ...
}
```

**广播性能说明**：

- 好友数量较少时（<100），逐个 `emitToUser` 的性能开销可接受（每次仅是向 Socket.IO 房间 emit，通过 Redis Adapter 分发）
- 如果未来好友数量增长到数百以上，可考虑：
  - 批量 join 一个 `friends-of-{userId}` 房间，一次 emit 覆盖所有好友
  - 使用 Redis Pub/Sub 单独通道，避免占用 Socket.IO 消息带宽
- Sprint 2 阶段按逐个推送实现即可

---

## 3.6 GET `/api/v1/users/online`

REST 端点，用于客户端批量查询多个用户的在线状态。典型场景：进入好友列表页时，一次性查询所有好友的状态。

### UsersController 新增端点

```typescript
// apps/server/src/users/users.controller.ts — 新增方法

import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PresenceService } from '../gateway/presence.service';

@Controller('api/v1/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly presenceService: PresenceService,
    // ... 其他已有注入
  ) {}

  /**
   * GET /api/v1/users/online?ids=userId1,userId2,userId3
   *
   * 批量查询用户在线状态。
   *
   * @param ids - 逗号分隔的用户 ID 列表
   * @returns { [userId]: 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE' }
   */
  @Get('online')
  async getOnlineStatuses(
    @Query('ids') ids: string,
  ): Promise<Record<string, string>> {
    if (!ids || ids.trim().length === 0) {
      throw new BadRequestException('Query parameter "ids" is required');
    }

    const userIds = ids
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (userIds.length === 0) {
      throw new BadRequestException('At least one user ID is required');
    }

    // 限制单次查询数量，防止滥用
    if (userIds.length > 200) {
      throw new BadRequestException('Maximum 200 user IDs per request');
    }

    const statuses = await this.presenceService.getStatuses(userIds);
    return Object.fromEntries(statuses);
  }
}
```

### UsersModule 更新

确保 UsersModule 能注入 PresenceService：

```typescript
// apps/server/src/users/users.module.ts — 修改

import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule], // 引入 GatewayModule 以获取 PresenceService
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

### 响应格式

```json
// GET /api/v1/users/online?ids=clxyz1,clxyz2,clxyz3
// Response 200:

{
  "clxyz1": "ONLINE",
  "clxyz2": "DND",
  "clxyz3": "OFFLINE"
}
```

**要点**：
- 使用 Redis pipeline 批量查询，200 个用户 ID 只需 1 次 Redis 网络往返
- 上限 200 个 ID 防止 client 发送过长请求
- 返回 flat object 而非 array，客户端可直接用 userId 作为 key 读取

---

## 3.7 客户端状态指示器 UI

在好友列表和聊天页面中，通过彩色圆点显示用户的在线状态。

### 状态颜色规范

| 状态 | 颜色 | Hex | 含义 |
|------|------|-----|------|
| ONLINE | 绿色 | `#4CAF50` | 在线，可联系 |
| IDLE | 黄色 | `#FFC107` | 闲置，暂时离开 |
| DND | 红色 | `#F44336` | 勿扰模式 |
| OFFLINE | 灰色 | `#9E9E9E` | 离线 |

### Flutter 实现

#### 状态圆点组件

```dart
// apps/mobile/lib/features/social/widgets/presence_dot.dart

import 'package:flutter/material.dart';

class PresenceDot extends StatelessWidget {
  final String status;
  final double size;

  const PresenceDot({
    super.key,
    required this.status,
    this.size = 12.0,
  });

  Color get _color {
    switch (status) {
      case 'ONLINE':
        return const Color(0xFF4CAF50);
      case 'IDLE':
        return const Color(0xFFFFC107);
      case 'DND':
        return const Color(0xFFF44336);
      case 'OFFLINE':
      default:
        return const Color(0xFF9E9E9E);
    }
  }

  String get _label {
    switch (status) {
      case 'ONLINE':
        return '在线';
      case 'IDLE':
        return '离开';
      case 'DND':
        return '勿扰';
      case 'OFFLINE':
      default:
        return '离线';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: _label,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: _color,
          shape: BoxShape.circle,
          border: Border.all(
            color: Colors.white,
            width: 2.0,
          ),
          boxShadow: [
            BoxShadow(
              color: _color.withOpacity(0.4),
              blurRadius: 4,
              spreadRadius: 0,
            ),
          ],
        ),
      ),
    );
  }
}
```

#### Presence Provider

管理好友在线状态的全局状态，监听 WS `presence:changed` 事件实时更新。

```dart
// apps/mobile/lib/features/social/providers/presence_provider.dart

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/ws_service.dart';
import '../../../core/network/api_client.dart';
import '../../../core/constants/ws_events.dart';
import 'package:dio/dio.dart';

/// Map<userId, status> — 所有已知用户的在线状态
class PresenceNotifier extends StateNotifier<Map<String, String>> {
  final Ref _ref;

  PresenceNotifier(this._ref) : super({}) {
    _listenForChanges();
  }

  /// 监听 WS presence:changed 事件
  void _listenForChanges() {
    final wsService = _ref.read(wsServiceProvider);
    wsService.on(WsEvents.presenceChanged, (data) {
      final payload = data as Map<String, dynamic>;
      final userId = payload['userId'] as String;
      final status = payload['status'] as String;

      state = {...state, userId: status};
    });
  }

  /// 批量加载好友状态（进入好友列表时调用）
  Future<void> loadStatuses(List<String> userIds) async {
    if (userIds.isEmpty) return;

    try {
      final dio = _ref.read(dioProvider);
      final ids = userIds.join(',');
      final response = await dio.get('/api/v1/users/online?ids=$ids');
      final statuses = Map<String, String>.from(response.data as Map);

      state = {...state, ...statuses};
    } catch (e) {
      // 静默失败 — 状态查询不应阻断 UI
    }
  }

  /// 获取单个用户的状态
  String getStatus(String userId) {
    return state[userId] ?? 'OFFLINE';
  }

  @override
  void dispose() {
    final wsService = _ref.read(wsServiceProvider);
    wsService.off(WsEvents.presenceChanged);
    super.dispose();
  }
}

final presenceProvider =
    StateNotifierProvider<PresenceNotifier, Map<String, String>>((ref) {
  return PresenceNotifier(ref);
});
```

#### FriendListPage 集成

在好友列表中，每个好友头像旁边显示状态圆点。

```dart
// apps/mobile/lib/features/social/pages/friend_list_page.dart — 修改 build 方法

// 在 initState 或首次 build 时加载好友状态
@override
void initState() {
  super.initState();
  _loadPresenceStatuses();
}

Future<void> _loadPresenceStatuses() async {
  final friends = ref.read(friendListProvider);
  friends.whenData((list) {
    final ids = list.map((f) => f.userId).toList();
    ref.read(presenceProvider.notifier).loadStatuses(ids);
  });
}

// 在 ListTile 的 leading 中叠加 PresenceDot
Widget _buildFriendAvatar(String userId) {
  final presenceStatuses = ref.watch(presenceProvider);
  final status = presenceStatuses[userId] ?? 'OFFLINE';

  return Stack(
    children: [
      // 头像
      CircleAvatar(
        radius: 24,
        backgroundColor: Colors.grey[200],
        child: const Icon(Icons.person, color: Colors.grey),
      ),
      // 状态圆点 — 定位在头像右下角
      Positioned(
        right: 0,
        bottom: 0,
        child: PresenceDot(status: status, size: 14),
      ),
    ],
  );
}
```

#### ChatPage 集成

在聊天页面的 AppBar 中显示对方的在线状态。

```dart
// apps/mobile/lib/features/social/pages/chat_page.dart — AppBar subtitle

AppBar(
  title: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(recipientName),
      Consumer(
        builder: (context, ref, _) {
          final presenceStatuses = ref.watch(presenceProvider);
          final status = presenceStatuses[recipientId] ?? 'OFFLINE';
          return Row(
            children: [
              PresenceDot(status: status, size: 8),
              const SizedBox(width: 4),
              Text(
                _statusLabel(status),
                style: const TextStyle(
                  fontSize: 12,
                  color: Colors.grey,
                  fontWeight: FontWeight.normal,
                ),
              ),
            ],
          );
        },
      ),
    ],
  ),
)

String _statusLabel(String status) {
  switch (status) {
    case 'ONLINE': return '在线';
    case 'IDLE':   return '离开';
    case 'DND':    return '勿扰';
    default:       return '离线';
  }
}
```

### Desktop 实现（React）

#### 状态圆点组件

```tsx
// apps/desktop/src/renderer/components/PresenceDot.tsx

interface PresenceDotProps {
  status: 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE';
  size?: number;
}

const STATUS_COLORS: Record<string, string> = {
  ONLINE: '#4CAF50',
  IDLE: '#FFC107',
  DND: '#F44336',
  OFFLINE: '#9E9E9E',
};

const STATUS_LABELS: Record<string, string> = {
  ONLINE: '在线',
  IDLE: '离开',
  DND: '勿扰',
  OFFLINE: '离线',
};

export function PresenceDot({ status, size = 12 }: PresenceDotProps) {
  const color = STATUS_COLORS[status] || STATUS_COLORS.OFFLINE;
  const label = STATUS_LABELS[status] || STATUS_LABELS.OFFLINE;

  return (
    <span
      title={label}
      className="presence-dot"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: color,
        border: '2px solid white',
        boxShadow: `0 0 4px ${color}66`,
      }}
    />
  );
}
```

#### FriendList 组件集成

```tsx
// apps/desktop/src/renderer/components/FriendList.tsx — 好友列表项

import { PresenceDot } from './PresenceDot';

function FriendListItem({ friend, presenceStatus }: {
  friend: Friend;
  presenceStatus: string;
}) {
  return (
    <div className="friend-list-item">
      <div className="friend-avatar-wrapper">
        <div className="friend-avatar">
          {friend.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="friend-presence-dot">
          <PresenceDot
            status={presenceStatus as 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE'}
            size={14}
          />
        </div>
      </div>
      <div className="friend-info">
        <span className="friend-name">{friend.displayName}</span>
        <span className="friend-status-text">
          {STATUS_LABELS[presenceStatus] || '离线'}
        </span>
      </div>
    </div>
  );
}
```

#### Desktop WS 监听

Desktop 端在 `/chat` 命名空间连接后，需要监听 `presence:changed` 事件并更新本地状态。

```typescript
// apps/desktop/src/main/services/chat-ws-client.service.ts — 新增监听

// 在 setupEventListeners() 中添加:
this.socket.on('presence:changed', (data: {
  userId: string;
  status: string;
  lastSeenAt: string;
}) => {
  // 通知渲染进程更新好友状态
  this.mainWindow?.webContents.send('presence:changed', data);
});
```

```typescript
// apps/desktop/src/preload/index.ts — 新增

onPresenceChanged: (callback: (data: {
  userId: string;
  status: string;
  lastSeenAt: string;
}) => void) => {
  ipcRenderer.on('presence:changed', (_event, data) => callback(data));
},
```

### CSS 样式参考

```css
/* 状态圆点在头像上的定位 */
.friend-avatar-wrapper {
  position: relative;
  display: inline-block;
}

.friend-presence-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
}

/* 好友列表项 */
.friend-list-item {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.friend-list-item:hover {
  background-color: #f5f5f5;
}

.friend-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: #666;
}

.friend-info {
  margin-left: 12px;
  display: flex;
  flex-direction: column;
}

.friend-name {
  font-size: 15px;
  font-weight: 500;
  color: #333;
}

.friend-status-text {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}
```

---

## 多设备处理说明

在线状态系统的核心挑战之一是多设备场景。一个用户可能同时在桌面端和手机端登录。

### 场景分析

```
场景 1：首次上线
  手机连接 → socket A 加入 user:sockets:u1
  → online_users ADD u1
  → 广播 ONLINE 给好友

场景 2：第二设备上线
  桌面连接 → socket B 加入 user:sockets:u1
  → wasOnline = true (socket A 已在)
  → 不广播（避免重复通知）

场景 3：其中一个设备断开
  手机断开 → socket A 从 user:sockets:u1 移除
  → remaining = 1 (socket B 仍在)
  → 不广播（用户仍在线）

场景 4：所有设备断开
  桌面断开 → socket B 从 user:sockets:u1 移除
  → remaining = 0
  → online_users REMOVE u1
  → 广播 OFFLINE 给好友
  → DB: status=OFFLINE, lastSeenAt=now()

场景 5：状态切换
  用户在手机设为 DND → presence:update { status: 'DND' }
  → Redis: user:status:u1 = DND
  → DB: status = DND
  → 广播 DND 给好友
  → 桌面端和手机端均显示红色圆点
```

### 状态同步时序图

```
  手机端                    Cloud Brain                    桌面端(好友)
    │                          │                              │
    │──── WS connect ────────>│                              │
    │                          │── setOnline(u1, sid1) ────>│Redis
    │                          │── broadcastPresenceChange ─>│
    │                          │                              │<── presence:changed
    │                          │                              │    { userId:u1, status:ONLINE }
    │                          │                              │
    │── presence:update ──────>│                              │
    │   { status: 'DND' }     │── updateStatus(u1, DND) ──>│Redis
    │                          │── broadcastPresenceChange ─>│
    │                          │                              │<── presence:changed
    │                          │                              │    { userId:u1, status:DND }
    │                          │                              │
    │──── WS disconnect ─────>│                              │
    │                          │── setOffline(u1, sid1) ───>│Redis
    │                          │   remaining=0               │
    │                          │── broadcastPresenceChange ─>│
    │                          │                              │<── presence:changed
    │                          │                              │    { userId:u1, status:OFFLINE }
```

---

## 心跳与 TTL 刷新

Socket.IO 自带 ping/pong 心跳机制（默认 `pingInterval: 25000, pingTimeout: 60000`）。服务端可以在收到心跳时刷新 Redis TTL：

```typescript
// apps/server/src/gateway/chat.gateway.ts — 可选：心跳时刷新 TTL

// 方案 A：利用 Socket.IO 内置 ping 事件（推荐）
// Socket.IO 的 ping/pong 已经能检测连接存活
// TTL 300s 远大于 pingTimeout 60s，正常情况下连接断开时
// handleDisconnect 会被触发，不需要额外心跳刷新

// 方案 B：显式心跳事件（如果需要更精确的 TTL 管理）
@SubscribeMessage('presence:heartbeat')
async handlePresenceHeartbeat(
  @ConnectedSocket() client: TypedSocket,
): Promise<void> {
  const userId = client.data.userId;
  await this.presenceService.refreshTtl(userId);
}
```

Sprint 2 采用方案 A（依赖 Socket.IO 内置心跳），因为 `STATUS_TTL = 300s` 的兜底时间足够覆盖绝大部分异常断连场景。如果后续发现需要更精确的 TTL 管理，再切换到方案 B。

---

## 完成标准

- [ ] 用户登录 → 好友 2 秒内看到绿色圆点（ONLINE）
- [ ] 用户断开连接 → 好友 5 秒内看到灰色圆点（OFFLINE）
- [ ] 手动切换状态为 DND → 好友看到红色圆点
- [ ] `GET /api/v1/users/online` 返回正确的批量状态
- [ ] 多设备：桌面端 + 手机端同时在线，关闭其中一个不会显示离线
- [ ] Flutter 好友列表显示彩色状态圆点
- [ ] Desktop 好友列表显示彩色状态圆点
