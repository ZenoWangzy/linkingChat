> **状态：待开发**

# Sprint 2 — Phase 2：1 对 1 聊天（DM Messaging）

> **负责人**：后端开发者 + 全端跟进
>
> **前置条件**：Phase 0（Schema 扩展）已完成 — Converse、ConverseMember、Message、Attachment model 已 migrate；Phase 1（好友系统）已完成 — 接受好友请求时自动创建 DM Converse；BroadcastService (@Global) 已就绪
>
> **产出**：完整的 DM 消息收发系统 — REST 消息 CRUD + 游标分页 + /chat WebSocket 命名空间 + 实时推送 + 输入状态指示 + Flutter/Desktop 聊天 UI
>
> **参考**：[sprint2_implement.md](./sprint2_implement.md) Phase 2 | [websocket-protocol.md](../dev-plan/websocket-protocol.md) | [database-schema.md](../dev-plan/database-schema.md) | [reference-architecture-guide.md](../dev-plan/reference-architecture-guide.md)

---

## 设计原则

- **REST-first mutations**：所有数据变更（创建/编辑/删除消息）走 REST API，WS 仅用于实时广播。这保证了幂等性、重试安全和审计日志一致性。
- **BroadcastService 桥接**：REST handler 完成 DB 写入后，通过注入的 `BroadcastService`（@Global 模块）将事件推送到 Socket.IO 房间。REST 和 WS 解耦。
- **双通道通知**：在线且在会话房间内的成员收到 `message:new`（通过 `{converseId}` 房间）；不在房间但在线的成员收到 `notification:new`（通过 `u-{userId}` 个人房间）。
- **游标分页**：使用 `createdAt` 时间戳作为游标，`DESC` 排序，每页 35 条。客户端向上滚动时请求更早的消息。

---

## 任务清单

| # | 任务 | 产出文件 | 依赖 |
|---|------|---------|------|
| 2.1 | 创建 ConversesModule + MessagesModule | `apps/server/src/converses/` + `apps/server/src/messages/` | Phase 0 schema |
| 2.2 | GET `/api/v1/converses` — 会话列表 | `converses.controller.ts` + `converses.service.ts` | 2.1 |
| 2.3 | POST `/api/v1/messages` — 发送消息 | `messages.controller.ts` + `messages.service.ts` | 2.1, BroadcastService |
| 2.4 | GET `/api/v1/messages?converseId=&cursor=` — 消息历史 | `messages.controller.ts` + `messages.service.ts` | 2.1 |
| 2.5 | PATCH `/api/v1/messages/:id` — 编辑消息 | `messages.controller.ts` + `messages.service.ts` | 2.1 |
| 2.6 | DELETE `/api/v1/messages/:id` — 软删除消息 | `messages.controller.ts` + `messages.service.ts` | 2.1 |
| 2.7 | ChatGateway (/chat 命名空间) | `apps/server/src/gateway/chat.gateway.ts` | 2.1, WS Auth Middleware |
| 2.8 | WS 事件 message:typing | `chat.gateway.ts` | 2.7 |
| 2.9 | 未读消息计数 | `converses.service.ts` | 2.2 |
| 2.10 | Flutter 聊天 UI | `apps/mobile/lib/features/chat/` | 2.2, 2.3, 2.4 |
| 2.11 | Desktop 聊天 UI | `apps/desktop/src/renderer/pages/Chat.tsx` | 2.2, 2.3, 2.4 |
| 2.12 | 单元 + E2E 测试 | `messages.service.spec.ts` + `chat.e2e-spec.ts` | 2.1-2.8 |

---

## 关键文件一览

```
apps/server/src/converses/
  ├── converses.module.ts
  ├── converses.controller.ts       # GET /api/v1/converses
  └── converses.service.ts          # 会话列表 + 未读计数

apps/server/src/messages/
  ├── messages.module.ts
  ├── messages.controller.ts        # POST/GET/PATCH/DELETE /api/v1/messages
  ├── messages.service.ts           # 消息 CRUD + 游标分页
  └── dto/
      ├── create-message.dto.ts
      ├── update-message.dto.ts
      └── message-response.dto.ts

apps/server/src/gateway/
  └── chat.gateway.ts               # /chat 命名空间（新增，与 /device 并列）

apps/mobile/lib/features/chat/
  ├── models/
  │   ├── converse.dart
  │   └── message.dart
  ├── pages/
  │   ├── converse_list_page.dart    # 会话列表主页
  │   └── chat_page.dart            # 消息聊天页
  ├── providers/
  │   ├── converse_provider.dart     # 会话列表状态管理
  │   └── message_provider.dart      # 当前会话消息状态管理
  └── widgets/
      ├── converse_tile.dart         # 会话列表条目（头像、名称、最后消息、未读角标）
      ├── message_bubble.dart        # 消息气泡
      ├── message_input.dart         # 文本输入 + 发送按钮
      └── typing_indicator.dart      # "正在输入..." 动画

apps/desktop/src/renderer/
  ├── pages/
  │   └── Chat.tsx                   # 聊天主页（左右分栏）
  └── components/
      ├── ConverseList.tsx           # 左侧会话列表
      ├── ChatPanel.tsx              # 右侧消息面板
      ├── MessageBubble.tsx          # 消息气泡
      ├── MessageInput.tsx           # 输入框
      └── TypingIndicator.tsx        # 输入状态指示
```

---

## 2.1 创建 ConversesModule + MessagesModule

将会话管理和消息管理分为两个独立模块。MessagesModule 导入 ConversesModule 以复用成员校验逻辑。

### ConversesModule

```typescript
// apps/server/src/converses/converses.module.ts

import { Module } from '@nestjs/common';
import { ConversesController } from './converses.controller';
import { ConversesService } from './converses.service';

@Module({
  controllers: [ConversesController],
  providers: [ConversesService],
  exports: [ConversesService],
})
export class ConversesModule {}
```

### MessagesModule

```typescript
// apps/server/src/messages/messages.module.ts

import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ConversesModule } from '../converses/converses.module';

@Module({
  imports: [ConversesModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
```

### AppModule 集成

```typescript
// apps/server/src/app.module.ts — 新增 imports

import { ConversesModule } from './converses/converses.module';
import { MessagesModule } from './messages/messages.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    DevicesModule,
    GatewayModule,
    FriendsModule,       // Phase 1
    ConversesModule,     // Phase 2 新增
    MessagesModule,      // Phase 2 新增
  ],
})
export class AppModule {}
```

**要点**：
- PrismaModule 已是 `@Global()`，无需重复导入
- BroadcastService 已是 `@Global()` 模块的 provider，MessagesService 可直接注入使用
- ConversesModule 通过 `exports: [ConversesService]` 向 MessagesModule 暴露成员校验能力

---

## 2.2 GET `/api/v1/converses` — 会话列表

返回当前用户所有 `isOpen=true` 的会话，携带未读计数和最后一条消息预览。

### ConversesService

```typescript
// apps/server/src/converses/converses.service.ts

import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConversesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查询用户的所有打开会话
   * 包含：会话成员信息、最后一条消息预览、未读计数
   */
  async findUserConverses(userId: string) {
    const members = await this.prisma.converseMember.findMany({
      where: { userId, isOpen: true },
      include: {
        converse: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatarUrl: true,
                    status: true,
                  },
                },
              },
            },
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              where: { deletedAt: null },
              include: {
                author: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { converse: { updatedAt: 'desc' } },
    });

    // 计算每个会话的未读消息数
    const converses = await Promise.all(
      members.map(async (member) => {
        const unreadCount = await this.getUnreadCount(
          member.converseId,
          userId,
          member.lastSeenMessageId,
        );

        return {
          id: member.converse.id,
          type: member.converse.type,
          name: member.converse.name,
          members: member.converse.members.map((m) => ({
            userId: m.userId,
            ...m.user,
            isOpen: m.isOpen,
          })),
          lastMessage: member.converse.messages[0] ?? null,
          unreadCount,
          updatedAt: member.converse.updatedAt,
        };
      }),
    );

    return converses;
  }

  /**
   * 校验用户是否为会话成员
   * 多处复用：发消息、加入房间、编辑消息等
   */
  async verifyMembership(converseId: string, userId: string) {
    const member = await this.prisma.converseMember.findUnique({
      where: {
        converseId_userId: { converseId, userId },
      },
    });

    if (!member) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    return member;
  }

  /**
   * 获取会话的所有成员 userId 列表
   */
  async getMemberIds(converseId: string): Promise<string[]> {
    const members = await this.prisma.converseMember.findMany({
      where: { converseId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  /**
   * 计算未读消息数
   * 基于 lastSeenMessageId 对应的 createdAt 时间戳，统计之后的非自己发送的消息条数
   */
  private async getUnreadCount(
    converseId: string,
    userId: string,
    lastSeenMessageId: string | null,
  ): Promise<number> {
    if (!lastSeenMessageId) {
      // 从未读过任何消息 → 全部算未读
      return this.prisma.message.count({
        where: {
          converseId,
          authorId: { not: userId },
          deletedAt: null,
        },
      });
    }

    // 查找 lastSeenMessage 的 createdAt
    const lastSeenMessage = await this.prisma.message.findUnique({
      where: { id: lastSeenMessageId },
      select: { createdAt: true },
    });

    if (!lastSeenMessage) {
      return 0;
    }

    return this.prisma.message.count({
      where: {
        converseId,
        authorId: { not: userId },
        deletedAt: null,
        createdAt: { gt: lastSeenMessage.createdAt },
      },
    });
  }
}
```

### ConversesController

```typescript
// apps/server/src/converses/converses.controller.ts

import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ConversesService } from './converses.service';

@Controller('api/v1/converses')
@UseGuards(JwtAuthGuard)
export class ConversesController {
  constructor(private readonly conversesService: ConversesService) {}

  /**
   * GET /api/v1/converses
   * 返回当前用户的所有打开会话 + 未读计数 + 最后消息预览
   */
  @Get()
  findAll(@CurrentUser('userId') userId: string) {
    return this.conversesService.findUserConverses(userId);
  }
}
```

