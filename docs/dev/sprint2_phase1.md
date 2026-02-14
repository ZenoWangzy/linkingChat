> **状态：待开发**

# Sprint 2 — Phase 1：好友系统（Friends System）

> **负责人**：后端开发者 + 全端跟进
>
> **前置条件**：Phase 0（Schema 扩展）已完成 — FriendRequest、Friendship、UserBlock、Converse、ConverseMember 表已 migrate；BroadcastService(@Global) 可用
>
> **产出**：完整的好友请求 → 接受 → 列表 → 删除 → 拉黑流程，REST API + WS 实时通知 + Flutter UI + Desktop UI
>
> **参考**：[sprint2_implement.md](./sprint2_implement.md) Phase 1 | [websocket-protocol.md](../dev-plan/websocket-protocol.md) | [database-schema.md](../dev-plan/database-schema.md) | [reference-architecture-guide.md](../dev-plan/reference-architecture-guide.md)

---

## 任务清单

| # | 任务 | 产出文件 | 依赖 |
|---|------|---------|------|
| 1.1 | 创建 FriendsModule + FriendsService | `apps/server/src/friends/friends.module.ts`, `friends.service.ts` | Phase 0 Schema |
| 1.2 | POST `/api/v1/friends/request` — 发送好友请求 | `friends.controller.ts`, `dto/send-request.dto.ts` | 1.1 |
| 1.3 | POST `/api/v1/friends/accept/:requestId` — 接受请求 | `friends.service.ts` accept 方法 | 1.1, 1.2 |
| 1.4 | POST `/api/v1/friends/reject/:requestId` — 拒绝请求 | `friends.service.ts` reject 方法 | 1.1 |
| 1.5 | GET `/api/v1/friends` — 好友列表 | `friends.controller.ts`, `dto/friend-response.dto.ts` | 1.1 |
| 1.6 | DELETE `/api/v1/friends/:userId` — 删除好友 | `friends.service.ts` removeFriend 方法 | 1.1 |
| 1.7 | POST `/api/v1/friends/block/:userId` — 拉黑 | `friends.service.ts` blockUser 方法 | 1.1 |
| 1.8 | WS 事件广播 | BroadcastService 调用（嵌入各 service 方法） | 1.2, 1.3, 1.6 |
| 1.9 | GET `/api/v1/friends/requests` — 待处理请求列表 | `friends.controller.ts` getPendingRequests | 1.1 |
| 1.10 | 单元测试 | `friends.service.spec.ts` | 1.1-1.9 |

---

## 关键文件

```
apps/server/src/friends/
  ├── friends.module.ts
  ├── friends.controller.ts          # REST 端点，@UseGuards(JwtAuthGuard)
  ├── friends.service.ts             # 业务逻辑 (Prisma 事务 + BroadcastService)
  └── dto/
      ├── send-request.dto.ts        # SendFriendRequestDto
      └── friend-response.dto.ts     # FriendResponseDto

packages/ws-protocol/src/
  ├── payloads/chat.payloads.ts      # 新增 FriendRequestPayload, FriendPayload
  └── events.ts                      # 新增 FRIEND_EVENTS 常量

apps/mobile/lib/features/friends/
  ├── pages/
  │   ├── friend_list_page.dart
  │   └── friend_requests_page.dart
  ├── providers/
  │   ├── friends_provider.dart       # StateNotifier<List<Friend>>
  │   └── friend_requests_provider.dart
  ├── models/
  │   ├── friend.dart
  │   └── friend_request.dart
  └── widgets/
      ├── friend_tile.dart
      └── friend_request_card.dart

apps/desktop/src/
  ├── main/ipc/friends.ipc.ts        # IPC handler 注册
  └── renderer/
      ├── pages/Friends.tsx           # 好友列表 + 好友请求
      └── components/
          ├── FriendList.tsx
          └── FriendRequestCard.tsx
```

---

## WS 事件流

```
用户 A 发送好友请求:
  POST /api/v1/friends/request { receiverId: B }
    → DB: INSERT friend_requests (status=PENDING)
    → WS: friend:request → u-{B}  (通知 B 收到请求)

用户 B 接受请求:
  POST /api/v1/friends/accept/:requestId
    → DB (事务):
        DELETE friend_requests
        INSERT friendships (normalization: 较小 ID → userAId)
        INSERT converse (type=DM)
        INSERT converse_members x2 (A + B)
    → WS: friend:accepted → u-{A} + u-{B}  (通知双方已成为好友)
    → WS: converse:new → u-{A} + u-{B}  (通知双方新 DM 会话)

用户 A 删除好友 B:
  DELETE /api/v1/friends/:userId
    → DB (事务):
        DELETE friendships
        UPDATE converse_members SET isOpen=false (DM 会话)
    → WS: friend:removed → u-{A} + u-{B}  (通知双方)

用户 A 拉黑 B:
  POST /api/v1/friends/block/:userId
    → DB (事务):
        INSERT user_blocks
        DELETE friendships (如果存在)
    → WS: friend:removed → u-{B}  (被拉黑方)
```

---

## 1.1 FriendsModule + FriendsService

创建好友系统模块骨架，注入 PrismaService 和 BroadcastService。

### Module

```typescript
// apps/server/src/friends/friends.module.ts

import { Module } from '@nestjs/common';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';

@Module({
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
```

### Service 骨架

```typescript
// apps/server/src/friends/friends.service.ts

import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService } from '../gateway/broadcast.service';

@Injectable()
export class FriendsService {
  private readonly logger = new Logger(FriendsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcast: BroadcastService,
  ) {}

  // --- 1.2 sendRequest()
  // --- 1.3 accept()
  // --- 1.4 reject()
  // --- 1.5 getFriendList()
  // --- 1.6 removeFriend()
  // --- 1.7 blockUser()
  // --- 1.9 getPendingRequests()

  /**
   * Friendship ID 归一化：较小 ID 放 userAId，较大 ID 放 userBId
   * 保证 (A, B) 和 (B, A) 在数据库中只有一行
   */
  private normalizeFriendshipIds(
    userId1: string,
    userId2: string,
  ): [string, string] {
    const [userAId, userBId] = [userId1, userId2].sort();
    return [userAId, userBId];
  }
}
```

**要点**：
- `PrismaService` 和 `BroadcastService` 都是 `@Global()` 模块提供的，FriendsModule 无需 import
- `normalizeFriendshipIds()` 是 Friendship 表的核心不变量：`userAId < userBId`，所有查询和创建都必须走这个方法
- 使用 NestJS 内置异常（`BadRequestException`, `ConflictException` 等），不使用自定义 Result Monad（Sprint 2 简化策略）

---

## 1.2 POST `/api/v1/friends/request` — 发送好友请求

创建 FriendRequest 记录，防止重复请求、自己加自己、已是好友，并通过 BroadcastService 通知接收方。

### DTO

```typescript
// apps/server/src/friends/dto/send-request.dto.ts

import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class SendFriendRequestDto {
  @IsString()
  @IsNotEmpty()
  receiverId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;
}
```

### Service 方法

```typescript
// apps/server/src/friends/friends.service.ts — sendRequest

async sendRequest(senderId: string, dto: SendFriendRequestDto) {
  const { receiverId, message } = dto;

  // 1. 不能自己加自己
  if (senderId === receiverId) {
    throw new BadRequestException('Cannot send friend request to yourself');
  }

  // 2. 检查接收方是否存在
  const receiver = await this.prisma.user.findUnique({
    where: { id: receiverId },
    select: { id: true, username: true, displayName: true, avatarUrl: true },
  });

  if (!receiver) {
    throw new NotFoundException('User not found');
  }

  // 3. 检查是否被对方拉黑
  const blocked = await this.prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: receiverId, blockedId: senderId },
        { blockerId: senderId, blockedId: receiverId },
      ],
    },
  });

  if (blocked) {
    throw new ForbiddenException('Cannot send friend request to this user');
  }

  // 4. 检查是否已经是好友
  const [userAId, userBId] = this.normalizeFriendshipIds(senderId, receiverId);
  const existingFriendship = await this.prisma.friendship.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
  });

  if (existingFriendship) {
    throw new ConflictException('Already friends');
  }

  // 5. 检查是否已有待处理的请求（双向检查）
  const existingRequest = await this.prisma.friendRequest.findFirst({
    where: {
      OR: [
        { senderId, receiverId, status: 'PENDING' },
        { senderId: receiverId, receiverId: senderId, status: 'PENDING' },
      ],
    },
  });

  if (existingRequest) {
    // 如果对方已经发了请求给自己，则自动接受
    if (existingRequest.senderId === receiverId) {
      return this.accept(senderId, existingRequest.id);
    }
    throw new ConflictException('Friend request already sent');
  }

  // 6. 创建好友请求
  const friendRequest = await this.prisma.friendRequest.create({
    data: {
      senderId,
      receiverId,
      message,
      status: 'PENDING',
    },
    include: {
      sender: {
        select: { id: true, username: true, displayName: true, avatarUrl: true },
      },
    },
  });

  // 7. WS 通知接收方
  this.broadcast.unicast(receiverId, 'friend:request', {
    id: friendRequest.id,
    sender: friendRequest.sender,
    message: friendRequest.message,
    createdAt: friendRequest.createdAt.toISOString(),
  });

  this.logger.log(
    `Friend request sent: ${senderId} → ${receiverId} (requestId: ${friendRequest.id})`,
  );

  return {
    id: friendRequest.id,
    receiverId,
    message: friendRequest.message,
    status: 'PENDING',
    createdAt: friendRequest.createdAt.toISOString(),
  };
}
```

