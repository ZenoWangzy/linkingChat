> **状态：待开发**

# Sprint 2 — Phase 4：已读回执（Read Receipts）

> **负责人**：后端开发者 + 全端跟进
>
> **前置条件**：Phase 2（1 对 1 聊天）已完成 — MessagesService、ConversesService、ChatGateway(/chat) 可用；ConverseMember 表含 `lastSeenMessageId` 字段；BroadcastService 已就绪
>
> **产出**：消息级别的已读追踪 + 实时同步 — WS `message:read` 事件、未读计数重算、Flutter/Desktop 双勾 UI
>
> **参考**：[sprint2_implement.md](./sprint2_implement.md) Phase 4 | [websocket-protocol.md](../dev-plan/websocket-protocol.md) | [database-schema.md](../dev-plan/database-schema.md)

---

## 任务清单

| # | 任务 | 产出文件 | 依赖 |
|---|------|---------|------|
| 4.1 | WS 事件 message:read（C→S） | `apps/server/src/gateway/chat.gateway.ts` | Phase 2 ChatGateway |
| 4.2 | WS 广播 message:read（S→C） | `apps/server/src/gateway/chat.gateway.ts` | 4.1 |
| 4.3 | 未读计数重算 | `apps/server/src/converses/converses.service.ts` | Phase 2 ConversesService |
| 4.4 | 客户端已读标记 UI（Flutter + Desktop） | Flutter `MessageBubble` + Desktop `MessageBubble` | 4.2 |
| 4.5 | 批量已读（打开会话时） | Flutter `ChatPage` + Desktop `ChatPanel` | 4.1 |

---

## 4.1 WS 事件 message:read（C→S）

客户端打开某个会话时，向服务端发送 `message:read` 事件，携带 `converseId` 和该会话中最新一条消息的 ID。服务端更新 `ConverseMember.lastSeenMessageId`，完成"我已读到这里"的持久化。

### ChatGateway handler

```typescript
// apps/server/src/gateway/chat.gateway.ts — 新增 handler

@SubscribeMessage('message:read')
async handleMessageRead(
  client: TypedSocket,
  data: { converseId: string; lastSeenMessageId: string },
) {
  const userId = client.data.userId;

  // 1. 校验参数
  if (!data.converseId || !data.lastSeenMessageId) {
    return;
  }

  // 2. 校验用户是否为该会话成员
  const member = await this.prisma.converseMember.findUnique({
    where: {
      converseId_userId: {
        converseId: data.converseId,
        userId,
      },
    },
  });

  if (!member) {
    this.logger.warn(
      `message:read rejected: user ${userId} is not a member of converse ${data.converseId}`,
    );
    return;
  }

  // 3. 校验 lastSeenMessageId 确实属于该会话
  const message = await this.prisma.message.findFirst({
    where: {
      id: data.lastSeenMessageId,
      converseId: data.converseId,
      deletedAt: null,
    },
    select: { id: true, createdAt: true },
  });

  if (!message) {
    this.logger.warn(
      `message:read rejected: message ${data.lastSeenMessageId} not found in converse ${data.converseId}`,
    );
    return;
  }

  // 4. 防止游标回退 — 仅在新消息比当前已读位置更新时才更新
  if (member.lastSeenMessageId) {
    const currentLastSeen = await this.prisma.message.findUnique({
      where: { id: member.lastSeenMessageId },
      select: { createdAt: true },
    });

    if (currentLastSeen && currentLastSeen.createdAt >= message.createdAt) {
      // 当前已读位置已经更新或相同，无需回退
      return;
    }
  }

  // 5. 更新 DB
  await this.prisma.converseMember.update({
    where: {
      converseId_userId: {
        converseId: data.converseId,
        userId,
      },
    },
    data: { lastSeenMessageId: data.lastSeenMessageId },
  });

  // 6. 广播给同会话其他成员（见 4.2）
  client.to(data.converseId).emit('message:read', {
    converseId: data.converseId,
    userId,
    lastSeenMessageId: data.lastSeenMessageId,
  });

  this.logger.debug(
    `message:read: user=${userId} converse=${data.converseId} lastSeen=${data.lastSeenMessageId}`,
  );
}
```