**响应格式**：

```json
[
  {
    "id": "clxyz...",
    "type": "DM",
    "name": null,
    "members": [
      { "userId": "u1", "username": "alice", "displayName": "Alice", "avatarUrl": null, "status": "ONLINE", "isOpen": true },
      { "userId": "u2", "username": "bob", "displayName": "Bob", "avatarUrl": null, "status": "OFFLINE", "isOpen": true }
    ],
    "lastMessage": {
      "id": "msg_xxx",
      "content": "你好！",
      "createdAt": "2026-02-14T10:30:00.000Z",
      "author": { "id": "u1", "username": "alice", "displayName": "Alice" }
    },
    "unreadCount": 3,
    "updatedAt": "2026-02-14T10:30:00.000Z"
  }
]
```

**要点**：
- DM 会话 `name` 为 null，客户端应显示对方用户名
- 按 `updatedAt DESC` 排序，最近有活动的会话排在前面
- `unreadCount` 基于 `lastSeenMessageId` 游标计算（详见 2.9）

---

## 2.3 POST `/api/v1/messages` — 发送消息

插入消息到数据库，更新所有成员的 `lastMessageId`，通过 BroadcastService 推送 WS 事件。

### DTOs

```typescript
// apps/server/src/messages/dto/create-message.dto.ts

import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength } from 'class-validator';

export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  FILE = 'FILE',
  SYSTEM = 'SYSTEM',
  BOT_NOTIFICATION = 'BOT_NOTIFICATION',
}

export class CreateMessageDto {
  @IsString()
  @IsNotEmpty()
  converseId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content: string;

  @IsEnum(MessageType)
  @IsOptional()
  type?: MessageType = MessageType.TEXT;

  @IsString()
  @IsOptional()
  replyToId?: string;
}
```

```typescript
// apps/server/src/messages/dto/message-response.dto.ts

export class MessageResponseDto {
  id: string;
  content: string;
  type: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  converseId: string;
  replyToId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
```

### MessagesService — create()

```typescript
// apps/server/src/messages/messages.service.ts

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService } from '../gateway/broadcast.service';
import { ConversesService } from '../converses/converses.service';
import { CreateMessageDto } from './dto/create-message.dto';

// 标准 author select，复用于所有消息查询
const AUTHOR_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcastService: BroadcastService,
    private readonly conversesService: ConversesService,
  ) {}

  /**
   * 创建消息 — REST handler 调用
   *
   * 流程：
   * 1. 校验用户是 converse 成员
   * 2. 插入消息记录
   * 3. 更新所有成员的 lastMessageId + converse.updatedAt
   * 4. 广播 message:new 到 {converseId} 房间
   * 5. 对不在房间的成员广播 notification:new 到 u-{userId}
   */
  async create(userId: string, dto: CreateMessageDto) {
    // 1. 校验成员身份
    await this.conversesService.verifyMembership(dto.converseId, userId);

    // 2. 如果有 replyToId，校验引用消息存在且属于同一会话
    if (dto.replyToId) {
      const replyTarget = await this.prisma.message.findUnique({
        where: { id: dto.replyToId },
      });
      if (!replyTarget || replyTarget.converseId !== dto.converseId) {
        throw new NotFoundException('Reply target message not found in this conversation');
      }
    }

    // 3. 插入消息
    const message = await this.prisma.message.create({
      data: {
        content: dto.content,
        type: dto.type ?? 'TEXT',
        authorId: userId,
        converseId: dto.converseId,
        replyToId: dto.replyToId ?? null,
      },
      include: {
        author: { select: AUTHOR_SELECT },
      },
    });

    // 4. 更新所有成员的 lastMessageId + 更新 converse.updatedAt
    await this.prisma.$transaction([
      this.prisma.converseMember.updateMany({
        where: { converseId: dto.converseId },
        data: { lastMessageId: message.id },
      }),
      this.prisma.converse.update({
        where: { id: dto.converseId },
        data: { updatedAt: new Date() },
      }),
    ]);

    // 5. 广播 message:new 到 {converseId} 房间
    this.broadcastService.toRoom(dto.converseId, 'message:new', {
      id: message.id,
      content: message.content,
      type: message.type,
      author: message.author,
      converseId: message.converseId,
      replyToId: message.replyToId,
      metadata: message.metadata,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    });

    // 6. 对不在 {converseId} 房间的成员发送 notification:new
    //    通过 u-{userId} 个人房间推送，由 BroadcastService 内部判断是否在房间内
    const memberIds = await this.conversesService.getMemberIds(dto.converseId);
    for (const memberId of memberIds) {
      if (memberId === userId) continue; // 不通知发送者自己
      this.broadcastService.toRoomIfNotIn(
        `u-${memberId}`,         // 目标：个人房间
        dto.converseId,          // 条件：不在此会话房间内
        'notification:new',
        {
          converseId: dto.converseId,
          messageId: message.id,
          content: message.content,
          author: message.author,
          createdAt: message.createdAt.toISOString(),
        },
      );
    }

    return message;
  }
}
```

### MessagesController — create

```typescript
// apps/server/src/messages/messages.controller.ts

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';

@Controller('api/v1/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  /**
   * POST /api/v1/messages
   * 发送消息 — 插入 DB + WS 广播
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.messagesService.create(userId, dto);
  }

  /**
   * GET /api/v1/messages?converseId=xxx&cursor=xxx&limit=35
   * 消息历史 — 游标分页
   */
  @Get()
  findByConverse(
    @CurrentUser('userId') userId: string,
    @Query('converseId') converseId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messagesService.findByConverse(
      userId,
      converseId,
      cursor,
      limit ? parseInt(limit, 10) : 35,
    );
  }

  /**
   * PATCH /api/v1/messages/:id
   * 编辑消息 — 仅作者可编辑
   */
  @Patch(':id')
  update(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.messagesService.update(userId, id, dto);
  }

  /**
   * DELETE /api/v1/messages/:id
   * 撤回消息 — 软删除（设置 deletedAt）
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.messagesService.softDelete(userId, id);
  }
}
```

**BroadcastService.toRoomIfNotIn 说明**：

BroadcastService 已在 Sprint 1 作为 @Global 模块创建。此方法检查目标 socket 是否已加入某个房间，如果不在房间内则发送事件。实现依赖 Socket.IO 的 `rooms` API：

```typescript
// apps/server/src/gateway/broadcast.service.ts — 新增方法

/**
 * 向 targetRoom 发送事件，但仅限于 NOT 在 excludeRoom 中的 socket
 * 用于：用户不在聊天房间时通过个人房间推送通知
 */
toRoomIfNotIn(
  targetRoom: string,
  excludeRoom: string,
  event: string,
  data: unknown,
): void {
  const namespace = this.server.of('/chat');
  const targetSockets = namespace.adapter.rooms.get(targetRoom);
  const excludeSockets = namespace.adapter.rooms.get(excludeRoom);

  if (!targetSockets) return;

  for (const socketId of targetSockets) {
    if (excludeSockets && excludeSockets.has(socketId)) continue;
    namespace.to(socketId).emit(event, data);
  }
}
```

---

## 2.4 GET `/api/v1/messages?converseId=&cursor=` — 消息历史

使用 `createdAt` 时间戳作为游标实现分页。客户端首次加载不传 cursor，获取最新 35 条；向上滚动时传上一页最后一条消息的 `createdAt` 作为 cursor。

### MessagesService — findByConverse()

```typescript
// apps/server/src/messages/messages.service.ts — findByConverse 方法

/**
 * 游标分页查询消息历史
 *
 * @param userId     - 当前用户 ID（用于校验成员身份）
 * @param converseId - 会话 ID
 * @param cursor     - ISO 8601 时间戳游标，获取此时间之前的消息
 * @param limit      - 每页条数，默认 35
 * @returns          - { messages: Message[], hasMore: boolean, nextCursor: string | null }
 */
async findByConverse(
  userId: string,
  converseId: string,
  cursor?: string,
  limit = 35,
) {
  // 1. 校验成员身份
  await this.conversesService.verifyMembership(converseId, userId);

  // 2. 查询 limit + 1 条，多查 1 条判断是否还有更多
  const messages = await this.prisma.message.findMany({
    where: {
      converseId,
      deletedAt: null,
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    include: {
      author: { select: AUTHOR_SELECT },
    },
  });

  const hasMore = messages.length > limit;
  if (hasMore) {
    messages.pop(); // 移除多查的 1 条
  }

  const nextCursor = hasMore
    ? messages[messages.length - 1].createdAt.toISOString()
    : null;

  return {
    messages,
    hasMore,
    nextCursor,
  };
}
```

**响应格式**：

```json
{
  "messages": [
    {
      "id": "msg_003",
      "content": "最新消息",
      "type": "TEXT",
      "author": { "id": "u1", "username": "alice", "displayName": "Alice", "avatarUrl": null },
      "converseId": "conv_001",
      "replyToId": null,
      "metadata": null,
      "createdAt": "2026-02-14T10:32:00.000Z",
      "updatedAt": "2026-02-14T10:32:00.000Z"
    },
    {
      "id": "msg_002",
      "content": "第二条消息",
      "type": "TEXT",
      "author": { "id": "u2", "username": "bob", "displayName": "Bob", "avatarUrl": null },
      "converseId": "conv_001",
      "replyToId": null,
      "metadata": null,
      "createdAt": "2026-02-14T10:31:00.000Z",
      "updatedAt": "2026-02-14T10:31:00.000Z"
    }
  ],
  "hasMore": true,
  "nextCursor": "2026-02-14T10:31:00.000Z"
}
```