### Controller 方法

```typescript
// apps/server/src/friends/friends.controller.ts — sendRequest

import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FriendsService } from './friends.service';
import { SendFriendRequestDto } from './dto/send-request.dto';

@Controller('api/v1/friends')
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  /** POST /api/v1/friends/request — 发送好友请求 */
  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  sendRequest(
    @CurrentUser('userId') userId: string,
    @Body() dto: SendFriendRequestDto,
  ) {
    return this.friendsService.sendRequest(userId, dto);
  }

  // ... 其他端点见下方各任务
}
```

**响应格式**（201 Created）：

```json
{
  "id": "cm1abc...",
  "receiverId": "cm1xyz...",
  "message": "Hi, let's be friends!",
  "status": "PENDING",
  "createdAt": "2026-02-14T10:30:00.000Z"
}
```

**错误响应**：

| 场景 | HTTP 状态码 | message |
|------|------------|---------|
| 自己加自己 | 400 | Cannot send friend request to yourself |
| 用户不存在 | 404 | User not found |
| 被拉黑 | 403 | Cannot send friend request to this user |
| 已是好友 | 409 | Already friends |
| 重复请求 | 409 | Friend request already sent |

**特殊逻辑**：如果 A 发给 B 请求时，B 已经有一个待处理的请求给 A，则自动触发 `accept()`，跳过人工确认。这是常见的"互相想加好友"场景优化。

---

## 1.3 POST `/api/v1/friends/accept/:requestId` — 接受好友请求

核心事务操作：在一个 Prisma 事务内删除 FriendRequest、创建 Friendship、创建 DM Converse + 2 个 ConverseMember。

### Service 方法

```typescript
// apps/server/src/friends/friends.service.ts — accept

async accept(currentUserId: string, requestId: string) {
  // 1. 查找请求 — 必须是发给当前用户的、状态为 PENDING 的
  const friendRequest = await this.prisma.friendRequest.findUnique({
    where: { id: requestId },
    include: {
      sender: {
        select: { id: true, username: true, displayName: true, avatarUrl: true },
      },
      receiver: {
        select: { id: true, username: true, displayName: true, avatarUrl: true },
      },
    },
  });

  if (!friendRequest) {
    throw new NotFoundException('Friend request not found');
  }

  if (friendRequest.receiverId !== currentUserId) {
    throw new ForbiddenException('You can only accept requests sent to you');
  }

  if (friendRequest.status !== 'PENDING') {
    throw new ConflictException('Friend request is no longer pending');
  }

  // 2. Friendship ID 归一化
  const [userAId, userBId] = this.normalizeFriendshipIds(
    friendRequest.senderId,
    friendRequest.receiverId,
  );

  // 3. 事务：删除请求 + 创建好友关系 + 创建 DM 会话
  const result = await this.prisma.$transaction(async (tx) => {
    // 3a. 删除 FriendRequest（不设 ACCEPTED 状态，直接删除）
    await tx.friendRequest.delete({
      where: { id: requestId },
    });

    // 3b. 创建 Friendship（归一化 ID 保证唯一性）
    const friendship = await tx.friendship.create({
      data: { userAId, userBId },
    });

    // 3c. 检查是否已有 DM 会话（可能之前是好友、删除后重新加的）
    const existingDm = await tx.converse.findFirst({
      where: {
        type: 'DM',
        members: {
          every: {
            userId: { in: [friendRequest.senderId, friendRequest.receiverId] },
          },
        },
      },
      include: { members: true },
    });

    let converse;
    if (existingDm && existingDm.members.length === 2) {
      // 重新打开已有的 DM
      await tx.converseMember.updateMany({
        where: { converseId: existingDm.id },
        data: { isOpen: true },
      });
      converse = existingDm;
    } else {
      // 创建新的 DM 会话
      converse = await tx.converse.create({
        data: {
          type: 'DM',
          members: {
            create: [
              { userId: friendRequest.senderId, isOpen: true },
              { userId: friendRequest.receiverId, isOpen: true },
            ],
          },
        },
        include: { members: true },
      });
    }

    return { friendship, converse };
  });

  // 4. WS 广播：通知双方已成为好友
  const senderPayload = {
    friendId: friendRequest.receiverId,
    friend: friendRequest.receiver,
  };
  const receiverPayload = {
    friendId: friendRequest.senderId,
    friend: friendRequest.sender,
  };

  this.broadcast.unicast(
    friendRequest.senderId,
    'friend:accepted',
    senderPayload,
  );
  this.broadcast.unicast(
    friendRequest.receiverId,
    'friend:accepted',
    receiverPayload,
  );

  // 5. WS 广播：通知双方新 DM 会话
  const conversePayload = {
    id: result.converse.id,
    type: 'DM',
    members: result.converse.members.map((m) => ({
      userId: m.userId,
      isOpen: m.isOpen,
    })),
    createdAt: result.converse.createdAt?.toISOString?.() ?? new Date().toISOString(),
  };

  this.broadcast.listcast(
    [friendRequest.senderId, friendRequest.receiverId],
    'converse:new',
    conversePayload,
  );

  this.logger.log(
    `Friend request accepted: ${friendRequest.senderId} ↔ ${friendRequest.receiverId} (friendship: ${result.friendship.id}, dm: ${result.converse.id})`,
  );

  return {
    friendshipId: result.friendship.id,
    converseId: result.converse.id,
  };
}
```

### Controller 方法

```typescript
// apps/server/src/friends/friends.controller.ts — accept

/** POST /api/v1/friends/accept/:requestId — 接受好友请求 */
@Post('accept/:requestId')
@HttpCode(HttpStatus.OK)
acceptRequest(
  @Param('requestId') requestId: string,
  @CurrentUser('userId') userId: string,
) {
  return this.friendsService.accept(userId, requestId);
}
```

**响应格式**（200 OK）：

```json
{
  "friendshipId": "cm1friendship...",
  "converseId": "cm1converse..."
}
```

**事务要点**：
- `$transaction` 确保原子性：如果 Friendship 创建失败（比如已存在），不会留下"FriendRequest 被删但没成为好友"的脏数据
- DM Converse 的"已存在"检查处理了"删除好友后重新加回来"的场景 — 重新打开旧会话而不是创建新的，保留历史消息
- `converse:new` 事件让两个客户端立刻在会话列表中看到新的 DM

---

## 1.4 POST `/api/v1/friends/reject/:requestId` — 拒绝好友请求

将 FriendRequest.status 设为 REJECTED。不通知发送方（避免社交压力）。

### Service 方法

```typescript
// apps/server/src/friends/friends.service.ts — reject

async reject(currentUserId: string, requestId: string) {
  const friendRequest = await this.prisma.friendRequest.findUnique({
    where: { id: requestId },
  });

  if (!friendRequest) {
    throw new NotFoundException('Friend request not found');
  }

  if (friendRequest.receiverId !== currentUserId) {
    throw new ForbiddenException('You can only reject requests sent to you');
  }

  if (friendRequest.status !== 'PENDING') {
    throw new ConflictException('Friend request is no longer pending');
  }

  const updated = await this.prisma.friendRequest.update({
    where: { id: requestId },
    data: { status: 'REJECTED' },
  });

  this.logger.log(
    `Friend request rejected: ${friendRequest.senderId} → ${currentUserId} (requestId: ${requestId})`,
  );

  return { id: updated.id, status: 'REJECTED' };
}
```

### Controller 方法