**要点**：
- 不使用 ack 回调 — `message:read` 是 fire-and-forget 事件，客户端不需要等待确认
- 防回退逻辑确保用户不会意外将已读位置倒退（例如客户端重发旧事件）
- 校验消息归属防止跨会话篡改已读状态

---

## 4.2 WS 广播 message:read（S→C）

在 4.1 的 handler 中，更新 DB 后立即通过 Socket.IO 房间广播 `message:read` 事件给同会话的其他成员。

### 广播数据结构

```typescript
// 广播给 {converseId} 房间中除发送者外的所有 socket

interface MessageReadBroadcast {
  converseId: string;          // 哪个会话
  userId: string;              // 谁已读
  lastSeenMessageId: string;   // 读到了哪条消息
}
```

### 广播逻辑（已包含在 4.1 handler 末尾）

```typescript
// 使用 client.to(room).emit() — 排除发送者自身
client.to(data.converseId).emit('message:read', {
  converseId: data.converseId,
  userId,
  lastSeenMessageId: data.lastSeenMessageId,
});
```

### WS 事件常量更新

```typescript
// packages/ws-protocol/src/events.ts — 新增

export const ChatEvents = {
  // ... existing events ...
  MESSAGE_READ: 'message:read',
} as const;
```

```dart
// apps/mobile/lib/core/constants/ws_events.dart — 新增

class WsEvents {
  // ... existing events ...
  static const messageRead = 'message:read';
}
```

**要点**：
- `client.to(room)` 发送给房间内除 `client` 自身以外的所有 socket，发送者不会收到自己的已读广播
- 在 DM 场景下，房间内只有两个用户，广播的实际接收者就是对方一人
- 群聊场景（Sprint 3）下，所有群成员都会收到，用于渲染"已读人数"

---

## 4.3 未读计数重算

在 `ConversesService` 中新增基于 `lastSeenMessageId` 游标的未读消息计数方法。此方法被会话列表 API（`GET /api/v1/converses`）调用，也在客户端收到 `message:read` 后本地重算。

### ConversesService 方法

```typescript
// apps/server/src/converses/converses.service.ts — 新增方法

/**
 * 计算用户在指定会话中的未读消息数。
 *
 * 算法：以 lastSeenMessageId 对应消息的 createdAt 为分界线，
 * 统计该时间之后、非本人发送的、未删除的消息数量。
 *
 * 若 lastSeenMessageId 为 null（从未已读），则统计全部非本人消息。
 */
async getUnreadCount(converseId: string, userId: string): Promise<number> {
  const member = await this.prisma.converseMember.findUnique({
    where: {
      converseId_userId: { converseId, userId },
    },
    select: { lastSeenMessageId: true },
  });

  if (!member) return 0;

  if (!member.lastSeenMessageId) {
    // 从未已读 — 统计全部非本人发送的消息
    return this.prisma.message.count({
      where: {
        converseId,
        authorId: { not: userId },
        deletedAt: null,
      },
    });
  }

  // 查找 lastSeenMessage 的 createdAt 作为时间游标
  const lastSeen = await this.prisma.message.findUnique({
    where: { id: member.lastSeenMessageId },
    select: { createdAt: true },
  });

  if (!lastSeen) {
    // lastSeenMessageId 指向的消息已被硬删除（极端边界），回退到全量计数
    return this.prisma.message.count({
      where: {
        converseId,
        authorId: { not: userId },
        deletedAt: null,
      },
    });
  }

  // 统计 lastSeenMessage 之后的非本人消息
  return this.prisma.message.count({
    where: {
      converseId,
      createdAt: { gt: lastSeen.createdAt },
      authorId: { not: userId },
      deletedAt: null,
    },
  });
}
```

### 会话列表 API 集成

```typescript
// apps/server/src/converses/converses.service.ts — findAllByUser 方法中调用

async findAllByUser(userId: string) {
  const members = await this.prisma.converseMember.findMany({
    where: { userId, isOpen: true },
    include: {
      converse: {
        include: {
          members: {
            include: {
              user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              content: true,
              createdAt: true,
              author: { select: { id: true, displayName: true } },
            },
          },
        },
      },
    },
    orderBy: { converse: { updatedAt: 'desc' } },
  });

  // 并行计算每个会话的未读数
  const conversesWithUnread = await Promise.all(
    members.map(async (m) => ({
      ...m.converse,
      lastMessage: m.converse.messages[0] ?? null,
      unreadCount: await this.getUnreadCount(m.converseId, userId),
    })),
  );

  return conversesWithUnread;
}
```