**游标分页 vs offset 分页**：
- offset 分页在数据插入时会导致重复/跳过（消息场景常见）
- 游标分页始终从固定锚点往前查，不受新消息插入影响
- `createdAt` 有索引 `@@index([converseId, createdAt])`，查询高效

---

## 2.5 PATCH `/api/v1/messages/:id` — 编辑消息

仅消息作者可编辑。编辑后通过 WS 广播 `message:updated` 到会话房间。

### UpdateMessageDto

```typescript
// apps/server/src/messages/dto/update-message.dto.ts

import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class UpdateMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content: string;
}
```

### MessagesService — update()

```typescript
// apps/server/src/messages/messages.service.ts — update 方法

/**
 * 编辑消息 — 仅作者可操作
 *
 * 流程：
 * 1. 查找消息并校验作者身份
 * 2. 更新消息内容
 * 3. 广播 message:updated 到 {converseId} 房间
 */
async update(userId: string, messageId: string, dto: UpdateMessageDto) {
  // 1. 查找消息
  const message = await this.prisma.message.findUnique({
    where: { id: messageId },
  });

  if (!message) {
    throw new NotFoundException('Message not found');
  }

  if (message.deletedAt) {
    throw new NotFoundException('Message has been deleted');
  }

  // 2. 校验作者身份
  if (message.authorId !== userId) {
    throw new ForbiddenException('Only the author can edit this message');
  }

  // 3. 更新消息
  const updated = await this.prisma.message.update({
    where: { id: messageId },
    data: {
      content: dto.content,
      updatedAt: new Date(),
    },
    include: {
      author: { select: AUTHOR_SELECT },
    },
  });

  // 4. 广播 message:updated
  this.broadcastService.toRoom(message.converseId, 'message:updated', {
    id: updated.id,
    content: updated.content,
    converseId: updated.converseId,
    updatedAt: updated.updatedAt.toISOString(),
  });

  return updated;
}
```

---

## 2.6 DELETE `/api/v1/messages/:id` — 软删除消息

设置 `deletedAt` 字段而非物理删除。广播 `message:deleted` 到会话房间，客户端收到后将消息替换为"已撤回"占位。

### MessagesService — softDelete()

```typescript
// apps/server/src/messages/messages.service.ts — softDelete 方法

/**
 * 软删除消息（撤回）
 *
 * 流程：
 * 1. 查找消息并校验作者身份
 * 2. 设置 deletedAt 时间戳
 * 3. 广播 message:deleted 到 {converseId} 房间
 */
async softDelete(userId: string, messageId: string) {
  // 1. 查找消息
  const message = await this.prisma.message.findUnique({
    where: { id: messageId },
  });

  if (!message) {
    throw new NotFoundException('Message not found');
  }

  if (message.deletedAt) {
    throw new NotFoundException('Message already deleted');
  }

  // 2. 校验作者身份
  if (message.authorId !== userId) {
    throw new ForbiddenException('Only the author can delete this message');
  }

  // 3. 软删除
  const deleted = await this.prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  });

  // 4. 广播 message:deleted
  this.broadcastService.toRoom(message.converseId, 'message:deleted', {
    id: deleted.id,
    converseId: deleted.converseId,
    deletedAt: deleted.deletedAt!.toISOString(),
  });

  return { id: deleted.id, deleted: true };
}
```

---

## 2.7 ChatGateway (/chat 命名空间)

新增 `/chat` WebSocket 命名空间，与已有的 `/device` 命名空间并列。负责社交聊天相关的 WS 事件：房间管理、输入状态。

这是一个 **新的 Gateway**，而非修改现有 DeviceGateway。Socket.IO 支持同一服务器上多个命名空间，各命名空间事件完全隔离。

### ChatGateway 完整实现

```typescript
// apps/server/src/gateway/chat.gateway.ts

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Namespace } from 'socket.io';
import { createWsAuthMiddleware } from './middleware/ws-auth.middleware';
import { ConversesService } from '../converses/converses.service';
import { PrismaService } from '../prisma/prisma.service';
import type { TypedSocket } from '@linkingchat/ws-protocol';

@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  namespace: Namespace;

  constructor(
    private readonly conversesService: ConversesService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 注册 JWT 认证中间件
   * 复用与 DeviceGateway 相同的 createWsAuthMiddleware
   */
  afterInit(namespace: Namespace) {
    namespace.use(createWsAuthMiddleware());
    this.logger.log('Chat Gateway initialized with RS256 auth middleware');
  }

  /**
   * 连接成功：将客户端加入个人房间 u-{userId}
   * 后续通过 converse:join 事件加入具体会话房间
   */
  async handleConnection(client: TypedSocket) {
    const userId = client.data.userId;
    client.join(`u-${userId}`);
    this.logger.log(
      `[Chat] Client connected: ${client.id} | userId=${userId}`,
    );
  }

  /**
   * 断开连接
   * Socket.IO 自动清理该 socket 加入的所有房间，无需手动 leave
   */
  async handleDisconnect(client: TypedSocket) {
    this.logger.log(
      `[Chat] Client disconnected: ${client.id} | userId=${client.data.userId}`,
    );
  }

  /**
   * converse:join — 客户端打开某个会话时调用
   *
   * 校验成员身份后将 socket 加入 {converseId} 房间。
   * 后续该房间内的 message:new / message:updated / message:deleted 等事件
   * 会自动推送给该 socket。
   */
  @SubscribeMessage('converse:join')
  async handleJoin(
    @ConnectedSocket() client: TypedSocket,
    @MessageBody() data: { converseId: string },
  ) {
    const userId = client.data.userId;

    try {
      // 校验成员身份
      await this.conversesService.verifyMembership(data.converseId, userId);

      // 加入会话房间
      client.join(data.converseId);
      this.logger.debug(
        `[Chat] User ${userId} joined room ${data.converseId}`,
      );

      return { success: true };
    } catch (error) {
      this.logger.warn(
        `[Chat] converse:join rejected: user ${userId}, converse ${data.converseId}`,
      );
      return {
        success: false,
        error: { code: 'JOIN_DENIED', message: 'Not a member of this conversation' },
      };
    }
  }

  /**
   * converse:leave — 客户端离开某个会话时调用
   *
   * 用户切换到其他聊天或退出聊天页面时调用。
   * 离开房间后不再收到该会话的实时事件。
   */
  @SubscribeMessage('converse:leave')
  async handleLeave(
    @ConnectedSocket() client: TypedSocket,
    @MessageBody() data: { converseId: string },
  ) {
    client.leave(data.converseId);
    this.logger.debug(
      `[Chat] User ${client.data.userId} left room ${data.converseId}`,
    );
    return { success: true };
  }

  /**
   * message:typing — 输入状态广播
   *
   * 客户端在输入框获得焦点并开始输入时发送 isTyping=true，
   * 停止输入 2 秒后（客户端侧 debounce）发送 isTyping=false。
   * 服务端转发到 {converseId} 房间，排除发送者自己。
   */
  @SubscribeMessage('message:typing')
  handleTyping(
    @ConnectedSocket() client: TypedSocket,
    @MessageBody() data: { converseId: string; isTyping: boolean },
  ) {
    const userId = client.data.userId;

    // 使用 client.to() 广播到房间内除自己外的所有 socket
    client.to(data.converseId).emit('message:typing', {
      converseId: data.converseId,
      userId,
      isTyping: data.isTyping,
    });
  }
}
```

### GatewayModule 更新

```typescript
// apps/server/src/gateway/gateway.module.ts — 更新

import { Module } from '@nestjs/common';
import { DeviceGateway } from './device.gateway';
import { ChatGateway } from './chat.gateway';
import { BroadcastService } from './broadcast.service';
import { DevicesModule } from '../devices/devices.module';
import { ConversesModule } from '../converses/converses.module';

@Module({
  imports: [DevicesModule, ConversesModule],
  providers: [DeviceGateway, ChatGateway, BroadcastService],
  exports: [BroadcastService],
})
export class GatewayModule {}
```

**要点**：
- `/chat` 和 `/device` 是两个独立的 Socket.IO 命名空间，各自有独立的事件空间和房间体系
- 两个命名空间共用同一个 Redis IO Adapter，房间事件跨实例同步
- `createWsAuthMiddleware()` 在两个 Gateway 中复用，JWT 验证逻辑完全一致
- `client.to(room).emit()` 是 Socket.IO 的广播 API，自动排除发送者

---

## 2.8 WS 事件：message:typing

输入状态指示已集成在 2.7 ChatGateway 的 `handleTyping()` 方法中。以下是客户端实现约定：

### 客户端 Debounce 策略

```
用户开始输入 → emit('message:typing', { converseId, isTyping: true })
                ↓
  (每次按键重置 2 秒定时器)
                ↓
  用户停止输入 2 秒 → emit('message:typing', { converseId, isTyping: false })
```

### 服务端转发规则

```
Client A → message:typing { converseId: "conv_001", isTyping: true }
  → Server 转发到 conv_001 房间（排除 A）
    → Client B 收到 → 显示 "Alice 正在输入..."
    → Client C 收到 → 显示 "Alice 正在输入..."

Client A → message:typing { converseId: "conv_001", isTyping: false }
  → Server 转发到 conv_001 房间（排除 A）
    → Client B 收到 → 隐藏输入状态指示器
```

**注意**：typing 事件不持久化到数据库，纯实时转发。客户端应设置 5 秒超时自动清除输入状态（防止对方断连后指示器永远显示）。

---

## 2.9 未读消息计数

未读计数逻辑已集成在 2.2 的 `ConversesService.getUnreadCount()` 方法中。核心机制：

### 已读游标模型

```
ConverseMember.lastSeenMessageId = "msg_005"

消息时间线:
  msg_001  msg_002  msg_003  msg_004  msg_005  msg_006  msg_007  msg_008
     ↑                                   ↑        ↑        ↑        ↑
   最早                              已读到这    未读      未读      未读
                                                      unreadCount = 3
                                               (不含自己发的消息)
```