```typescript
// apps/server/src/friends/friends.controller.ts — reject

/** POST /api/v1/friends/reject/:requestId — 拒绝好友请求 */
@Post('reject/:requestId')
@HttpCode(HttpStatus.OK)
rejectRequest(
  @Param('requestId') requestId: string,
  @CurrentUser('userId') userId: string,
) {
  return this.friendsService.reject(userId, requestId);
}
```

**设计决策**：拒绝不通知发送方。这是大多数社交 App 的做法（微信、Discord 都不通知）。发送方只看到"已发送"，不知道对方是拒绝了还是没看到。

---

## 1.5 GET `/api/v1/friends` — 好友列表

双向查询 Friendship 表（`WHERE userAId = :me OR userBId = :me`），返回好友的用户信息 + 在线状态。

### DTO

```typescript
// apps/server/src/friends/dto/friend-response.dto.ts

export class FriendResponseDto {
  id: string;            // userId of the friend
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE';
  converseId?: string;   // DM 会话 ID（方便客户端直接跳转聊天）
}
```

### Service 方法

```typescript
// apps/server/src/friends/friends.service.ts — getFriendList

async getFriendList(userId: string): Promise<FriendResponseDto[]> {
  // 1. 双向查询好友关系
  const friendships = await this.prisma.friendship.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
    },
    include: {
      userA: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          status: true,
        },
      },
      userB: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          status: true,
        },
      },
    },
  });

  // 2. 提取"对方"用户信息
  const friendUserIds: string[] = [];
  const friendMap = new Map<string, {
    user: { id: string; username: string; displayName: string; avatarUrl: string | null; status: string };
  }>();

  for (const f of friendships) {
    const friend = f.userAId === userId ? f.userB : f.userA;
    friendMap.set(friend.id, { user: friend });
    friendUserIds.push(friend.id);
  }

  // 3. 批量查询 DM 会话 ID（方便客户端快速跳转）
  const dmConverses = await this.prisma.converseMember.findMany({
    where: {
      userId,
      converse: { type: 'DM' },
      isOpen: true,
    },
    include: {
      converse: {
        include: {
          members: {
            where: { userId: { not: userId } },
            select: { userId: true },
          },
        },
      },
    },
  });

  // 建立 friendUserId → converseId 映射
  const dmMap = new Map<string, string>();
  for (const cm of dmConverses) {
    const otherMember = cm.converse.members[0];
    if (otherMember) {
      dmMap.set(otherMember.userId, cm.converseId);
    }
  }

  // 4. 组装响应
  return friendUserIds.map((friendId) => {
    const entry = friendMap.get(friendId)!;
    return {
      id: entry.user.id,
      username: entry.user.username,
      displayName: entry.user.displayName,
      avatarUrl: entry.user.avatarUrl,
      status: entry.user.status as 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE',
      converseId: dmMap.get(friendId),
    };
  });
}
```

### Controller 方法

```typescript
// apps/server/src/friends/friends.controller.ts — getFriendList

/** GET /api/v1/friends — 好友列表 */
@Get()
getFriendList(@CurrentUser('userId') userId: string) {
  return this.friendsService.getFriendList(userId);
}
```

**响应格式**（200 OK）：

```json
[
  {
    "id": "cm1user2...",
    "username": "alice",
    "displayName": "Alice",
    "avatarUrl": "https://...",
    "status": "ONLINE",
    "converseId": "cm1dm..."
  },
  {
    "id": "cm1user3...",
    "username": "bob",
    "displayName": "Bob",
    "avatarUrl": null,
    "status": "OFFLINE",
    "converseId": "cm1dm2..."
  }
]
```

**性能说明**：
- 双向查询使用 `OR` 条件，Prisma 会自动使用 `@@unique([userAId, userBId])` 索引
- DM 会话 ID 通过一次额外查询获取，避免 N+1（不是逐个好友查）
- 在线状态目前读取 User.status 字段（Phase 3 将切换到 Redis 查询）

---

## 1.6 DELETE `/api/v1/friends/:userId` — 删除好友

删除 Friendship + 关闭 DM 会话（`isOpen=false`），通知双方。

### Service 方法

```typescript
// apps/server/src/friends/friends.service.ts — removeFriend

async removeFriend(currentUserId: string, targetUserId: string) {
  // 1. 归一化 ID 查找好友关系
  const [userAId, userBId] = this.normalizeFriendshipIds(
    currentUserId,
    targetUserId,
  );

  const friendship = await this.prisma.friendship.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
  });

  if (!friendship) {
    throw new NotFoundException('Friendship not found');
  }

  // 2. 事务：删除好友关系 + 关闭 DM 会话
  await this.prisma.$transaction(async (tx) => {
    // 2a. 删除好友关系
    await tx.friendship.delete({
      where: { id: friendship.id },
    });

    // 2b. 查找并关闭 DM 会话（不删除，保留历史消息）
    const dmConverse = await tx.converse.findFirst({
      where: {
        type: 'DM',
        AND: [
          { members: { some: { userId: currentUserId } } },
          { members: { some: { userId: targetUserId } } },
        ],
      },
    });

    if (dmConverse) {
      await tx.converseMember.updateMany({
        where: { converseId: dmConverse.id },
        data: { isOpen: false },
      });
    }
  });

  // 3. WS 通知双方
  this.broadcast.unicast(currentUserId, 'friend:removed', {
    userId: targetUserId,
  });
  this.broadcast.unicast(targetUserId, 'friend:removed', {
    userId: currentUserId,
  });

  this.logger.log(
    `Friendship removed: ${currentUserId} ↔ ${targetUserId}`,
  );

  return { success: true };
}
```

### Controller 方法

```typescript
// apps/server/src/friends/friends.controller.ts — removeFriend

/** DELETE /api/v1/friends/:userId — 删除好友 */
@Delete(':userId')
@HttpCode(HttpStatus.OK)
removeFriend(
  @Param('userId') targetUserId: string,
  @CurrentUser('userId') userId: string,
) {
  return this.friendsService.removeFriend(userId, targetUserId);
}
```

**设计决策**：
- DM 会话不删除，只设 `isOpen=false` — 如果双方日后重新加为好友，历史消息还在
- 双方都收到 `friend:removed` 事件，客户端收到后从好友列表中移除对方
- 参数是 `userId`（对方的用户 ID），不是 `friendshipId` — 对客户端更直观

---

## 1.7 POST `/api/v1/friends/block/:userId` — 拉黑用户

创建 UserBlock + 自动删除好友关系（如果存在）。被拉黑方无法发送好友请求。

### Service 方法

```typescript
// apps/server/src/friends/friends.service.ts — blockUser

async blockUser(blockerId: string, blockedId: string) {
  // 1. 不能拉黑自己
  if (blockerId === blockedId) {
    throw new BadRequestException('Cannot block yourself');
  }

  // 2. 检查被拉黑者是否存在
  const blockedUser = await this.prisma.user.findUnique({
    where: { id: blockedId },
    select: { id: true },
  });

  if (!blockedUser) {
    throw new NotFoundException('User not found');
  }

  // 3. 检查是否已经拉黑
  const existingBlock = await this.prisma.userBlock.findFirst({
    where: { blockerId, blockedId },
  });

  if (existingBlock) {
    throw new ConflictException('User already blocked');
  }

  // 4. 事务：创建拉黑记录 + 删除好友关系（如存在）+ 删除待处理请求
  await this.prisma.$transaction(async (tx) => {
    // 4a. 创建 UserBlock
    await tx.userBlock.create({
      data: { blockerId, blockedId },
    });

    // 4b. 删除好友关系（如果存在）
    const [userAId, userBId] = this.normalizeFriendshipIds(blockerId, blockedId);
    const friendship = await tx.friendship.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
    });

    if (friendship) {
      await tx.friendship.delete({
        where: { id: friendship.id },
      });

      // 关闭 DM 会话
      const dmConverse = await tx.converse.findFirst({
        where: {
          type: 'DM',
          AND: [
            { members: { some: { userId: blockerId } } },
            { members: { some: { userId: blockedId } } },
          ],
        },
      });

      if (dmConverse) {
        await tx.converseMember.updateMany({
          where: { converseId: dmConverse.id },
          data: { isOpen: false },
        });
      }
    }

    // 4c. 删除双方之间所有待处理的好友请求
    await tx.friendRequest.deleteMany({
      where: {
        OR: [
          { senderId: blockerId, receiverId: blockedId, status: 'PENDING' },
          { senderId: blockedId, receiverId: blockerId, status: 'PENDING' },
        ],
      },
    });
  });

  // 5. 如果之前是好友，通知被拉黑方（好友被移除）
  // 注意：不告诉对方"你被拉黑了"，只告诉"好友关系解除了"
  this.broadcast.unicast(blockedId, 'friend:removed', {
    userId: blockerId,
  });

  this.logger.log(`User blocked: ${blockerId} blocked ${blockedId}`);

  return { success: true };
}
```