### 响应格式

```json
[
  {
    "id": "clxyz...",
    "type": "DM",
    "name": null,
    "members": [
      { "user": { "id": "...", "displayName": "Alice", "avatarUrl": "..." } },
      { "user": { "id": "...", "displayName": "Bob", "avatarUrl": "..." } }
    ],
    "lastMessage": {
      "id": "clxyz...",
      "content": "你好！",
      "createdAt": "2026-02-14T10:30:00Z",
      "author": { "id": "...", "displayName": "Alice" }
    },
    "unreadCount": 3
  }
]
```

**要点**：
- 使用 `createdAt` 而非 `id` 比较来确定消息先后顺序，因为 CUID 不保证时间有序
- `deletedAt: null` 过滤已撤回的消息，撤回消息不计入未读
- `authorId: { not: userId }` 排除自己发送的消息，自己的消息不算未读
- `Promise.all` 并行计算避免串行 N+1 查询

---

## 4.4 客户端已读标记 UI

在消息气泡上显示送达/已读状态标记，仅对当前用户发送的消息显示（DM 场景）。

### 状态定义

| 状态 | 标记 | 含义 |
|------|------|------|
| 发送中 | 无标记（或时钟图标） | 消息正在发送，服务端尚未确认 |
| 已送达 | 单勾 &#10003; | 服务端已确认收到（`message:new` 广播成功） |
| 已读 | 双勾 &#10003;&#10003; | 对方已读（`lastSeenMessageId >= 此消息 ID`） |

### 判断逻辑

```
对方的 lastSeenMessageId 对应消息的 createdAt >= 当前消息的 createdAt
  → 已读（双勾）
否则
  → 已送达（单勾）
```

### Flutter 实现

#### 消息状态枚举

```dart
// apps/mobile/lib/features/chat/models/message_status.dart

enum MessageDeliveryStatus {
  sending,    // 发送中
  delivered,  // 已送达（单勾）
  read,       // 已读（双勾）
}
```

#### MessageBubble 状态指示器 Widget

```dart
// apps/mobile/lib/features/chat/widgets/read_status_indicator.dart

import 'package:flutter/material.dart';
import '../models/message_status.dart';

class ReadStatusIndicator extends StatelessWidget {
  final MessageDeliveryStatus status;

  const ReadStatusIndicator({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    switch (status) {
      case MessageDeliveryStatus.sending:
        return const SizedBox(
          width: 14,
          height: 14,
          child: CircularProgressIndicator(
            strokeWidth: 1.5,
            color: Colors.grey,
          ),
        );
      case MessageDeliveryStatus.delivered:
        return const Icon(
          Icons.check,
          size: 16,
          color: Colors.grey,
        );
      case MessageDeliveryStatus.read:
        return const Icon(
          Icons.done_all,
          size: 16,
          color: Color(0xFF07C160), // 微信绿
        );
    }
  }
}
```

#### MessageBubble 集成

```dart
// apps/mobile/lib/features/chat/widgets/message_bubble.dart — 已发送消息气泡底部

// 仅对自己发送的消息 + DM 会话显示状态
if (message.authorId == currentUserId && converseType == ConverseType.DM)
  Padding(
    padding: const EdgeInsets.only(top: 2),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          _formatTime(message.createdAt),
          style: const TextStyle(fontSize: 11, color: Colors.grey),
        ),
        const SizedBox(width: 4),
        ReadStatusIndicator(
          status: _getDeliveryStatus(message),
        ),
      ],
    ),
  ),
```

#### 已读状态计算

```dart
// apps/mobile/lib/features/chat/providers/message_provider.dart

MessageDeliveryStatus _getDeliveryStatus(Message message) {
  // 如果消息尚未服务端确认
  if (message.isPending) {
    return MessageDeliveryStatus.sending;
  }

  // 获取对方的 lastSeenMessageId 对应的 createdAt
  final peerLastSeenCreatedAt = _peerLastSeenCreatedAt;
  if (peerLastSeenCreatedAt == null) {
    return MessageDeliveryStatus.delivered;
  }

  // 对方已读位置 >= 当前消息时间 → 已读
  if (!peerLastSeenCreatedAt.isBefore(message.createdAt)) {
    return MessageDeliveryStatus.read;
  }

  return MessageDeliveryStatus.delivered;
}
```