### SQL 等效逻辑

```sql
SELECT COUNT(*) FROM messages m
WHERE m."converseId" = :converseId
  AND m."deletedAt" IS NULL
  AND m."authorId" != :userId
  AND m."createdAt" > (
    SELECT m2."createdAt" FROM messages m2
    WHERE m2."id" = :lastSeenMessageId
  );
```

### 已读更新时机

已读标记在 Phase 4（已读回执）中实现。Phase 2 阶段 `lastSeenMessageId` 暂时不更新，未读数仅在 `GET /api/v1/converses` 时计算。Phase 4 会添加 `message:read` WS 事件来实时更新此游标。

---

## 2.10 Flutter 聊天 UI

### WS 事件常量扩展

```dart
// lib/core/constants/ws_events.dart — 新增 chat 事件

class WsEvents {
  // --- 既有 device 事件（Sprint 1） ---
  static const commandSend    = 'device:command:send';
  static const commandCancel  = 'device:command:cancel';
  static const commandAck     = 'device:command:ack';
  static const resultDelivered  = 'device:result:delivered';
  static const resultProgress   = 'device:result:progress';
  static const statusChanged    = 'device:status:changed';

  // --- 新增 chat 事件（Sprint 2 Phase 2） ---
  static const converseJoin     = 'converse:join';
  static const converseLeave    = 'converse:leave';
  static const messageNew       = 'message:new';
  static const messageUpdated   = 'message:updated';
  static const messageDeleted   = 'message:deleted';
  static const messageTyping    = 'message:typing';
  static const notificationNew  = 'notification:new';
}
```

### API 端点常量扩展

```dart
// lib/core/constants/api_endpoints.dart — 新增

class ApiEndpoints {
  static const String baseUrl    = 'http://localhost:3008';
  static const String login      = '/api/v1/auth/login';
  static const String refresh    = '/api/v1/auth/refresh';
  static const String devices    = '/api/v1/devices';

  // Sprint 2 Phase 2 新增
  static const String converses  = '/api/v1/converses';
  static const String messages   = '/api/v1/messages';
}
```

### 数据模型

```dart
// lib/features/chat/models/converse.dart

class Converse {
  final String id;
  final String type;      // 'DM' | 'MULTI' | 'GROUP'
  final String? name;
  final List<ConverseMember> members;
  final Message? lastMessage;
  final int unreadCount;
  final DateTime updatedAt;

  Converse({
    required this.id,
    required this.type,
    this.name,
    required this.members,
    this.lastMessage,
    required this.unreadCount,
    required this.updatedAt,
  });

  /// DM 会话时获取对方用户信息
  ConverseMember? getOtherMember(String myUserId) {
    if (type != 'DM') return null;
    return members.where((m) => m.userId != myUserId).firstOrNull;
  }

  /// 显示名称：DM 用对方名字，群组用 name
  String displayName(String myUserId) {
    if (type == 'DM') {
      final other = getOtherMember(myUserId);
      return other?.displayName ?? '未知用户';
    }
    return name ?? '未命名群组';
  }

  factory Converse.fromJson(Map<String, dynamic> json) {
    return Converse(
      id: json['id'] as String,
      type: json['type'] as String,
      name: json['name'] as String?,
      members: (json['members'] as List)
          .map((m) => ConverseMember.fromJson(m as Map<String, dynamic>))
          .toList(),
      lastMessage: json['lastMessage'] != null
          ? Message.fromJson(json['lastMessage'] as Map<String, dynamic>)
          : null,
      unreadCount: json['unreadCount'] as int? ?? 0,
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }
}

class ConverseMember {
  final String userId;
  final String username;
  final String displayName;
  final String? avatarUrl;
  final String? status;

  ConverseMember({
    required this.userId,
    required this.username,
    required this.displayName,
    this.avatarUrl,
    this.status,
  });

  factory ConverseMember.fromJson(Map<String, dynamic> json) {
    return ConverseMember(
      userId: json['userId'] as String,
      username: json['username'] as String,
      displayName: json['displayName'] as String,
      avatarUrl: json['avatarUrl'] as String?,
      status: json['status'] as String?,
    );
  }
}
```

```dart
// lib/features/chat/models/message.dart

class Message {
  final String id;
  final String content;
  final String type;
  final MessageAuthor author;
  final String converseId;
  final String? replyToId;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? deletedAt;

  Message({
    required this.id,
    required this.content,
    required this.type,
    required this.author,
    required this.converseId,
    this.replyToId,
    required this.createdAt,
    required this.updatedAt,
    this.deletedAt,
  });

  bool get isDeleted => deletedAt != null;
  bool get isEdited => updatedAt.isAfter(createdAt);

  factory Message.fromJson(Map<String, dynamic> json) {
    return Message(
      id: json['id'] as String,
      content: json['content'] as String,
      type: json['type'] as String? ?? 'TEXT',
      author: MessageAuthor.fromJson(json['author'] as Map<String, dynamic>),
      converseId: json['converseId'] as String,
      replyToId: json['replyToId'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      deletedAt: json['deletedAt'] != null
          ? DateTime.parse(json['deletedAt'] as String)
          : null,
    );
  }

  Message copyWith({String? content, DateTime? updatedAt, DateTime? deletedAt}) {
    return Message(
      id: id,
      content: content ?? this.content,
      type: type,
      author: author,
      converseId: converseId,
      replyToId: replyToId,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      deletedAt: deletedAt ?? this.deletedAt,
    );
  }
}

class MessageAuthor {
  final String id;
  final String username;
  final String displayName;
  final String? avatarUrl;

  MessageAuthor({
    required this.id,
    required this.username,
    required this.displayName,
    this.avatarUrl,
  });

  factory MessageAuthor.fromJson(Map<String, dynamic> json) {
    return MessageAuthor(
      id: json['id'] as String,
      username: json['username'] as String,
      displayName: json['displayName'] as String,
      avatarUrl: json['avatarUrl'] as String?,
    );
  }
}
```

### Converse Provider

```dart
// lib/features/chat/providers/converse_provider.dart

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/ws_service.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/ws_events.dart';
import '../models/converse.dart';
import '../models/message.dart';

class ConverseListNotifier extends StateNotifier<AsyncValue<List<Converse>>> {
  final Ref _ref;

  ConverseListNotifier(this._ref) : super(const AsyncValue.loading()) {
    _init();
  }

  Future<void> _init() async {
    await fetchConverses();
    _listenForUpdates();
  }

  Future<void> fetchConverses() async {
    try {
      final dio = _ref.read(dioProvider);
      final response = await dio.get(ApiEndpoints.converses);

      final converses = (response.data as List)
          .map((json) => Converse.fromJson(json as Map<String, dynamic>))
          .toList();

      state = AsyncValue.data(converses);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  void _listenForUpdates() {
    final wsService = _ref.read(chatWsServiceProvider);

    // 新消息到来 → 更新会话列表的 lastMessage + unreadCount
    wsService.on(WsEvents.messageNew, (data) {
      final msg = Message.fromJson(data as Map<String, dynamic>);
      _updateConverseWithNewMessage(msg);
    });

    // 通知：用户不在会话房间内时收到的新消息通知
    wsService.on(WsEvents.notificationNew, (data) {
      final payload = data as Map<String, dynamic>;
      final converseId = payload['converseId'] as String;
      _incrementUnreadCount(converseId);
    });
  }

  void _updateConverseWithNewMessage(Message msg) {
    state.whenData((converses) {
      final updated = converses.map((c) {
        if (c.id == msg.converseId) {
          return Converse(
            id: c.id,
            type: c.type,
            name: c.name,
            members: c.members,
            lastMessage: msg,
            unreadCount: c.unreadCount + 1,
            updatedAt: msg.createdAt,
          );
        }
        return c;
      }).toList();

      // 按 updatedAt 重新排序
      updated.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      state = AsyncValue.data(updated);
    });
  }

  void _incrementUnreadCount(String converseId) {
    state.whenData((converses) {
      final updated = converses.map((c) {
        if (c.id == converseId) {
          return Converse(
            id: c.id,
            type: c.type,
            name: c.name,
            members: c.members,
            lastMessage: c.lastMessage,
            unreadCount: c.unreadCount + 1,
            updatedAt: DateTime.now(),
          );
        }
        return c;
      }).toList();

      updated.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      state = AsyncValue.data(updated);
    });
  }

  /// 清除某个会话的未读数（打开聊天页时调用）
  void clearUnreadCount(String converseId) {
    state.whenData((converses) {
      final updated = converses.map((c) {
        if (c.id == converseId) {
          return Converse(
            id: c.id,
            type: c.type,
            name: c.name,
            members: c.members,
            lastMessage: c.lastMessage,
            unreadCount: 0,
            updatedAt: c.updatedAt,
          );
        }
        return c;
      }).toList();
      state = AsyncValue.data(updated);
    });
  }

  @override
  void dispose() {
    _ref.read(chatWsServiceProvider).off(WsEvents.messageNew);
    _ref.read(chatWsServiceProvider).off(WsEvents.notificationNew);
    super.dispose();
  }
}

final converseListProvider =
    StateNotifierProvider<ConverseListNotifier, AsyncValue<List<Converse>>>((ref) {
  return ConverseListNotifier(ref);
});

/// Chat WS 服务 Provider — 连接 /chat 命名空间（与 Sprint 1 的 /device 独立）
final chatWsServiceProvider = Provider<WsService>((ref) {
  final authRepo = ref.read(authRepositoryProvider);
  return WsService(authRepo: authRepo, namespace: '/chat');
});
```

### Message Provider