### Controller 方法

```typescript
// apps/server/src/friends/friends.controller.ts — blockUser

/** POST /api/v1/friends/block/:userId — 拉黑用户 */
@Post('block/:userId')
@HttpCode(HttpStatus.OK)
blockUser(
  @Param('userId') blockedId: string,
  @CurrentUser('userId') userId: string,
) {
  return this.friendsService.blockUser(userId, blockedId);
}
```

**设计决策**：
- 拉黑动作对被拉黑方不可见 — 对方只看到好友被移除，不知道是"删除"还是"拉黑"
- 同时清理双方之间的所有 PENDING 请求，避免拉黑后对方的请求还挂着
- 如果之前不是好友，拉黑只创建 UserBlock 记录，不触发任何 WS 事件

---

## 1.8 WS 事件广播 — BroadcastService 集成

所有 WS 事件已在 1.2 - 1.7 的 Service 方法中通过 BroadcastService 发出。此节汇总事件定义和客户端处理。

### WS 事件协议（新增到 ws-protocol）

```typescript
// packages/ws-protocol/src/events.ts — 新增

export const FRIEND_EVENTS = {
  // Server → Client
  REQUEST:  'friend:request',    // 收到好友请求
  ACCEPTED: 'friend:accepted',   // 好友请求被接受（双方）
  REMOVED:  'friend:removed',    // 好友关系删除（双方）
} as const;

export const CONVERSE_EVENTS = {
  // Server → Client
  NEW:     'converse:new',       // 新会话创建
  UPDATED: 'converse:updated',   // 会话更新
} as const;
```

### WS Payload 类型

```typescript
// packages/ws-protocol/src/payloads/chat.payloads.ts — 新增

export interface FriendRequestPayload {
  id: string;              // FriendRequest ID
  sender: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  message: string | null;
  createdAt: string;       // ISO 8601
}

export interface FriendAcceptedPayload {
  friendId: string;        // 新好友的 userId
  friend: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
}

export interface FriendRemovedPayload {
  userId: string;          // 被移除/被拉黑的好友的 userId
}

export interface ConverseNewPayload {
  id: string;              // Converse ID
  type: 'DM' | 'MULTI' | 'GROUP';
  members: Array<{
    userId: string;
    isOpen: boolean;
  }>;
  createdAt: string;       // ISO 8601
}
```

### BroadcastService 方法回顾

```typescript
// apps/server/src/gateway/broadcast.service.ts — 已有实现（Phase 0 / Sprint 1）

@Injectable()
export class BroadcastService {
  private server: Server;

  setServer(server: Server) {
    this.server = server;
  }

  /** 发送到单个用户的所有连接（个人房间 u-{userId}） */
  unicast(userId: string, event: string, data: unknown) {
    this.server.to(`u-${userId}`).emit(event, data);
  }

  /** 发送到多个用户 */
  listcast(userIds: string[], event: string, data: unknown) {
    const rooms = userIds.map(id => `u-${id}`);
    this.server.to(rooms).emit(event, data);
  }

  /** 发送到特定房间 */
  roomcast(roomId: string, event: string, data: unknown) {
    this.server.to(roomId).emit(event, data);
  }
}
```

### 事件调用汇总表

| 触发动作 | 事件名 | 目标 | Payload | 调用位置 |
|---------|--------|------|---------|---------|
| 发送好友请求 | `friend:request` | `u-{receiverId}` | FriendRequestPayload | sendRequest() |
| 接受好友请求 | `friend:accepted` | `u-{senderId}` + `u-{receiverId}` | FriendAcceptedPayload | accept() |
| 接受好友请求 | `converse:new` | `u-{senderId}` + `u-{receiverId}` | ConverseNewPayload | accept() |
| 删除好友 | `friend:removed` | `u-{currentUser}` + `u-{targetUser}` | FriendRemovedPayload | removeFriend() |
| 拉黑用户 | `friend:removed` | `u-{blockedId}` | FriendRemovedPayload | blockUser() |

---

## 1.9 GET `/api/v1/friends/requests` — 待处理请求列表

返回当前用户的待处理请求，分为 `sent`（我发出的）和 `received`（我收到的）两组。

### Service 方法

```typescript
// apps/server/src/friends/friends.service.ts — getPendingRequests

async getPendingRequests(userId: string) {
  const [sent, received] = await Promise.all([
    // 我发出的待处理请求
    this.prisma.friendRequest.findMany({
      where: { senderId: userId, status: 'PENDING' },
      include: {
        receiver: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),

    // 我收到的待处理请求
    this.prisma.friendRequest.findMany({
      where: { receiverId: userId, status: 'PENDING' },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    sent: sent.map((r) => ({
      id: r.id,
      user: r.receiver,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    })),
    received: received.map((r) => ({
      id: r.id,
      user: r.sender,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
```

### Controller 方法

```typescript
// apps/server/src/friends/friends.controller.ts — getPendingRequests

/** GET /api/v1/friends/requests — 待处理的好友请求 */
@Get('requests')
getPendingRequests(@CurrentUser('userId') userId: string) {
  return this.friendsService.getPendingRequests(userId);
}
```

**响应格式**（200 OK）：

```json
{
  "sent": [
    {
      "id": "cm1req1...",
      "user": {
        "id": "cm1bob...",
        "username": "bob",
        "displayName": "Bob",
        "avatarUrl": null
      },
      "message": "Hi Bob!",
      "createdAt": "2026-02-14T10:30:00.000Z"
    }
  ],
  "received": [
    {
      "id": "cm1req2...",
      "user": {
        "id": "cm1charlie...",
        "username": "charlie",
        "displayName": "Charlie",
        "avatarUrl": "https://..."
      },
      "message": null,
      "createdAt": "2026-02-14T11:00:00.000Z"
    }
  ]
}
```

**路由注意**：`GET /friends/requests` 必须在 `GET /friends/:userId` 之前注册，否则 NestJS 会把 `requests` 当作 `:userId` 参数。当前 controller 只有 `DELETE /friends/:userId`，不冲突。如果日后加了 `GET /friends/:userId` 端点，需注意路由顺序。

---

## 1.10 单元测试 — friends.service.spec.ts

使用 Jest + NestJS Testing 模块，Mock Prisma 和 BroadcastService。