#### Provider 中监听 message:read 事件

```dart
// apps/mobile/lib/features/chat/providers/message_provider.dart

class MessageNotifier extends StateNotifier<MessageState> {
  DateTime? _peerLastSeenCreatedAt;

  MessageNotifier(this._ref) : super(const MessageState()) {
    _listenForReadReceipts();
  }

  void _listenForReadReceipts() {
    final wsService = _ref.read(wsServiceProvider);

    wsService.on(WsEvents.messageRead, (data) {
      final payload = data as Map<String, dynamic>;
      final converseId = payload['converseId'] as String;
      final readUserId = payload['userId'] as String;
      final lastSeenMessageId = payload['lastSeenMessageId'] as String;

      // 只处理当前打开的会话 + 非自己的已读回执
      if (converseId != state.currentConverseId) return;
      if (readUserId == _currentUserId) return;

      // 更新对方已读位置
      _updatePeerLastSeen(lastSeenMessageId);

      // 触发 UI 重建
      state = state.copyWith(
        peerLastSeenMessageId: lastSeenMessageId,
        rebuildTrigger: DateTime.now().millisecondsSinceEpoch,
      );
    });
  }

  void _updatePeerLastSeen(String messageId) {
    // 从当前消息列表中查找该消息的 createdAt
    final message = state.messages.firstWhereOrNull((m) => m.id == messageId);
    if (message != null) {
      _peerLastSeenCreatedAt = message.createdAt;
    }
  }

  /// 标记会话已读 — 发送 message:read 事件
  void markAsRead(String converseId, String lastMessageId) {
    final wsService = _ref.read(wsServiceProvider);
    wsService.emit(WsEvents.messageRead, {
      'converseId': converseId,
      'lastSeenMessageId': lastMessageId,
    });
  }
}
```

### Desktop 实现

#### MessageBubble 组件

```tsx
// apps/desktop/src/renderer/components/chat/MessageBubble.tsx

import React from 'react';

interface ReadStatusProps {
  status: 'sending' | 'delivered' | 'read';
}

const ReadStatusIndicator: React.FC<ReadStatusProps> = ({ status }) => {
  switch (status) {
    case 'sending':
      return <span className="text-gray-400 text-xs">...</span>;
    case 'delivered':
      return <span className="text-gray-400 text-sm">&#10003;</span>;
    case 'read':
      return <span className="text-green-500 text-sm">&#10003;&#10003;</span>;
  }
};

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  converseType: 'DM' | 'MULTI' | 'GROUP';
  peerLastSeenCreatedAt?: Date;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isOwn,
  converseType,
  peerLastSeenCreatedAt,
}) => {
  const getDeliveryStatus = (): 'sending' | 'delivered' | 'read' => {
    if (message.isPending) return 'sending';
    if (!peerLastSeenCreatedAt) return 'delivered';
    if (peerLastSeenCreatedAt >= new Date(message.createdAt)) return 'read';
    return 'delivered';
  };

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[70%] rounded-lg px-3 py-2 ${
          isOwn ? 'bg-green-100' : 'bg-white'
        }`}
      >
        <p className="text-sm text-gray-800">{message.content}</p>
        <div className="flex items-center justify-end gap-1 mt-1">
          <span className="text-xs text-gray-400">
            {formatTime(message.createdAt)}
          </span>
          {isOwn && converseType === 'DM' && (
            <ReadStatusIndicator status={getDeliveryStatus()} />
          )}
        </div>
      </div>
    </div>
  );
};
```

#### Desktop WS 监听

```typescript
// apps/desktop/src/renderer/services/chat.service.ts — 新增监听