```dart
// lib/features/chat/providers/message_provider.dart

import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/ws_service.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/constants/ws_events.dart';
import '../models/message.dart';

class MessageListState {
  final List<Message> messages;
  final bool isLoading;
  final bool hasMore;
  final String? nextCursor;
  final String? error;

  const MessageListState({
    this.messages = const [],
    this.isLoading = false,
    this.hasMore = true,
    this.nextCursor,
    this.error,
  });

  MessageListState copyWith({
    List<Message>? messages,
    bool? isLoading,
    bool? hasMore,
    String? nextCursor,
    String? error,
  }) {
    return MessageListState(
      messages: messages ?? this.messages,
      isLoading: isLoading ?? this.isLoading,
      hasMore: hasMore ?? this.hasMore,
      nextCursor: nextCursor ?? this.nextCursor,
      error: error,
    );
  }
}

class MessageNotifier extends StateNotifier<MessageListState> {
  final Ref _ref;
  final String converseId;
  Timer? _typingTimer;

  MessageNotifier(this._ref, this.converseId)
      : super(const MessageListState()) {
    _init();
  }

  Future<void> _init() async {
    // 1. 加入 WS 房间
    final wsService = _ref.read(chatWsServiceProvider);
    wsService.emit(WsEvents.converseJoin, {'converseId': converseId});

    // 2. 加载初始消息
    await loadMessages();

    // 3. 监听实时事件
    _listenForRealtime();
  }

  /// 加载消息（初始加载 or 滚动加载更多）
  Future<void> loadMessages() async {
    if (state.isLoading || (!state.hasMore && state.messages.isNotEmpty)) return;

    state = state.copyWith(isLoading: true, error: null);

    try {
      final dio = _ref.read(dioProvider);
      final queryParams = <String, String>{
        'converseId': converseId,
        if (state.nextCursor != null) 'cursor': state.nextCursor!,
      };

      final response = await dio.get(
        ApiEndpoints.messages,
        queryParameters: queryParams,
      );

      final data = response.data as Map<String, dynamic>;
      final newMessages = (data['messages'] as List)
          .map((json) => Message.fromJson(json as Map<String, dynamic>))
          .toList();

      state = state.copyWith(
        messages: [...state.messages, ...newMessages],
        hasMore: data['hasMore'] as bool,
        nextCursor: data['nextCursor'] as String?,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: e.toString(),
      );
    }
  }

  /// 发送消息
  Future<void> sendMessage(String content) async {
    try {
      final dio = _ref.read(dioProvider);
      await dio.post(ApiEndpoints.messages, data: {
        'converseId': converseId,
        'content': content,
      });
      // 消息通过 WS message:new 事件回来，不需要手动添加到列表
    } catch (e) {
      state = state.copyWith(error: '发送失败: $e');
    }
  }

  /// 发送输入状态
  void sendTypingStatus(bool isTyping) {
    final wsService = _ref.read(chatWsServiceProvider);
    wsService.emit(WsEvents.messageTyping, {
      'converseId': converseId,
      'isTyping': isTyping,
    });

    // 自动在 2 秒后发送停止输入
    _typingTimer?.cancel();
    if (isTyping) {
      _typingTimer = Timer(const Duration(seconds: 2), () {
        sendTypingStatus(false);
      });
    }
  }

  void _listenForRealtime() {
    final wsService = _ref.read(chatWsServiceProvider);

    // 新消息
    wsService.on(WsEvents.messageNew, (data) {
      final msg = Message.fromJson(data as Map<String, dynamic>);
      if (msg.converseId == converseId) {
        state = state.copyWith(
          messages: [msg, ...state.messages],
        );
      }
    });

    // 消息编辑
    wsService.on(WsEvents.messageUpdated, (data) {
      final payload = data as Map<String, dynamic>;
      final msgId = payload['id'] as String;
      final newContent = payload['content'] as String;
      final updatedAt = DateTime.parse(payload['updatedAt'] as String);

      state = state.copyWith(
        messages: state.messages.map((m) {
          if (m.id == msgId) {
            return m.copyWith(content: newContent, updatedAt: updatedAt);
          }
          return m;
        }).toList(),
      );
    });

    // 消息撤回
    wsService.on(WsEvents.messageDeleted, (data) {
      final payload = data as Map<String, dynamic>;
      final msgId = payload['id'] as String;
      final deletedAt = DateTime.parse(payload['deletedAt'] as String);

      state = state.copyWith(
        messages: state.messages.map((m) {
          if (m.id == msgId) {
            return m.copyWith(deletedAt: deletedAt);
          }
          return m;
        }).toList(),
      );
    });
  }

  @override
  void dispose() {
    _typingTimer?.cancel();
    // 离开 WS 房间
    final wsService = _ref.read(chatWsServiceProvider);
    wsService.emit(WsEvents.converseLeave, {'converseId': converseId});
    wsService.off(WsEvents.messageNew);
    wsService.off(WsEvents.messageUpdated);
    wsService.off(WsEvents.messageDeleted);
    super.dispose();
  }
}

/// 基于 converseId 创建的 family provider
final messageProvider = StateNotifierProvider.family<
    MessageNotifier, MessageListState, String>((ref, converseId) {
  return MessageNotifier(ref, converseId);
});

/// 输入状态 provider（谁正在输入）
final typingUsersProvider =
    StateProvider.family<Set<String>, String>((ref, converseId) => {});
```

### 会话列表页面

```dart
// lib/features/chat/pages/converse_list_page.dart

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/converse_provider.dart';
import '../widgets/converse_tile.dart';

class ConverseListPage extends ConsumerWidget {
  const ConverseListPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final conversesAsync = ref.watch(converseListProvider);

    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F5),
      appBar: AppBar(
        title: const Text('消息'),
        backgroundColor: const Color(0xFFEDEDED),
        foregroundColor: const Color(0xFF333333),
        elevation: 0.5,
      ),
      body: conversesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, size: 48, color: Colors.red),
              const SizedBox(height: 16),
              Text('加载失败: $error'),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () =>
                    ref.read(converseListProvider.notifier).fetchConverses(),
                child: const Text('重试'),
              ),
            ],
          ),
        ),
        data: (converses) {
          if (converses.isEmpty) {
            return const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.chat_bubble_outline, size: 64, color: Colors.grey),
                  SizedBox(height: 16),
                  Text(
                    '暂无会话\n添加好友后即可开始聊天',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey, fontSize: 16),
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () =>
                ref.read(converseListProvider.notifier).fetchConverses(),
            child: ListView.separated(
              itemCount: converses.length,
              separatorBuilder: (_, __) =>
                  const Divider(height: 1, indent: 72),
              itemBuilder: (context, index) {
                final converse = converses[index];
                return ConverseTile(
                  converse: converse,
                  onTap: () => context.push('/chat/${converse.id}'),
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

### 聊天页面

```dart
// lib/features/chat/pages/chat_page.dart

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/converse_provider.dart';
import '../providers/message_provider.dart';
import '../widgets/message_bubble.dart';
import '../widgets/message_input.dart';
import '../widgets/typing_indicator.dart';

class ChatPage extends ConsumerStatefulWidget {
  final String converseId;

  const ChatPage({super.key, required this.converseId});

  @override
  ConsumerState<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends ConsumerState<ChatPage> {
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    // 清除未读数
    ref.read(converseListProvider.notifier).clearUnreadCount(widget.converseId);

    // 滚动到顶部时加载更多
    _scrollController.addListener(_onScroll);
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      // 接近顶部（ListView 倒序，maxScrollExtent = 最旧的消息）
      ref.read(messageProvider(widget.converseId).notifier).loadMessages();
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final messageState = ref.watch(messageProvider(widget.converseId));
    final typingUsers = ref.watch(typingUsersProvider(widget.converseId));

    return Scaffold(
      backgroundColor: const Color(0xFFEDEDED),
      appBar: AppBar(
        title: const Text('聊天'), // 实际使用时替换为对方用户名
        backgroundColor: const Color(0xFFEDEDED),
        foregroundColor: const Color(0xFF333333),
        elevation: 0.5,
      ),
      body: Column(
        children: [
          // 消息列表
          Expanded(
            child: messageState.isLoading && messageState.messages.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    controller: _scrollController,
                    reverse: true, // 最新消息在底部
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    itemCount: messageState.messages.length +
                        (messageState.isLoading ? 1 : 0),
                    itemBuilder: (context, index) {
                      // 加载指示器在列表顶部（reverse 后在底部）
                      if (index == messageState.messages.length) {
                        return const Center(
                          child: Padding(
                            padding: EdgeInsets.all(16),
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        );
                      }

                      final message = messageState.messages[index];
                      return MessageBubble(
                        message: message,
                        isMe: false, // 需要从 auth provider 获取当前 userId 判断
                      );
                    },
                  ),
          ),

          // 输入状态指示
          if (typingUsers.isNotEmpty)
            TypingIndicator(userIds: typingUsers.toList()),

          // 消息输入框
          MessageInput(
            onSend: (content) {
              ref
                  .read(messageProvider(widget.converseId).notifier)
                  .sendMessage(content);
            },
            onTypingChanged: (isTyping) {
              ref
                  .read(messageProvider(widget.converseId).notifier)
                  .sendTypingStatus(isTyping);
            },
          ),
        ],
      ),
    );
  }
}
```

### Widget 组件

```dart
// lib/features/chat/widgets/converse_tile.dart

import 'package:flutter/material.dart';
import '../models/converse.dart';

class ConverseTile extends StatelessWidget {
  final Converse converse;
  final VoidCallback onTap;

  const ConverseTile({super.key, required this.converse, required this.onTap});