```typescript
// apps/server/src/friends/friends.service.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { FriendsService } from './friends.service';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService } from '../gateway/broadcast.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

describe('FriendsService', () => {
  let service: FriendsService;
  let prisma: jest.Mocked<PrismaService>;
  let broadcast: jest.Mocked<BroadcastService>;

  const mockPrisma = {
    user: { findUnique: jest.fn() },
    friendRequest: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    friendship: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    userBlock: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    converse: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    converseMember: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((fn) => fn(mockPrisma)),
  };

  const mockBroadcast = {
    unicast: jest.fn(),
    listcast: jest.fn(),
    roomcast: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BroadcastService, useValue: mockBroadcast },
      ],
    }).compile();

    service = module.get<FriendsService>(FriendsService);
    prisma = module.get(PrismaService);
    broadcast = module.get(BroadcastService);

    // 每个测试前清空 mock 调用记录
    jest.clearAllMocks();
  });

  describe('sendRequest', () => {
    it('should throw BadRequestException when sending to self', async () => {
      await expect(
        service.sendRequest('user1', { receiverId: 'user1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when receiver does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.sendRequest('user1', { receiverId: 'user2' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when already friends', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user2' });
      mockPrisma.userBlock.findFirst.mockResolvedValue(null);
      mockPrisma.friendship.findUnique.mockResolvedValue({
        id: 'f1',
        userAId: 'user1',
        userBId: 'user2',
      });

      await expect(
        service.sendRequest('user1', { receiverId: 'user2' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when duplicate request', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user2' });
      mockPrisma.userBlock.findFirst.mockResolvedValue(null);
      mockPrisma.friendship.findUnique.mockResolvedValue(null);
      mockPrisma.friendRequest.findFirst.mockResolvedValue({
        id: 'req1',
        senderId: 'user1',
        receiverId: 'user2',
        status: 'PENDING',
      });

      await expect(
        service.sendRequest('user1', { receiverId: 'user2' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create request and broadcast to receiver', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user2',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
      });
      mockPrisma.userBlock.findFirst.mockResolvedValue(null);
      mockPrisma.friendship.findUnique.mockResolvedValue(null);
      mockPrisma.friendRequest.findFirst.mockResolvedValue(null);
      mockPrisma.friendRequest.create.mockResolvedValue({
        id: 'req1',
        senderId: 'user1',
        receiverId: 'user2',
        message: 'Hi!',
        status: 'PENDING',
        createdAt: new Date('2026-02-14T10:00:00Z'),
        sender: {
          id: 'user1',
          username: 'bob',
          displayName: 'Bob',
          avatarUrl: null,
        },
      });

      const result = await service.sendRequest('user1', {
        receiverId: 'user2',
        message: 'Hi!',
      });

      expect(result.id).toBe('req1');
      expect(result.status).toBe('PENDING');
      expect(mockBroadcast.unicast).toHaveBeenCalledWith(
        'user2',
        'friend:request',
        expect.objectContaining({ id: 'req1' }),
      );
    });
  });

  describe('accept', () => {
    it('should throw ForbiddenException when not the receiver', async () => {
      mockPrisma.friendRequest.findUnique.mockResolvedValue({
        id: 'req1',
        senderId: 'user1',
        receiverId: 'user3',
        status: 'PENDING',
      });

      await expect(
        service.accept('user2', 'req1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should create friendship with normalized IDs', async () => {
      // user2 accepts request from user1
      // normalization: sort(['user1', 'user2']) → userAId='user1', userBId='user2'
      mockPrisma.friendRequest.findUnique.mockResolvedValue({
        id: 'req1',
        senderId: 'user1',
        receiverId: 'user2',
        status: 'PENDING',
        sender: { id: 'user1', username: 'a', displayName: 'A', avatarUrl: null },
        receiver: { id: 'user2', username: 'b', displayName: 'B', avatarUrl: null },
      });
      mockPrisma.friendRequest.delete.mockResolvedValue({});
      mockPrisma.friendship.create.mockResolvedValue({
        id: 'f1',
        userAId: 'user1',
        userBId: 'user2',
      });
      mockPrisma.converse.findFirst.mockResolvedValue(null);
      mockPrisma.converse.create.mockResolvedValue({
        id: 'dm1',
        type: 'DM',
        createdAt: new Date(),
        members: [
          { userId: 'user1', isOpen: true },
          { userId: 'user2', isOpen: true },
        ],
      });

      const result = await service.accept('user2', 'req1');

      expect(result.friendshipId).toBe('f1');
      expect(result.converseId).toBe('dm1');

      // 验证 friendship.create 使用了归一化的 ID
      expect(mockPrisma.friendship.create).toHaveBeenCalledWith({
        data: { userAId: 'user1', userBId: 'user2' },
      });

      // 验证双方都收到通知
      expect(mockBroadcast.unicast).toHaveBeenCalledTimes(2);
      expect(mockBroadcast.listcast).toHaveBeenCalledWith(
        ['user1', 'user2'],
        'converse:new',
        expect.objectContaining({ id: 'dm1', type: 'DM' }),
      );
    });
  });

  describe('normalizeFriendshipIds', () => {
    it('should put smaller ID in userAId', () => {
      // 通过 sendRequest + accept 间接测试
      // 直接测试 private 方法需要 (service as any).normalizeFriendshipIds
      const result = (service as any).normalizeFriendshipIds('zzz', 'aaa');
      expect(result).toEqual(['aaa', 'zzz']);
    });

    it('should handle equal IDs', () => {
      const result = (service as any).normalizeFriendshipIds('same', 'same');
      expect(result).toEqual(['same', 'same']);
    });
  });

  describe('reject', () => {
    it('should update status to REJECTED', async () => {
      mockPrisma.friendRequest.findUnique.mockResolvedValue({
        id: 'req1',
        senderId: 'user1',
        receiverId: 'user2',
        status: 'PENDING',
      });
      mockPrisma.friendRequest.update.mockResolvedValue({
        id: 'req1',
        status: 'REJECTED',
      });

      const result = await service.reject('user2', 'req1');
      expect(result.status).toBe('REJECTED');
    });

    it('should not send WS notification on reject', async () => {
      mockPrisma.friendRequest.findUnique.mockResolvedValue({
        id: 'req1',
        senderId: 'user1',
        receiverId: 'user2',
        status: 'PENDING',
      });
      mockPrisma.friendRequest.update.mockResolvedValue({
        id: 'req1',
        status: 'REJECTED',
      });

      await service.reject('user2', 'req1');
      expect(mockBroadcast.unicast).not.toHaveBeenCalled();
    });
  });

  describe('removeFriend', () => {
    it('should delete friendship and close DM', async () => {
      mockPrisma.friendship.findUnique.mockResolvedValue({
        id: 'f1',
        userAId: 'user1',
        userBId: 'user2',
      });
      mockPrisma.friendship.delete.mockResolvedValue({});
      mockPrisma.converse.findFirst.mockResolvedValue({ id: 'dm1' });
      mockPrisma.converseMember.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.removeFriend('user1', 'user2');
      expect(result.success).toBe(true);

      // 验证双方都收到 friend:removed
      expect(mockBroadcast.unicast).toHaveBeenCalledWith(
        'user1',
        'friend:removed',
        { userId: 'user2' },
      );
      expect(mockBroadcast.unicast).toHaveBeenCalledWith(
        'user2',
        'friend:removed',
        { userId: 'user1' },
      );
    });
  });

  describe('blockUser', () => {
    it('should throw BadRequestException when blocking self', async () => {
      await expect(
        service.blockUser('user1', 'user1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create block and delete friendship if exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user2' });
      mockPrisma.userBlock.findFirst.mockResolvedValue(null);
      mockPrisma.userBlock.create.mockResolvedValue({});
      mockPrisma.friendship.findUnique.mockResolvedValue({
        id: 'f1',
        userAId: 'user1',
        userBId: 'user2',
      });
      mockPrisma.friendship.delete.mockResolvedValue({});
      mockPrisma.converse.findFirst.mockResolvedValue({ id: 'dm1' });
      mockPrisma.converseMember.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.friendRequest.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.blockUser('user1', 'user2');
      expect(result.success).toBe(true);

      // 验证只通知被拉黑方（且用 friend:removed 而非 friend:blocked）
      expect(mockBroadcast.unicast).toHaveBeenCalledWith(
        'user2',
        'friend:removed',
        { userId: 'user1' },
      );
      expect(mockBroadcast.unicast).toHaveBeenCalledTimes(1);
    });
  });
});
```

**测试要点**：
- Mock `PrismaService` 和 `BroadcastService`，测试纯业务逻辑
- `$transaction` mock 直接执行回调函数（`(fn) => fn(mockPrisma)`），模拟事务行为
- 重点覆盖：边界条件（自己加自己、重复请求、已是好友）+ WS 事件正确性
- `normalizeFriendshipIds` 通过 `(service as any)` 直接测试 private 方法

---

## Flutter UI — 好友系统

### 数据模型

```dart
// apps/mobile/lib/features/friends/models/friend.dart

class Friend {
  final String id;
  final String username;
  final String displayName;
  final String? avatarUrl;
  final String status; // ONLINE, IDLE, DND, OFFLINE
  final String? converseId;

  Friend({
    required this.id,
    required this.username,
    required this.displayName,
    this.avatarUrl,
    required this.status,
    this.converseId,
  });

  factory Friend.fromJson(Map<String, dynamic> json) {
    return Friend(
      id: json['id'] as String,
      username: json['username'] as String,
      displayName: json['displayName'] as String,
      avatarUrl: json['avatarUrl'] as String?,
      status: json['status'] as String? ?? 'OFFLINE',
      converseId: json['converseId'] as String?,
    );
  }

  bool get isOnline => status == 'ONLINE' || status == 'IDLE' || status == 'DND';
}
```

```dart
// apps/mobile/lib/features/friends/models/friend_request.dart

class FriendRequest {
  final String id;
  final Map<String, dynamic> user; // { id, username, displayName, avatarUrl }
  final String? message;
  final String createdAt;

  FriendRequest({
    required this.id,
    required this.user,
    this.message,
    required this.createdAt,
  });

  factory FriendRequest.fromJson(Map<String, dynamic> json) {
    return FriendRequest(
      id: json['id'] as String,
      user: json['user'] as Map<String, dynamic>,
      message: json['message'] as String?,
      createdAt: json['createdAt'] as String,
    );
  }

  String get displayName => user['displayName'] as String? ?? user['username'] as String;
  String? get avatarUrl => user['avatarUrl'] as String?;
}
```

### Providers