socket.on('message:read', (data: {
  converseId: string;
  userId: string;
  lastSeenMessageId: string;
}) => {
  // 更新对方已读位置（通过状态管理触发 UI 重建）
  chatStore.updatePeerLastSeen(data.converseId, data.userId, data.lastSeenMessageId);
});
```

**要点**：
- 已读标记仅对自己发送的消息显示（对方发送的消息不需要显示勾）
- DM 场景下只有一个对方，逻辑简单；群聊场景（Sprint 3）需改为"N 人已读"
- 使用 `Icons.done_all`（Flutter）和 `&#10003;&#10003;` HTML 实体（Desktop）渲染双勾
- 绿色双勾（已读）vs 灰色单勾（已送达）的色彩方案与微信/WhatsApp 一致

---

## 4.5 批量已读（打开会话时）

当用户打开某个聊天页面时，自动将该会话中所有消息标记为已读。客户端获取当前会话最新一条消息的 ID，作为 `lastSeenMessageId` 发送 `message:read` 事件。

### Flutter 实现

```dart
// apps/mobile/lib/features/chat/pages/chat_page.dart

class _ChatPageState extends ConsumerState<ChatPage> {
  @override
  void initState() {
    super.initState();
    // 打开会话时加入 WS 房间
    _joinConverse();
    // 打开会话时标记全部已读
    _markAllAsRead();
  }

  /// 打开会话 → 标记已读到最新消息
  void _markAllAsRead() {
    final messages = ref.read(messageProvider).messages;
    if (messages.isEmpty) return;

    // messages 按 createdAt DESC 排序，第一条是最新的
    final latestMessage = messages.first;

    // 不标记自己发送的消息（如果最新消息就是自己发的，不需要标记）
    // 但这里的 markAsRead 只是更新 lastSeenMessageId，无论作者是谁都可以标记
    ref.read(messageProvider.notifier).markAsRead(
      widget.converseId,
      latestMessage.id,
    );
  }

  /// 新消息到达时也自动标记已读（因为用户正在看这个会话）
  void _onNewMessage(Message message) {
    // 如果 ChatPage 当前可见，自动更新已读位置
    if (mounted && message.converseId == widget.converseId) {
      ref.read(messageProvider.notifier).markAsRead(
        widget.converseId,
        message.id,
      );
    }
  }

  /// App 从后台恢复到前台时，也重新标记已读
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _markAllAsRead();
    }
  }

  // ...
}
```

### Desktop 实现

```typescript
// apps/desktop/src/renderer/pages/ChatPanel.tsx — 打开会话 / 获得焦点时

import { useEffect } from 'react';
import { useChatStore } from '../stores/chat.store';

export const ChatPanel: React.FC<{ converseId: string }> = ({ converseId }) => {
  const { messages, markAsRead } = useChatStore();
  const socket = useSocket();

  // 打开会话时批量标记已读
  useEffect(() => {
    if (messages.length === 0) return;

    const latestMessage = messages[0]; // 最新消息
    socket.emit('message:read', {
      converseId,
      lastSeenMessageId: latestMessage.id,
    });
  }, [converseId]); // converseId 变化时触发（切换会话）

  // 窗口获得焦点时重新标记已读
  useEffect(() => {
    const handleFocus = () => {
      if (messages.length === 0) return;
      const latestMessage = messages[0];
      socket.emit('message:read', {
        converseId,
        lastSeenMessageId: latestMessage.id,
      });
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [converseId, messages]);

  // 新消息到达且面板可见时，自动标记已读
  useEffect(() => {
    const handleNewMessage = (data: { id: string; converseId: string }) => {
      if (data.converseId === converseId && document.hasFocus()) {
        socket.emit('message:read', {
          converseId,
          lastSeenMessageId: data.id,
        });
      }
    };

    socket.on('message:new', handleNewMessage);
    return () => { socket.off('message:new', handleNewMessage); };
  }, [converseId]);

  // ...
};
```

### 节流防抖策略

连续快速到达多条消息时，避免每条消息都触发一次 `message:read` 事件：

```dart
// Flutter — 使用 Timer 做 200ms 防抖

Timer? _readDebounce;

void _markAsReadDebounced(String converseId, String messageId) {
  _readDebounce?.cancel();
  _readDebounce = Timer(const Duration(milliseconds: 200), () {
    ref.read(messageProvider.notifier).markAsRead(converseId, messageId);
  });
}

@override
void dispose() {
  _readDebounce?.cancel();
  super.dispose();
}
```