  @override
  Widget build(BuildContext context) {
    // DM 时显示对方头像和名字
    final displayName = converse.displayName('current_user_id'); // 需要注入实际 userId
    final lastMsg = converse.lastMessage;

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: CircleAvatar(
        radius: 24,
        backgroundColor: const Color(0xFF07C160).withOpacity(0.1),
        child: Text(
          displayName.isNotEmpty ? displayName[0].toUpperCase() : '?',
          style: const TextStyle(
            color: Color(0xFF07C160),
            fontWeight: FontWeight.bold,
            fontSize: 18,
          ),
        ),
      ),
      title: Text(
        displayName,
        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: lastMsg != null
          ? Text(
              '${lastMsg.author.displayName}: ${lastMsg.content}',
              style: const TextStyle(fontSize: 13, color: Colors.grey),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            )
          : null,
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (lastMsg != null)
            Text(
              _formatTime(lastMsg.createdAt),
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
          const SizedBox(height: 4),
          if (converse.unreadCount > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.red,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                converse.unreadCount > 99
                    ? '99+'
                    : converse.unreadCount.toString(),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
        ],
      ),
      onTap: onTap,
    );
  }

  String _formatTime(DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);
    if (diff.inMinutes < 1) return '刚刚';
    if (diff.inHours < 1) return '${diff.inMinutes}分钟前';
    if (diff.inDays < 1) return '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
    if (diff.inDays < 7) return '${diff.inDays}天前';
    return '${time.month}/${time.day}';
  }
}
```

```dart
// lib/features/chat/widgets/message_bubble.dart

import 'package:flutter/material.dart';
import '../models/message.dart';

class MessageBubble extends StatelessWidget {
  final Message message;
  final bool isMe;

  const MessageBubble({super.key, required this.message, required this.isMe});

  @override
  Widget build(BuildContext context) {
    // 已撤回消息
    if (message.isDeleted) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Center(
          child: Text(
            '${message.author.displayName} 撤回了一条消息',
            style: const TextStyle(color: Colors.grey, fontSize: 12),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment:
            isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 对方头像（自己发的不显示）
          if (!isMe)
            CircleAvatar(
              radius: 16,
              backgroundColor: Colors.grey.withOpacity(0.2),
              child: Text(
                message.author.displayName[0].toUpperCase(),
                style: const TextStyle(fontSize: 12, color: Colors.grey),
              ),
            ),
          if (!isMe) const SizedBox(width: 8),

          // 消息气泡
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: isMe ? const Color(0xFF95EC69) : Colors.white,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    message.content,
                    style: const TextStyle(fontSize: 15),
                  ),
                  if (message.isEdited)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        '(已编辑)',
                        style: TextStyle(
                          fontSize: 11,
                          color: Colors.grey[600],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),

          if (isMe) const SizedBox(width: 8),
          if (isMe)
            CircleAvatar(
              radius: 16,
              backgroundColor: const Color(0xFF07C160).withOpacity(0.2),
              child: Text(
                message.author.displayName[0].toUpperCase(),
                style: const TextStyle(fontSize: 12, color: Color(0xFF07C160)),
              ),
            ),
        ],
      ),
    );
  }
}
```

```dart
// lib/features/chat/widgets/message_input.dart

import 'package:flutter/material.dart';

class MessageInput extends StatefulWidget {
  final void Function(String content) onSend;
  final void Function(bool isTyping) onTypingChanged;

  const MessageInput({
    super.key,
    required this.onSend,
    required this.onTypingChanged,
  });

  @override
  State<MessageInput> createState() => _MessageInputState();
}

class _MessageInputState extends State<MessageInput> {
  final _controller = TextEditingController();
  bool _isTyping = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _handleTextChanged(String text) {
    final nowTyping = text.trim().isNotEmpty;
    if (nowTyping != _isTyping) {
      _isTyping = nowTyping;
      widget.onTypingChanged(nowTyping);
    }
  }

  void _handleSend() {
    final content = _controller.text.trim();
    if (content.isEmpty) return;

    widget.onSend(content);
    _controller.clear();
    _isTyping = false;
    widget.onTypingChanged(false);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
      decoration: const BoxDecoration(
        color: Color(0xFFF5F5F5),
        border: Border(
          top: BorderSide(color: Color(0xFFDDDDDD), width: 0.5),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(8),
              ),
              child: TextField(
                controller: _controller,
                onChanged: _handleTextChanged,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _handleSend(),
                maxLines: 4,
                minLines: 1,
                decoration: const InputDecoration(
                  hintText: '输入消息...',
                  hintStyle: TextStyle(color: Colors.grey),
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                ),
                style: const TextStyle(fontSize: 15),
              ),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            height: 40,
            child: ElevatedButton(
              onPressed: _handleSend,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF07C160),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 16),
              ),
              child: const Text('发送'),
            ),
          ),
        ],
      ),
    );
  }
}
```

```dart
// lib/features/chat/widgets/typing_indicator.dart

import 'package:flutter/material.dart';

class TypingIndicator extends StatelessWidget {
  final List<String> userIds;

  const TypingIndicator({super.key, required this.userIds});

  @override
  Widget build(BuildContext context) {
    if (userIds.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      alignment: Alignment.centerLeft,
      child: Text(
        userIds.length == 1
            ? '对方正在输入...'
            : '${userIds.length} 人正在输入...',
        style: const TextStyle(
          fontSize: 12,
          color: Colors.grey,
          fontStyle: FontStyle.italic,
        ),
      ),
    );
  }
}
```

### 路由配置更新

```dart
// lib/router.dart — 新增 chat 路由

GoRoute(
  path: '/converses',
  builder: (context, state) => const ConverseListPage(),
),
GoRoute(
  path: '/chat/:converseId',
  builder: (context, state) => ChatPage(
    converseId: state.pathParameters['converseId']!,
  ),
),
```

---

## 2.11 Desktop 聊天 UI

桌面端采用左右分栏布局：左侧为会话列表（固定宽度 300px），右侧为消息面板。使用 React + TypeScript 实现。

### IPC 扩展

```typescript
// apps/desktop/src/preload/index.ts — 新增 chat 相关 API

export const electronAPI = {
  // ... 既有 auth + device API ...

  // Chat
  getConverses: () => ipcRenderer.invoke('chat:get-converses'),
  getMessages: (converseId: string, cursor?: string) =>
    ipcRenderer.invoke('chat:get-messages', converseId, cursor),
  sendMessage: (converseId: string, content: string) =>
    ipcRenderer.invoke('chat:send-message', converseId, content),

  // Chat WS events (main → renderer)
  onMessageNew: (callback: (msg: unknown) => void) => {
    ipcRenderer.on('chat:message-new', (_event, msg) => callback(msg));
  },
  onMessageUpdated: (callback: (msg: unknown) => void) => {
    ipcRenderer.on('chat:message-updated', (_event, msg) => callback(msg));
  },
  onMessageDeleted: (callback: (msg: unknown) => void) => {
    ipcRenderer.on('chat:message-deleted', (_event, msg) => callback(msg));
  },
  onTypingStatus: (callback: (data: unknown) => void) => {
    ipcRenderer.on('chat:typing-status', (_event, data) => callback(data));
  },
};
```

### Chat 主页面（左右分栏）

```tsx
// apps/desktop/src/renderer/pages/Chat.tsx

import { useState } from 'react';
import { ConverseList } from '../components/ConverseList';
import { ChatPanel } from '../components/ChatPanel';

export function Chat() {
  const [activeConverseId, setActiveConverseId] = useState<string | null>(null);

  return (
    <div className="chat-layout" style={{ display: 'flex', height: '100vh' }}>
      {/* 左侧：会话列表 */}
      <div
        className="converse-list-panel"
        style={{
          width: 300,
          borderRight: '1px solid #ddd',
          overflow: 'auto',
        }}
      >
        <ConverseList
          activeId={activeConverseId}
          onSelect={(id) => setActiveConverseId(id)}
        />
      </div>

      {/* 右侧：消息面板 */}
      <div className="chat-panel" style={{ flex: 1 }}>
        {activeConverseId ? (
          <ChatPanel converseId={activeConverseId} />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#999',
            }}
          >
            选择一个会话开始聊天
          </div>
        )}
      </div>
    </div>
  );
}
```

### ConverseList 组件

```tsx
// apps/desktop/src/renderer/components/ConverseList.tsx

import { useState, useEffect } from 'react';

interface Converse {
  id: string;
  type: string;
  name: string | null;
  members: Array<{
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    status: string;
  }>;
  lastMessage: {
    content: string;
    author: { displayName: string };
    createdAt: string;
  } | null;
  unreadCount: number;
}