```dart
// apps/mobile/lib/features/friends/providers/friends_provider.dart

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/ws_service.dart';
import '../models/friend.dart';

class FriendsNotifier extends StateNotifier<AsyncValue<List<Friend>>> {
  final ApiClient _api;
  final WsService _ws;

  FriendsNotifier(this._api, this._ws) : super(const AsyncValue.loading()) {
    _loadFriends();
    _listenWsEvents();
  }

  Future<void> _loadFriends() async {
    try {
      final response = await _api.get('/api/v1/friends');
      final friends = (response.data as List)
          .map((json) => Friend.fromJson(json))
          .toList();
      state = AsyncValue.data(friends);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  void _listenWsEvents() {
    // 新好友接受
    _ws.on('friend:accepted', (data) {
      final friendData = data['friend'] as Map<String, dynamic>;
      final newFriend = Friend.fromJson(friendData);
      state.whenData((friends) {
        state = AsyncValue.data([...friends, newFriend]);
      });
    });

    // 好友被移除
    _ws.on('friend:removed', (data) {
      final removedUserId = data['userId'] as String;
      state.whenData((friends) {
        state = AsyncValue.data(
          friends.where((f) => f.id != removedUserId).toList(),
        );
      });
    });
  }

  Future<void> refresh() => _loadFriends();

  Future<void> sendRequest(String receiverId, {String? message}) async {
    await _api.post('/api/v1/friends/request', data: {
      'receiverId': receiverId,
      if (message != null) 'message': message,
    });
  }

  Future<void> removeFriend(String userId) async {
    await _api.delete('/api/v1/friends/$userId');
    // WS 事件会自动触发列表更新
  }

  Future<void> blockUser(String userId) async {
    await _api.post('/api/v1/friends/block/$userId');
    // WS 事件会自动触发列表更新
  }
}

final friendsProvider =
    StateNotifierProvider<FriendsNotifier, AsyncValue<List<Friend>>>((ref) {
  final api = ref.watch(apiClientProvider);
  final ws = ref.watch(wsServiceProvider);
  return FriendsNotifier(api, ws);
});
```

```dart
// apps/mobile/lib/features/friends/providers/friend_requests_provider.dart

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/ws_service.dart';
import '../models/friend_request.dart';

class FriendRequestsState {
  final List<FriendRequest> sent;
  final List<FriendRequest> received;

  FriendRequestsState({this.sent = const [], this.received = const []});
}

class FriendRequestsNotifier extends StateNotifier<AsyncValue<FriendRequestsState>> {
  final ApiClient _api;
  final WsService _ws;

  FriendRequestsNotifier(this._api, this._ws)
      : super(const AsyncValue.loading()) {
    _loadRequests();
    _listenWsEvents();
  }

  Future<void> _loadRequests() async {
    try {
      final response = await _api.get('/api/v1/friends/requests');
      final data = response.data as Map<String, dynamic>;
      final sent = (data['sent'] as List)
          .map((json) => FriendRequest.fromJson(json))
          .toList();
      final received = (data['received'] as List)
          .map((json) => FriendRequest.fromJson(json))
          .toList();
      state = AsyncValue.data(FriendRequestsState(sent: sent, received: received));
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  void _listenWsEvents() {
    // 收到新好友请求
    _ws.on('friend:request', (data) {
      final request = FriendRequest.fromJson(data);
      state.whenData((current) {
        state = AsyncValue.data(FriendRequestsState(
          sent: current.sent,
          received: [request, ...current.received],
        ));
      });
    });

    // 好友请求被对方接受（从 sent 列表移除）
    _ws.on('friend:accepted', (data) {
      final friendId = data['friendId'] as String;
      state.whenData((current) {
        state = AsyncValue.data(FriendRequestsState(
          sent: current.sent.where((r) => r.user['id'] != friendId).toList(),
          received: current.received,
        ));
      });
    });
  }

  Future<void> refresh() => _loadRequests();

  Future<void> acceptRequest(String requestId) async {
    await _api.post('/api/v1/friends/accept/$requestId');
    // 移除已处理的请求
    state.whenData((current) {
      state = AsyncValue.data(FriendRequestsState(
        sent: current.sent,
        received: current.received.where((r) => r.id != requestId).toList(),
      ));
    });
  }

  Future<void> rejectRequest(String requestId) async {
    await _api.post('/api/v1/friends/reject/$requestId');
    state.whenData((current) {
      state = AsyncValue.data(FriendRequestsState(
        sent: current.sent,
        received: current.received.where((r) => r.id != requestId).toList(),
      ));
    });
  }
}

final friendRequestsProvider =
    StateNotifierProvider<FriendRequestsNotifier, AsyncValue<FriendRequestsState>>((ref) {
  final api = ref.watch(apiClientProvider);
  final ws = ref.watch(wsServiceProvider);
  return FriendRequestsNotifier(api, ws);
});
```

### WS 事件常量（Dart 镜像）

```dart
// apps/mobile/lib/core/constants/ws_events.dart — 新增

class WsFriendEvents {
  static const request  = 'friend:request';
  static const accepted = 'friend:accepted';
  static const removed  = 'friend:removed';
}

class WsConverseEvents {
  static const newConverse = 'converse:new';
  static const updated     = 'converse:updated';
}
```

### FriendListPage

```dart
// apps/mobile/lib/features/friends/pages/friend_list_page.dart

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/friends_provider.dart';
import '../widgets/friend_tile.dart';

class FriendListPage extends ConsumerWidget {
  const FriendListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final friendsAsync = ref.watch(friendsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Friends'),
        actions: [
          // 好友请求页面入口
          IconButton(
            icon: const Icon(Icons.person_add),
            onPressed: () => context.push('/friends/requests'),
          ),
        ],
      ),
      body: friendsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Error: $err')),
        data: (friends) {
          if (friends.isEmpty) {
            return const Center(
              child: Text('No friends yet.\nTap + to add friends!'),
            );
          }

          // 在线的排前面
          final sorted = [...friends]..sort((a, b) {
            if (a.isOnline && !b.isOnline) return -1;
            if (!a.isOnline && b.isOnline) return 1;
            return a.displayName.compareTo(b.displayName);
          });

          return RefreshIndicator(
            onRefresh: () => ref.read(friendsProvider.notifier).refresh(),
            child: ListView.builder(
              itemCount: sorted.length,
              itemBuilder: (context, index) {
                final friend = sorted[index];
                return FriendTile(
                  friend: friend,
                  onTap: () {
                    if (friend.converseId != null) {
                      context.push('/chat/${friend.converseId}');
                    }
                  },
                  onRemove: () {
                    ref.read(friendsProvider.notifier).removeFriend(friend.id);
                  },
                  onBlock: () {
                    ref.read(friendsProvider.notifier).blockUser(friend.id);
                  },
                );
              },
            ),
          );
        },
      ),
    );
  }
}
```

### FriendTile Widget

```dart
// apps/mobile/lib/features/friends/widgets/friend_tile.dart

import 'package:flutter/material.dart';
import '../models/friend.dart';

class FriendTile extends StatelessWidget {
  final Friend friend;
  final VoidCallback onTap;
  final VoidCallback onRemove;
  final VoidCallback onBlock;

  const FriendTile({
    super.key,
    required this.friend,
    required this.onTap,
    required this.onRemove,
    required this.onBlock,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Stack(
        children: [
          CircleAvatar(
            backgroundImage: friend.avatarUrl != null
                ? NetworkImage(friend.avatarUrl!)
                : null,
            child: friend.avatarUrl == null
                ? Text(friend.displayName[0].toUpperCase())
                : null,
          ),
          // 在线状态指示器
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _statusColor(friend.status),
                border: Border.all(
                  color: Theme.of(context).scaffoldBackgroundColor,
                  width: 2,
                ),
              ),
            ),
          ),
        ],
      ),
      title: Text(friend.displayName),
      subtitle: Text('@${friend.username}'),
      trailing: PopupMenuButton<String>(
        onSelected: (value) {
          if (value == 'remove') onRemove();
          if (value == 'block') onBlock();
        },
        itemBuilder: (context) => [
          const PopupMenuItem(value: 'remove', child: Text('Remove friend')),
          const PopupMenuItem(value: 'block', child: Text('Block user')),
        ],
      ),
      onTap: onTap,
    );
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'ONLINE':
        return Colors.green;
      case 'IDLE':
        return Colors.amber;
      case 'DND':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }
}
```

### FriendRequestsPage