```typescript
// Desktop — 使用 lodash.debounce 做 200ms 防抖

import { debounce } from 'lodash';

const debouncedMarkAsRead = debounce((converseId: string, messageId: string) => {
  socket.emit('message:read', { converseId, lastSeenMessageId: messageId });
}, 200);
```

**要点**：
- 批量已读的核心思路是"只发一次 `message:read`，携带最新消息 ID"，服务端通过 `createdAt` 比较自动覆盖更早的已读位置
- 200ms 防抖避免连续收到消息时产生 WS 事件风暴
- Desktop 端额外监听 `window.focus` 事件，确保用户从其他应用切回来时也能标记已读
- Flutter 端通过 `didChangeAppLifecycleState` 处理 App 前后台切换场景

---

## 设计说明

### 数据流总览

```
用户 A 发送消息给用户 B:

1. A 发送消息 → Server 存入 DB → WS 广播 message:new → B 收到
   A 看到: 单勾 ✓（已送达）

2. B 打开聊天页面 → B 发送 message:read { lastSeenMessageId: msg.id }
   → Server 更新 ConverseMember.lastSeenMessageId
   → Server 广播 message:read → A 收到

3. A 收到 message:read → 更新本地 peerLastSeenCreatedAt → UI 重建
   A 看到: 双勾 ✓✓（已读，绿色）
```

### 未读计数数据流

```
用户 B 打开会话列表:

1. GET /api/v1/converses → Server 逐会话调用 getUnreadCount()
   → 返回 unreadCount: 3（基于 lastSeenMessageId 游标计算）

2. B 打开某会话 → B 发送 message:read → unreadCount 归零

3. B 回到会话列表 → 本地更新 unreadCount = 0（或下次拉取时 Server 返回 0）
```

### 为何使用 createdAt 而非 ID 比较

`CUID` 虽然大致按时间递增，但在高并发场景下不严格保证时间有序。使用 `createdAt`（数据库层面精确到毫秒）作为比较基准更可靠。查询 pattern：

```sql
-- 先查 lastSeenMessageId 的 createdAt
SELECT "createdAt" FROM messages WHERE id = :lastSeenMessageId;

-- 再以此时间为游标计数
SELECT COUNT(*) FROM messages
WHERE "converseId" = :converseId
  AND "createdAt" > :lastSeenCreatedAt
  AND "authorId" != :userId
  AND "deletedAt" IS NULL;
```

### 性能考量

| 场景 | 策略 |
|------|------|
| 高频 message:read 事件 | 客户端 200ms 防抖 + 服务端防回退校验 |
| 会话列表未读计数 N+1 查询 | `Promise.all` 并行查询；后续可引入 Redis 缓存 |
| 大量历史消息的会话 | `@@index([converseId, createdAt])` 索引保证 COUNT 查询效率 |
| lastSeenMessageId 指向已删除消息 | 回退到全量计数（见 4.3 边界处理） |

---

## 单元测试

### message:read handler 测试

```typescript
// apps/server/test/chat-gateway.spec.ts — message:read 相关测试

describe('message:read', () => {
  it('should update lastSeenMessageId in DB', async () => {
    // Arrange: 创建会话 + 成员 + 消息
    const converse = await createDMConverse(userA.id, userB.id);
    const message = await createMessage(converse.id, userA.id, 'hello');

    // Act: B 发送 message:read
    socketB.emit('message:read', {
      converseId: converse.id,
      lastSeenMessageId: message.id,
    });

    await waitFor(100); // 等待异步处理

    // Assert: DB 更新
    const member = await prisma.converseMember.findUnique({
      where: { converseId_userId: { converseId: converse.id, userId: userB.id } },
    });
    expect(member?.lastSeenMessageId).toBe(message.id);
  });

  it('should broadcast message:read to other members', (done) => {
    socketA.once('message:read', (data) => {
      expect(data.converseId).toBe(converse.id);
      expect(data.userId).toBe(userB.id);
      expect(data.lastSeenMessageId).toBe(message.id);
      done();
    });

    socketB.emit('message:read', {
      converseId: converse.id,
      lastSeenMessageId: message.id,
    });
  });

  it('should NOT allow cursor rollback', async () => {
    // Arrange: B 已读到 message2
    const message1 = await createMessage(converse.id, userA.id, 'first');
    const message2 = await createMessage(converse.id, userA.id, 'second');

    socketB.emit('message:read', {
      converseId: converse.id,
      lastSeenMessageId: message2.id,
    });
    await waitFor(100);

    // Act: B 尝试回退到 message1
    socketB.emit('message:read', {
      converseId: converse.id,
      lastSeenMessageId: message1.id,
    });
    await waitFor(100);

    // Assert: lastSeenMessageId 仍然是 message2
    const member = await prisma.converseMember.findUnique({
      where: { converseId_userId: { converseId: converse.id, userId: userB.id } },
    });
    expect(member?.lastSeenMessageId).toBe(message2.id);
  });

  it('should reject message:read from non-member', async () => {
    // userC is not a member of the converse
    socketC.emit('message:read', {
      converseId: converse.id,
      lastSeenMessageId: message.id,
    });
    await waitFor(100);

    // Assert: no update in DB
    const member = await prisma.converseMember.findUnique({
      where: { converseId_userId: { converseId: converse.id, userId: userC.id } },
    });
    expect(member).toBeNull();
  });
});
```