interface ConverseListProps {
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function ConverseList({ activeId, onSelect }: ConverseListProps) {
  const [converses, setConverses] = useState<Converse[]>([]);

  useEffect(() => {
    window.electronAPI.getConverses().then(setConverses);

    // 监听新消息更新列表
    window.electronAPI.onMessageNew(() => {
      window.electronAPI.getConverses().then(setConverses);
    });
  }, []);

  return (
    <div className="converse-list">
      <div style={{ padding: '16px', fontWeight: 'bold', fontSize: 18 }}>
        消息
      </div>
      {converses.map((converse) => (
        <div
          key={converse.id}
          className={`converse-item ${activeId === converse.id ? 'active' : ''}`}
          onClick={() => onSelect(converse.id)}
          style={{
            padding: '12px 16px',
            cursor: 'pointer',
            backgroundColor: activeId === converse.id ? '#e8e8e8' : 'transparent',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>
              {converse.name || converse.members[0]?.displayName || '未知'}
            </strong>
            {converse.unreadCount > 0 && (
              <span
                style={{
                  backgroundColor: 'red',
                  color: 'white',
                  borderRadius: 10,
                  padding: '1px 6px',
                  fontSize: 12,
                }}
              >
                {converse.unreadCount}
              </span>
            )}
          </div>
          {converse.lastMessage && (
            <div
              style={{
                fontSize: 13,
                color: '#999',
                marginTop: 4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {converse.lastMessage.author.displayName}:{' '}
              {converse.lastMessage.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

### ChatPanel 组件

```tsx
// apps/desktop/src/renderer/components/ChatPanel.tsx

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { TypingIndicator } from './TypingIndicator';

interface Message {
  id: string;
  content: string;
  type: string;
  author: { id: string; displayName: string; avatarUrl: string | null };
  converseId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface ChatPanelProps {
  converseId: string;
}

export function ChatPanel({ converseId }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 加载消息
  const loadMessages = useCallback(
    async (cursor?: string) => {
      if (loading) return;
      setLoading(true);

      const result = await window.electronAPI.getMessages(converseId, cursor);
      const newMessages = result.messages as Message[];

      setMessages((prev) =>
        cursor ? [...prev, ...newMessages] : newMessages,
      );
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
      setLoading(false);
    },
    [converseId, loading],
  );

  // 初始加载
  useEffect(() => {
    loadMessages();

    // 加入 WS 房间（通过 IPC 通知主进程）
    // 主进程 ws-client emit converse:join

    // 监听实时事件
    window.electronAPI.onMessageNew((msg: unknown) => {
      const message = msg as Message;
      if (message.converseId === converseId) {
        setMessages((prev) => [message, ...prev]);
      }
    });

    window.electronAPI.onMessageUpdated((data: unknown) => {
      const payload = data as { id: string; content: string; updatedAt: string };
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.id
            ? { ...m, content: payload.content, updatedAt: payload.updatedAt }
            : m,
        ),
      );
    });

    window.electronAPI.onMessageDeleted((data: unknown) => {
      const payload = data as { id: string; deletedAt: string };
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.id
            ? { ...m, deletedAt: payload.deletedAt }
            : m,
        ),
      );
    });

    window.electronAPI.onTypingStatus((data: unknown) => {
      const payload = data as { userId: string; isTyping: boolean };
      setTypingUsers((prev) =>
        payload.isTyping
          ? [...new Set([...prev, payload.userId])]
          : prev.filter((id) => id !== payload.userId),
      );
    });
  }, [converseId]);

  // 发送消息
  const handleSend = async (content: string) => {
    await window.electronAPI.sendMessage(converseId, content);
  };

  // 滚动加载更多
  const handleScrollTop = () => {
    if (hasMore && nextCursor) {
      loadMessages(nextCursor);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* 消息列表 */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column-reverse',
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.scrollHeight - el.clientHeight < 50) {
            handleScrollTop();
          }
        }}
      >
        <div ref={messagesEndRef} />
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} isMe={false} />
        ))}
        {loading && (
          <div style={{ textAlign: 'center', padding: 8, color: '#999' }}>
            加载中...
          </div>
        )}
      </div>

      {/* 输入状态 */}
      {typingUsers.length > 0 && (
        <TypingIndicator users={typingUsers} />
      )}

      {/* 输入框 */}
      <MessageInput onSend={handleSend} />
    </div>
  );
}
```

### MessageBubble + MessageInput + TypingIndicator

```tsx
// apps/desktop/src/renderer/components/MessageBubble.tsx

interface Message {
  id: string;
  content: string;
  author: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface MessageBubbleProps {
  message: Message;
  isMe: boolean;
}

export function MessageBubble({ message, isMe }: MessageBubbleProps) {
  // 已撤回消息
  if (message.deletedAt) {
    return (
      <div style={{ textAlign: 'center', color: '#999', fontSize: 12, padding: 4 }}>
        {message.author.displayName} 撤回了一条消息
      </div>
    );
  }

  const isEdited = message.updatedAt > message.createdAt;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isMe ? 'flex-end' : 'flex-start',
        marginBottom: 8,
      }}
    >
      <div
        style={{
          maxWidth: '60%',
          padding: '8px 12px',
          borderRadius: 8,
          backgroundColor: isMe ? '#95EC69' : '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        }}
      >
        {!isMe && (
          <div style={{ fontSize: 12, color: '#999', marginBottom: 2 }}>
            {message.author.displayName}
          </div>
        )}
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{message.content}</div>
        {isEdited && (
          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
            (已编辑)
          </div>
        )}
      </div>
    </div>
  );
}
```

```tsx
// apps/desktop/src/renderer/components/MessageInput.tsx

import { useState, type FormEvent } from 'react';

interface MessageInputProps {
  onSend: (content: string) => void;
}

export function MessageInput({ onSend }: MessageInputProps) {
  const [text, setText] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    onSend(content);
    setText('');
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        padding: '8px 12px',
        borderTop: '1px solid #ddd',
        backgroundColor: '#f5f5f5',
      }}
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入消息..."
        style={{
          flex: 1,
          padding: '8px 12px',
          border: 'none',
          borderRadius: 8,
          fontSize: 14,
          outline: 'none',
        }}
      />
      <button
        type="submit"
        style={{
          marginLeft: 8,
          padding: '8px 16px',
          backgroundColor: '#07C160',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        发送
      </button>
    </form>
  );
}
```

```tsx
// apps/desktop/src/renderer/components/TypingIndicator.tsx

interface TypingIndicatorProps {
  users: string[];
}

export function TypingIndicator({ users }: TypingIndicatorProps) {
  if (users.length === 0) return null;

  return (
    <div
      style={{
        padding: '4px 16px',
        fontSize: 12,
        color: '#999',
        fontStyle: 'italic',
      }}
    >
      {users.length === 1 ? '对方正在输入...' : `${users.length} 人正在输入...`}
    </div>
  );
}
```

---

## 2.12 单元 + E2E 测试

### 单元测试 — MessagesService

```typescript
// apps/server/src/messages/messages.service.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService } from '../gateway/broadcast.service';
import { ConversesService } from '../converses/converses.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('MessagesService', () => {
  let service: MessagesService;
  let prisma: jest.Mocked<PrismaService>;
  let broadcastService: jest.Mocked<BroadcastService>;
  let conversesService: jest.Mocked<ConversesService>;

  const mockUser = { id: 'user-1', username: 'alice', displayName: 'Alice', avatarUrl: null };
  const mockMessage = {
    id: 'msg-1',
    content: 'Hello!',
    type: 'TEXT',
    authorId: 'user-1',
    converseId: 'conv-1',
    replyToId: null,
    metadata: null,
    createdAt: new Date('2026-02-14T10:00:00Z'),
    updatedAt: new Date('2026-02-14T10:00:00Z'),
    deletedAt: null,
    author: mockUser,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        {
          provide: PrismaService,
          useValue: {
            message: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            converseMember: {
              updateMany: jest.fn(),
            },
            converse: {
              update: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: BroadcastService,
          useValue: {
            toRoom: jest.fn(),
            toRoomIfNotIn: jest.fn(),
          },
        },
        {
          provide: ConversesService,
          useValue: {
            verifyMembership: jest.fn(),
            getMemberIds: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
    prisma = module.get(PrismaService);
    broadcastService = module.get(BroadcastService);
    conversesService = module.get(ConversesService);
  });

  describe('create', () => {
    it('should create message and broadcast message:new', async () => {
      conversesService.verifyMembership.mockResolvedValue({ converseId: 'conv-1', userId: 'user-1' } as any);
      prisma.message.create.mockResolvedValue(mockMessage as any);
      prisma.$transaction.mockResolvedValue([]);
      conversesService.getMemberIds.mockResolvedValue(['user-1', 'user-2']);

      const result = await service.create('user-1', {
        converseId: 'conv-1',
        content: 'Hello!',
      });

      expect(result.id).toBe('msg-1');
      expect(broadcastService.toRoom).toHaveBeenCalledWith(
        'conv-1',
        'message:new',
        expect.objectContaining({ id: 'msg-1', content: 'Hello!' }),
      );
    });

    it('should throw ForbiddenException if not a member', async () => {
      conversesService.verifyMembership.mockRejectedValue(
        new ForbiddenException('Not a member'),
      );

      await expect(
        service.create('user-999', { converseId: 'conv-1', content: 'test' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findByConverse', () => {
    it('should return paginated messages with hasMore flag', async () => {
      conversesService.verifyMembership.mockResolvedValue({} as any);

      // 返回 36 条（limit + 1），表示还有更多
      const messages = Array.from({ length: 36 }, (_, i) => ({
        ...mockMessage,
        id: `msg-${i}`,
        createdAt: new Date(Date.now() - i * 1000),
      }));
      prisma.message.findMany.mockResolvedValue(messages as any);

      const result = await service.findByConverse('user-1', 'conv-1');

      expect(result.messages).toHaveLength(35);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
    });
  });

  describe('update', () => {
    it('should only allow author to edit message', async () => {
      prisma.message.findUnique.mockResolvedValue(mockMessage as any);

      await expect(
        service.update('user-2', 'msg-1', { content: 'edited' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should update message and broadcast message:updated', async () => {
      prisma.message.findUnique.mockResolvedValue(mockMessage as any);
      prisma.message.update.mockResolvedValue({
        ...mockMessage,
        content: 'edited',
        updatedAt: new Date(),
      } as any);

      const result = await service.update('user-1', 'msg-1', { content: 'edited' });

      expect(result.content).toBe('edited');
      expect(broadcastService.toRoom).toHaveBeenCalledWith(
        'conv-1',
        'message:updated',
        expect.objectContaining({ id: 'msg-1', content: 'edited' }),
      );
    });
  });

  describe('softDelete', () => {
    it('should soft delete and broadcast message:deleted', async () => {
      prisma.message.findUnique.mockResolvedValue(mockMessage as any);
      prisma.message.update.mockResolvedValue({
        ...mockMessage,
        deletedAt: new Date(),
      } as any);

      const result = await service.softDelete('user-1', 'msg-1');

      expect(result.deleted).toBe(true);
      expect(broadcastService.toRoom).toHaveBeenCalledWith(
        'conv-1',
        'message:deleted',
        expect.objectContaining({ id: 'msg-1' }),
      );
    });

    it('should reject deletion by non-author', async () => {
      prisma.message.findUnique.mockResolvedValue(mockMessage as any);

      await expect(
        service.softDelete('user-2', 'msg-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
```

### E2E 测试 — Chat 完整流程

```typescript
// apps/server/test/chat.e2e-spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { io, Socket as ClientSocket } from 'socket.io-client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisIoAdapter } from '../src/gateway/adapters/redis-io.adapter';

describe('Chat (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  // 两个测试用户
  let userA: { id: string; accessToken: string };
  let userB: { id: string; accessToken: string };
  let converseId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);

    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://localhost:${address.port}`;

    prisma = app.get(PrismaService);

    // 注册两个用户
    const resA = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'alice@test.com',
        username: 'alice',
        password: 'Test1234!',
        displayName: 'Alice',
      });
    userA = { id: resA.body.user.id, accessToken: resA.body.accessToken };

    const resB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'bob@test.com',
        username: 'bob',
        password: 'Test1234!',
        displayName: 'Bob',
      });
    userB = { id: resB.body.user.id, accessToken: resB.body.accessToken };

    // 建立好友关系并创建 DM 会话
    // (Phase 1 好友系统负责：发送请求 + 接受 → 自动创建 DM Converse)
    const reqRes = await request(app.getHttpServer())
      .post('/api/v1/friends/request')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ receiverId: userB.id });

    await request(app.getHttpServer())
      .post(`/api/v1/friends/accept/${reqRes.body.id}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);

    // 获取 DM 会话 ID
    const conversesRes = await request(app.getHttpServer())
      .get('/api/v1/converses')
      .set('Authorization', `Bearer ${userA.accessToken}`);
    converseId = conversesRes.body[0].id;
  });

  afterAll(async () => {
    // 清理测试数据
    await prisma.message.deleteMany();
    await prisma.converseMember.deleteMany();
    await prisma.converse.deleteMany();
    await prisma.friendship.deleteMany();
    await prisma.friendRequest.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  // --- REST API Tests ---

  describe('Messages REST API', () => {
    let messageId: string;

    it('POST /api/v1/messages → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/messages')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ converseId, content: 'Hello Bob!' })
        .expect(201);

      messageId = res.body.id;
      expect(res.body.content).toBe('Hello Bob!');
      expect(res.body.author.id).toBe(userA.id);
      expect(res.body.converseId).toBe(converseId);
    });

    it('GET /api/v1/messages?converseId= → paginated messages', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/messages?converseId=${converseId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(res.body.messages).toHaveLength(1);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.messages[0].content).toBe('Hello Bob!');
    });

    it('GET /api/v1/messages non-member → 403', async () => {
      // 创建第三个用户（不是会话成员）
      const resC = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'charlie@test.com',
          username: 'charlie',
          password: 'Test1234!',
          displayName: 'Charlie',
        });

      await request(app.getHttpServer())
        .get(`/api/v1/messages?converseId=${converseId}`)
        .set('Authorization', `Bearer ${resC.body.accessToken}`)
        .expect(403);
    });

    it('PATCH /api/v1/messages/:id → author can edit', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/messages/${messageId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ content: 'Hello Bob! (edited)' })
        .expect(200);

      expect(res.body.content).toBe('Hello Bob! (edited)');
    });

    it('PATCH /api/v1/messages/:id → non-author rejected', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/messages/${messageId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ content: 'hacked' })
        .expect(403);
    });

    it('DELETE /api/v1/messages/:id → soft delete', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/messages/${messageId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(res.body.deleted).toBe(true);

      // 已删除的消息不出现在列表中
      const listRes = await request(app.getHttpServer())
        .get(`/api/v1/messages?converseId=${converseId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(listRes.body.messages).toHaveLength(0);
    });
  });

  // --- WebSocket Tests ---

  describe('Chat WebSocket', () => {
    let socketA: ClientSocket;
    let socketB: ClientSocket;

    function createChatSocket(token: string) {
      return io(`${baseUrl}/chat`, {
        auth: { token, deviceType: 'web' },
        transports: ['websocket'],
        autoConnect: false,
      });
    }

    beforeAll((done) => {
      socketA = createChatSocket(userA.accessToken);
      socketB = createChatSocket(userB.accessToken);

      let connected = 0;
      const onConnect = () => {
        connected++;
        if (connected === 2) done();
      };

      socketA.on('connect', onConnect);
      socketB.on('connect', onConnect);

      socketA.connect();
      socketB.connect();
    });

    afterAll(() => {
      socketA?.disconnect();
      socketB?.disconnect();
    });

    it('converse:join → success', (done) => {
      socketA.emit(
        'converse:join',
        { converseId },
        (ack: { success: boolean }) => {
          expect(ack.success).toBe(true);
          done();
        },
      );
    });

    it('message:new broadcast to room members', (done) => {
      // B joins the room and listens
      socketB.emit('converse:join', { converseId }, () => {
        socketB.once('message:new', (data) => {
          expect(data.content).toBe('Realtime test');
          expect(data.author.id).toBe(userA.id);
          done();
        });

        // A sends message via REST
        request(app.getHttpServer())
          .post('/api/v1/messages')
          .set('Authorization', `Bearer ${userA.accessToken}`)
          .send({ converseId, content: 'Realtime test' })
          .expect(201)
          .then(() => {});
      });
    });

    it('message:typing broadcast to room (excluding sender)', (done) => {
      socketB.once('message:typing', (data) => {
        expect(data.converseId).toBe(converseId);
        expect(data.userId).toBe(userA.id);
        expect(data.isTyping).toBe(true);
        done();
      });

      socketA.emit('message:typing', {
        converseId,
        isTyping: true,
      });
    });

    it('converse:join denied for non-member', (done) => {
      // 使用第三个用户（非成员）连接
      const socketC = createChatSocket(userA.accessToken);
      // 这里简化测试 —— 使用 userA 尝试加入不存在的会话
      socketA.emit(
        'converse:join',
        { converseId: 'non-existent-id' },
        (ack: { success: boolean; error?: { code: string } }) => {
          expect(ack.success).toBe(false);
          expect(ack.error?.code).toBe('JOIN_DENIED');
          done();
        },
      );
    });
  });

  // --- Converse List ---

  describe('GET /api/v1/converses', () => {
    it('returns converses with unread count', async () => {
      // 先发几条消息
      await request(app.getHttpServer())
        .post('/api/v1/messages')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ converseId, content: 'msg 1' });

      await request(app.getHttpServer())
        .post('/api/v1/messages')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ converseId, content: 'msg 2' });

      const res = await request(app.getHttpServer())
        .get('/api/v1/converses')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      const conv = res.body.find((c: any) => c.id === converseId);
      expect(conv).toBeDefined();
      expect(conv.unreadCount).toBeGreaterThanOrEqual(2);
      expect(conv.lastMessage).toBeDefined();
      expect(conv.lastMessage.content).toBe('msg 2');
    });
  });
});
```

---

## WS 事件流总览

### 发送消息

```
Mobile A                    Cloud Brain (NestJS)                  Desktop B
   │                              │                                  │
   │─POST /api/v1/messages───────>│                                  │
   │                              │ 1. verifyMembership              │
   │                              │ 2. INSERT message                │
   │                              │ 3. UPDATE converseMember         │
   │                              │ 4. broadcastService.toRoom()     │
   │                              │─── message:new ──────────────────>│  (B 在 conv 房间)
   │<── message:new ──────────────│                                  │
   │                              │                                  │
   │              如果 B 不在房间:                                     │
   │                              │─── notification:new ─────────────>│  (通过 u-{B} 房间)