```dart
// apps/mobile/lib/features/friends/pages/friend_requests_page.dart

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/friend_requests_provider.dart';
import '../widgets/friend_request_card.dart';

class FriendRequestsPage extends ConsumerWidget {
  const FriendRequestsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final requestsAsync = ref.watch(friendRequestsProvider);

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Friend Requests'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Received'),
              Tab(text: 'Sent'),
            ],
          ),
        ),
        body: requestsAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (err, _) => Center(child: Text('Error: $err')),
          data: (state) {
            return TabBarView(
              children: [
                // 收到的请求 — 可以接受/拒绝
                _buildRequestList(
                  context,
                  ref,
                  state.received,
                  isReceived: true,
                ),
                // 发出的请求 — 只能查看状态
                _buildRequestList(
                  context,
                  ref,
                  state.sent,
                  isReceived: false,
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildRequestList(
    BuildContext context,
    WidgetRef ref,
    List requests,
    {required bool isReceived}
  ) {
    if (requests.isEmpty) {
      return const Center(child: Text('No requests'));
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(friendRequestsProvider.notifier).refresh(),
      child: ListView.builder(
        itemCount: requests.length,
        itemBuilder: (context, index) {
          final request = requests[index];
          return FriendRequestCard(
            request: request,
            isReceived: isReceived,
            onAccept: isReceived
                ? () => ref
                    .read(friendRequestsProvider.notifier)
                    .acceptRequest(request.id)
                : null,
            onReject: isReceived
                ? () => ref
                    .read(friendRequestsProvider.notifier)
                    .rejectRequest(request.id)
                : null,
          );
        },
      ),
    );
  }
}
```

### 路由更新

```dart
// apps/mobile/lib/router.dart — 新增好友相关路由

GoRoute(
  path: '/friends',
  builder: (context, state) => const FriendListPage(),
),
GoRoute(
  path: '/friends/requests',
  builder: (context, state) => const FriendRequestsPage(),
),
```

### 导航更新

在主界面底部导航栏中添加 Friends tab：

```dart
// apps/mobile/lib/app.dart 或 main navigation — 新增 tab

BottomNavigationBarItem(
  icon: Icon(Icons.people),
  label: 'Friends',
),
```

---

## Desktop UI — 好友系统

### IPC Handler

```typescript
// apps/desktop/src/main/ipc/friends.ipc.ts

import { ipcMain } from 'electron';
import { ApiService } from '../services/api.service';

export function registerFriendsIpc(api: ApiService) {
  // 获取好友列表
  ipcMain.handle('friends:list', async () => {
    const response = await api.get('/api/v1/friends');
    return response.data;
  });

  // 获取待处理请求
  ipcMain.handle('friends:requests', async () => {
    const response = await api.get('/api/v1/friends/requests');
    return response.data;
  });

  // 发送好友请求
  ipcMain.handle(
    'friends:request',
    async (_, data: { receiverId: string; message?: string }) => {
      const response = await api.post('/api/v1/friends/request', data);
      return response.data;
    },
  );

  // 接受好友请求
  ipcMain.handle('friends:accept', async (_, requestId: string) => {
    const response = await api.post(`/api/v1/friends/accept/${requestId}`);
    return response.data;
  });

  // 拒绝好友请求
  ipcMain.handle('friends:reject', async (_, requestId: string) => {
    const response = await api.post(`/api/v1/friends/reject/${requestId}`);
    return response.data;
  });

  // 删除好友
  ipcMain.handle('friends:remove', async (_, userId: string) => {
    const response = await api.delete(`/api/v1/friends/${userId}`);
    return response.data;
  });

  // 拉黑用户
  ipcMain.handle('friends:block', async (_, userId: string) => {
    const response = await api.post(`/api/v1/friends/block/${userId}`);
    return response.data;
  });
}
```

### Preload API

```typescript
// apps/desktop/src/preload/index.ts — 新增 friends 命名空间

friends: {
  list: () => ipcRenderer.invoke('friends:list'),
  getRequests: () => ipcRenderer.invoke('friends:requests'),
  sendRequest: (data: { receiverId: string; message?: string }) =>
    ipcRenderer.invoke('friends:request', data),
  accept: (requestId: string) => ipcRenderer.invoke('friends:accept', requestId),
  reject: (requestId: string) => ipcRenderer.invoke('friends:reject', requestId),
  remove: (userId: string) => ipcRenderer.invoke('friends:remove', userId),
  block: (userId: string) => ipcRenderer.invoke('friends:block', userId),

  // WS 事件监听
  onFriendRequest: (callback: (data: any) => void) =>
    ipcRenderer.on('ws:friend:request', (_, data) => callback(data)),
  onFriendAccepted: (callback: (data: any) => void) =>
    ipcRenderer.on('ws:friend:accepted', (_, data) => callback(data)),
  onFriendRemoved: (callback: (data: any) => void) =>
    ipcRenderer.on('ws:friend:removed', (_, data) => callback(data)),
},
```

### WS 事件转发到渲染进程

```typescript
// apps/desktop/src/main/services/ws-client.service.ts — 新增好友事件转发

// 在 setupChatListeners() 或 setupFriendListeners() 中
chatSocket.on('friend:request', (data) => {
  mainWindow?.webContents.send('ws:friend:request', data);
});

chatSocket.on('friend:accepted', (data) => {
  mainWindow?.webContents.send('ws:friend:accepted', data);
});

chatSocket.on('friend:removed', (data) => {
  mainWindow?.webContents.send('ws:friend:removed', data);
});
```

### Friends Page（React）

```tsx
// apps/desktop/src/renderer/pages/Friends.tsx

import React, { useEffect, useState, useCallback } from 'react';
import { FriendList } from '../components/FriendList';
import { FriendRequestCard } from '../components/FriendRequestCard';

interface Friend {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE';
  converseId?: string;
}

interface FriendRequestItem {
  id: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  message: string | null;
  createdAt: string;
}

type Tab = 'friends' | 'requests';

export const FriendsPage: React.FC = () => {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<{
    sent: FriendRequestItem[];
    received: FriendRequestItem[];
  }>({ sent: [], received: [] });
  const [activeTab, setActiveTab] = useState<Tab>('friends');
  const [loading, setLoading] = useState(true);

  const loadFriends = useCallback(async () => {
    try {
      const data = await window.api.friends.list();
      setFriends(data);
    } catch (err) {
      console.error('Failed to load friends:', err);
    }
  }, []);

  const loadRequests = useCallback(async () => {
    try {
      const data = await window.api.friends.getRequests();
      setRequests(data);
    } catch (err) {
      console.error('Failed to load requests:', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([loadFriends(), loadRequests()]).finally(() =>
      setLoading(false),
    );
  }, [loadFriends, loadRequests]);

  // WS 事件监听
  useEffect(() => {
    window.api.friends.onFriendRequest((data: any) => {
      setRequests((prev) => ({
        ...prev,
        received: [data, ...prev.received],
      }));
    });

    window.api.friends.onFriendAccepted((data: any) => {
      setFriends((prev) => [...prev, data.friend]);
      // 从 sent 列表中移除
      setRequests((prev) => ({
        ...prev,
        sent: prev.sent.filter((r) => r.user.id !== data.friendId),
      }));
    });

    window.api.friends.onFriendRemoved((data: any) => {
      setFriends((prev) => prev.filter((f) => f.id !== data.userId));
    });
  }, []);

  const handleAcceptRequest = async (requestId: string) => {
    await window.api.friends.accept(requestId);
    setRequests((prev) => ({
      ...prev,
      received: prev.received.filter((r) => r.id !== requestId),
    }));
    await loadFriends(); // 刷新好友列表
  };

  const handleRejectRequest = async (requestId: string) => {
    await window.api.friends.reject(requestId);
    setRequests((prev) => ({
      ...prev,
      received: prev.received.filter((r) => r.id !== requestId),
    }));
  };

  const handleRemoveFriend = async (userId: string) => {
    await window.api.friends.remove(userId);
    // WS 事件会自动更新列表
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full">Loading...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab 切换 */}
      <div className="flex border-b">
        <button
          className={`px-4 py-2 ${activeTab === 'friends' ? 'border-b-2 border-blue-500 font-semibold' : ''}`}
          onClick={() => setActiveTab('friends')}
        >
          Friends ({friends.length})
        </button>
        <button
          className={`px-4 py-2 ${activeTab === 'requests' ? 'border-b-2 border-blue-500 font-semibold' : ''}`}
          onClick={() => setActiveTab('requests')}
        >
          Requests ({requests.received.length})
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'friends' ? (
          <FriendList
            friends={friends}
            onRemove={handleRemoveFriend}
          />
        ) : (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase">
              Received ({requests.received.length})
            </h3>
            {requests.received.map((req) => (
              <FriendRequestCard
                key={req.id}
                request={req}
                onAccept={() => handleAcceptRequest(req.id)}
                onReject={() => handleRejectRequest(req.id)}
              />
            ))}

            <h3 className="text-sm font-semibold text-gray-500 uppercase mt-6">
              Sent ({requests.sent.length})
            </h3>
            {requests.sent.map((req) => (
              <FriendRequestCard
                key={req.id}
                request={req}
                isSent
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
```