### getUnreadCount 测试

```typescript
// apps/server/test/converses.service.spec.ts — getUnreadCount 相关测试

describe('getUnreadCount', () => {
  it('should return 0 when all messages are read', async () => {
    const msg = await createMessage(converse.id, userA.id, 'hello');
    await markAsRead(converse.id, userB.id, msg.id);

    const count = await conversesService.getUnreadCount(converse.id, userB.id);
    expect(count).toBe(0);
  });

  it('should return correct count for unread messages', async () => {
    const msg1 = await createMessage(converse.id, userA.id, 'one');
    await markAsRead(converse.id, userB.id, msg1.id);
    await createMessage(converse.id, userA.id, 'two');
    await createMessage(converse.id, userA.id, 'three');

    const count = await conversesService.getUnreadCount(converse.id, userB.id);
    expect(count).toBe(2);
  });

  it('should NOT count own messages as unread', async () => {
    const msg1 = await createMessage(converse.id, userA.id, 'from A');
    await markAsRead(converse.id, userB.id, msg1.id);
    await createMessage(converse.id, userB.id, 'from B'); // B 自己发的

    const count = await conversesService.getUnreadCount(converse.id, userB.id);
    expect(count).toBe(0); // B 自己发的不算未读
  });

  it('should NOT count deleted messages as unread', async () => {
    const msg1 = await createMessage(converse.id, userA.id, 'first');
    await markAsRead(converse.id, userB.id, msg1.id);
    const msg2 = await createMessage(converse.id, userA.id, 'second');
    await softDeleteMessage(msg2.id);

    const count = await conversesService.getUnreadCount(converse.id, userB.id);
    expect(count).toBe(0); // 已撤回不算未读
  });

  it('should count all messages as unread when lastSeenMessageId is null', async () => {
    await createMessage(converse.id, userA.id, 'one');
    await createMessage(converse.id, userA.id, 'two');
    await createMessage(converse.id, userA.id, 'three');

    const count = await conversesService.getUnreadCount(converse.id, userB.id);
    expect(count).toBe(3); // 从未已读，全部计入
  });
});
```

---

## 完成标准

- [ ] A 发消息给 B → A 看到单勾 &#10003;（已送达）
- [ ] B 打开聊天窗口 → A 看到双勾 &#10003;&#10003;（已读，绿色）
- [ ] 会话列表中未读计数在 B 阅读后实时更新为 0
- [ ] 未读计数计算准确（基于 lastSeenMessageId 游标，排除自己的消息和已撤回消息）
- [ ] Flutter 聊天页消息气泡显示 &#10003; / &#10003;&#10003; 状态指示器
- [ ] Desktop 聊天页消息气泡显示 &#10003; / &#10003;&#10003; 状态指示器
- [ ] 批量已读：打开会话时自动发送 `message:read`，一次标记所有为已读
- [ ] 防回退：`lastSeenMessageId` 不会被旧消息 ID 覆盖
- [ ] 防抖：连续收到消息时客户端 200ms 内最多发一次 `message:read`
- [ ] 非会话成员发送 `message:read` 被静默拒绝
- [ ] 单元测试覆盖正常流程 + 边界条件（回退、非成员、已删除消息）