```

### 输入状态

```
Mobile A                    Cloud Brain (NestJS)                  Desktop B
   │                              │                                  │
   │─WS message:typing───────────>│                                  │
   │  { converseId, isTyping }    │─── message:typing ───────────────>│  (排除 A)
   │                              │    { converseId, userId, isTyping }│
   │                              │                                  │
   │                              │                          显示 "Alice 正在输入..."
```

### 房间管理

```
Socket.IO 房间结构 (/chat 命名空间):

  u-{userId}      ── 用户个人房间，连接时自动加入
  {converseId}    ── 会话房间，通过 converse:join 事件加入

  用户 A 打开聊天页面:
    → emit('converse:join', { converseId: 'conv-1' })
    → 加入 conv-1 房间
    → 开始收到 message:new / message:updated / message:deleted

  用户 A 切换到其他页面:
    → emit('converse:leave', { converseId: 'conv-1' })
    → 离开 conv-1 房间
    → 不再收到该会话的消息事件
    → 但仍通过 u-{A} 收到 notification:new
```

---

## 完成标准

- [ ] GET /api/v1/converses 返回用户会话列表，包含未读计数和最后消息预览
- [ ] POST /api/v1/messages 创建消息，同房间成员收到 WS `message:new`
- [ ] GET /api/v1/messages?converseId=&cursor= 返回分页消息，游标分页正确工作
- [ ] PATCH /api/v1/messages/:id 仅作者可编辑，WS 广播 `message:updated`
- [ ] DELETE /api/v1/messages/:id 软删除，WS 广播 `message:deleted`
- [ ] ChatGateway /chat 命名空间连接成功（JWT 认证）
- [ ] converse:join/leave 房间管理正常工作
- [ ] message:typing 广播到房间内其他成员（排除发送者）
- [ ] 不在房间内的在线成员收到 notification:new（通过 u-{userId} 个人房间）
- [ ] Flutter：会话列表页显示未读角标 + 最后消息预览
- [ ] Flutter：聊天页面消息气泡正确渲染，支持发送/接收
- [ ] Flutter：向上滚动时自动加载更早的消息（游标分页）
- [ ] Flutter：输入状态指示器正常显示/隐藏
- [ ] Desktop：左右分栏 UI，左侧会话列表 + 右侧消息面板
- [ ] Desktop：实时收发消息，撤回消息显示"已撤回"占位
- [ ] 单元测试：MessagesService CRUD + 权限校验
- [ ] E2E 测试：完整消息收发 + WS 广播 + 游标分页