### FriendList Component

```tsx
// apps/desktop/src/renderer/components/FriendList.tsx

import React from 'react';

interface Friend {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE';
  converseId?: string;
}

interface FriendListProps {
  friends: Friend[];
  onRemove: (userId: string) => void;
}

const statusColors: Record<string, string> = {
  ONLINE: 'bg-green-500',
  IDLE: 'bg-amber-500',
  DND: 'bg-red-500',
  OFFLINE: 'bg-gray-400',
};

export const FriendList: React.FC<FriendListProps> = ({ friends, onRemove }) => {
  // 在线排前面
  const sorted = [...friends].sort((a, b) => {
    const aOnline = a.status !== 'OFFLINE' ? 0 : 1;
    const bOnline = b.status !== 'OFFLINE' ? 0 : 1;
    if (aOnline !== bOnline) return aOnline - bOnline;
    return a.displayName.localeCompare(b.displayName);
  });

  if (sorted.length === 0) {
    return (
      <div className="text-center text-gray-500 mt-8">
        No friends yet. Add someone to get started!
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {sorted.map((friend) => (
        <div
          key={friend.id}
          className="flex items-center p-3 rounded-lg hover:bg-gray-100 cursor-pointer group"
        >
          {/* Avatar + 状态指示器 */}
          <div className="relative mr-3">
            <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center overflow-hidden">
              {friend.avatarUrl ? (
                <img src={friend.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-lg font-medium text-gray-600">
                  {friend.displayName[0].toUpperCase()}
                </span>
              )}
            </div>
            <div
              className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${statusColors[friend.status]}`}
            />
          </div>

          {/* 名字 */}
          <div className="flex-1">
            <div className="font-medium">{friend.displayName}</div>
            <div className="text-sm text-gray-500">@{friend.username}</div>
          </div>

          {/* 操作按钮（hover 显示） */}
          <button
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-2"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(friend.id);
            }}
            title="Remove friend"
          >
            X
          </button>
        </div>
      ))}
    </div>
  );
};
```

### FriendRequestCard Component

```tsx
// apps/desktop/src/renderer/components/FriendRequestCard.tsx

import React from 'react';

interface FriendRequestItem {
  id: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  message: string | null;
  createdAt: string;
}

interface FriendRequestCardProps {
  request: FriendRequestItem;
  isSent?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
}

export const FriendRequestCard: React.FC<FriendRequestCardProps> = ({
  request,
  isSent = false,
  onAccept,
  onReject,
}) => {
  const timeAgo = new Date(request.createdAt).toLocaleDateString();

  return (
    <div className="flex items-center p-3 rounded-lg border bg-white">
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center overflow-hidden mr-3">
        {request.user.avatarUrl ? (
          <img src={request.user.avatarUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-lg font-medium text-gray-600">
            {request.user.displayName[0].toUpperCase()}
          </span>
        )}
      </div>

      {/* 信息 */}
      <div className="flex-1">
        <div className="font-medium">{request.user.displayName}</div>
        <div className="text-sm text-gray-500">@{request.user.username}</div>
        {request.message && (
          <div className="text-sm text-gray-600 mt-1 italic">
            &quot;{request.message}&quot;
          </div>
        )}
        <div className="text-xs text-gray-400 mt-1">{timeAgo}</div>
      </div>

      {/* 操作按钮 */}
      {!isSent && (
        <div className="flex gap-2">
          <button
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
            onClick={onAccept}
          >
            Accept
          </button>
          <button
            className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
            onClick={onReject}
          >
            Reject
          </button>
        </div>
      )}
      {isSent && (
        <span className="text-sm text-gray-400 italic">Pending</span>
      )}
    </div>
  );
};
```

---

## FriendsController 完整代码

将所有端点汇总为完整的 Controller 文件：

```typescript
// apps/server/src/friends/friends.controller.ts

import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FriendsService } from './friends.service';
import { SendFriendRequestDto } from './dto/send-request.dto';

@Controller('api/v1/friends')
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  /** POST /api/v1/friends/request — 发送好友请求 */
  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  sendRequest(
    @CurrentUser('userId') userId: string,
    @Body() dto: SendFriendRequestDto,
  ) {
    return this.friendsService.sendRequest(userId, dto);
  }

  /** POST /api/v1/friends/accept/:requestId — 接受好友请求 */
  @Post('accept/:requestId')
  @HttpCode(HttpStatus.OK)
  acceptRequest(
    @Param('requestId') requestId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.friendsService.accept(userId, requestId);
  }

  /** POST /api/v1/friends/reject/:requestId — 拒绝好友请求 */
  @Post('reject/:requestId')
  @HttpCode(HttpStatus.OK)
  rejectRequest(
    @Param('requestId') requestId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.friendsService.reject(userId, requestId);
  }

  /** GET /api/v1/friends — 好友列表 */
  @Get()
  getFriendList(@CurrentUser('userId') userId: string) {
    return this.friendsService.getFriendList(userId);
  }

  /** GET /api/v1/friends/requests — 待处理好友请求 */
  @Get('requests')
  getPendingRequests(@CurrentUser('userId') userId: string) {
    return this.friendsService.getPendingRequests(userId);
  }

  /** DELETE /api/v1/friends/:userId — 删除好友 */
  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  removeFriend(
    @Param('userId') targetUserId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.friendsService.removeFriend(userId, targetUserId);
  }

  /** POST /api/v1/friends/block/:userId — 拉黑用户 */
  @Post('block/:userId')
  @HttpCode(HttpStatus.OK)
  blockUser(
    @Param('userId') blockedId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.friendsService.blockUser(userId, blockedId);
  }
}
```

**路由注册顺序说明**：NestJS 按照 decorator 定义顺序匹配路由。需确保以下路由不冲突：
- `POST /friends/request` — 固定路径
- `POST /friends/accept/:requestId` — 带参数
- `POST /friends/reject/:requestId` — 带参数
- `POST /friends/block/:userId` — 带参数
- `GET /friends` — 固定路径
- `GET /friends/requests` — 固定路径（不与 `GET /friends/:userId` 冲突，因为没有该端点）
- `DELETE /friends/:userId` — 带参数

当前路由设计不存在冲突。

---

## AppModule 注册

```typescript
// apps/server/src/app.module.ts — 新增 FriendsModule

import { FriendsModule } from './friends/friends.module';

@Module({
  imports: [
    PrismaModule,    // @Global
    AuthModule,
    DevicesModule,
    GatewayModule,   // @Global, 提供 BroadcastService
    FriendsModule,   // 新增
  ],
})
export class AppModule {}
```

---

## 完成标准

- [ ] POST /api/v1/friends/request 创建 FriendRequest，接收方实时收到 WS `friend:request`
- [ ] POST /api/v1/friends/accept 在事务中创建 Friendship + DM Converse，双方收到 WS `friend:accepted` + `converse:new`
- [ ] POST /api/v1/friends/reject 将 FriendRequest.status 设为 REJECTED，不通知发送方
- [ ] GET /api/v1/friends 返回双向好友列表，包含在线状态和 DM 会话 ID
- [ ] GET /api/v1/friends/requests 返回 sent + received 两组待处理请求
- [ ] DELETE /api/v1/friends/:userId 删除 Friendship + 关闭 DM（isOpen=false），双方收到 WS `friend:removed`
- [ ] POST /api/v1/friends/block 创建 UserBlock + 自动删除好友关系 + 清理待处理请求
- [ ] 不能发送重复请求（409 Conflict）
- [ ] 不能添加自己为好友（400 Bad Request）
- [ ] 被拉黑后不能发送请求（403 Forbidden）
- [ ] 互相发请求时自动接受（双向请求优化）
- [ ] Friendship ID 归一化：`[userId1, userId2].sort()` → `[userAId, userBId]`
- [ ] Flutter 好友列表页显示好友及在线状态指示器
- [ ] Flutter 好友请求页支持接受/拒绝操作
- [ ] Flutter WS 监听 `friend:request`, `friend:accepted`, `friend:removed` 实时更新 UI
- [ ] Desktop 好友列表显示好友及在线状态
- [ ] Desktop 好友请求页支持接受/拒绝
- [ ] Desktop WS 事件通过 IPC 转发到渲染进程
- [ ] 单元测试覆盖正常流程 + 边界条件（自己加自己、重复请求、已是好友、拉黑后加好友）
