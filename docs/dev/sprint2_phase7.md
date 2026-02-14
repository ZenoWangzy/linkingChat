# Sprint 2 — Phase 7: Bot Chat UI

> **负责人**：全端（后端 + 移动端 + 桌面端）
>
> **前置条件**：Phase 2（1 对 1 聊天 UI：会话列表 + 消息线程）+ Phase 5（Bot Model + CRUD）+ Phase 6（注册自动创建 Bot + DM Converse）全部完成
>
> **产出**：Bot 会话置顶显示、Bot 身份标识角标、BOT_NOTIFICATION 消息卡片渲染、Bot 消息路由检测
>
> **参考**：[sprint2_implement.md](./sprint2_implement.md) | [database-schema.md](../dev-plan/database-schema.md) | [websocket-protocol.md](../dev-plan/websocket-protocol.md)

---

## 任务清单

| # | 任务 | 文件 / 目录 | 依赖 |
|---|------|------------|------|
| 7.1 | Bot 会话置顶排序 | `apps/server/src/converses/converses.service.ts` | Phase 2 + Phase 6 |
| 7.2 | Bot 身份标识 | `apps/server/src/converses/converses.service.ts` | Phase 5 |
| 7.3 | BOT_NOTIFICATION 元数据结构定义 | `packages/shared/src/types/bot-notification.ts` | Phase 5 |
| 7.4 | 通知卡片组件 | Flutter + Desktop | 7.3 |
| 7.5 | Bot 消息路由检测 | `apps/server/src/messages/messages.service.ts` | Phase 2 + Phase 5 |
| 7.6 | Flutter Bot UI | `apps/mobile/lib/features/chat/` | 7.1, 7.2, 7.4 |
| 7.7 | Desktop Bot UI | `apps/desktop/src/renderer/` | 7.1, 7.2, 7.4 |

---

## 7.1 Bot 会话置顶排序

在 `ConversesService.findUserConverses()` 中增加 Bot 识别逻辑，将 `isPinned=true` 的 Bot 会话排在列表顶部。

Bot 的 DM Converse 与普通好友 DM 使用相同的 `type=DM` 类型，区别在于对方成员关联的 User 是否为 Bot。因此需要在查询时关联 Bot 表判断。

### ConversesService 修改

```typescript
// apps/server/src/converses/converses.service.ts — findUserConverses 方法

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
          },
        },
      },
    },
  });

  // 对每个会话判断对方是否为 Bot
  const converses = await Promise.all(
    members.map(async (m) => {
      const otherMember = m.converse.members.find(
        (cm) => cm.userId !== userId,
      );
      const bot = otherMember
        ? await this.prisma.bot.findUnique({
            where: { userId: otherMember.userId },
          })
        : null;

      return {
        ...m.converse,
        isBot: !!bot,
        isPinned: bot?.isPinned ?? false,
        botInfo: bot
          ? { id: bot.id, name: bot.name, type: bot.type }
          : null,
        lastMessage: m.converse.messages[0] || null,
        unreadCount: await this.getUnreadCount(m.converseId, userId),
      };
    }),
  );

  // 排序：isPinned 的 Bot 会话置顶，其余保持原有排序（按最后消息时间）
  return converses.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0; // 同组内保持原有顺序
  });
}
```

### 响应格式扩展

每个 Converse 响应中新增三个字段：

```typescript
interface ConverseResponse {
  // ...原有字段
  id: string;
  type: 'DM' | 'MULTI' | 'GROUP';
  members: ConverseMemberResponse[];
  lastMessage: MessageResponse | null;
  unreadCount: number;

  // 新增 Bot 相关字段
  isBot: boolean;             // 对方成员是否为 Bot
  isPinned: boolean;          // Bot 是否置顶（非 Bot 会话始终 false）
  botInfo: {                  // Bot 详细信息（非 Bot 为 null）
    id: string;
    name: string;
    type: 'REMOTE_EXEC' | 'SOCIAL_MEDIA' | 'CUSTOM';
  } | null;
}
```

**要点**：
- 使用 `Promise.all` 并行查询所有 Bot 信息，避免 N+1 顺序查询
- `isPinned` 仅来自 Bot 表的 `isPinned` 字段，用户不可手动修改 Bot 置顶状态（MVP 阶段）
- Supervisor 和 Coding Bot 在 Phase 6 创建时默认 `isPinned=true`

---

## 7.2 Bot 身份标识

客户端需要根据 `isBot` 标志在 UI 上展示 Bot 角标。此信息已在 7.1 的会话列表响应中携带，无需额外 API。

对于消息线程内的 Bot 识别，客户端从当前 Converse 的 `isBot` 字段判断，无需逐条消息查询。

### 设计决策

| 方案 | 说明 | 选择 |
|------|------|------|
| 在 User model 加 `isBot` 字段 | 简单，但污染通用 User 模型 | 否 |
| 在 Converse 响应中附带 `isBot` | 干净，Bot 信息在需要时才查询 | 是 |
| 单独的 `/api/v1/bots/check/:userId` 端点 | 太重，增加请求数 | 否 |

---

## 7.3 BOT_NOTIFICATION 元数据结构定义

在 `packages/shared` 中定义 `BotNotificationMetadata` 类型。此类型用于 Message 记录的 `metadata` JSON 字段，当 `message.type === 'BOT_NOTIFICATION'` 时客户端据此渲染通知卡片。

### 类型定义

```typescript
// packages/shared/src/types/bot-notification.ts

export interface BotNotificationMetadata {
  /** 卡片类型，决定渲染样式（颜色、图标） */
  cardType: 'task_complete' | 'error' | 'info' | 'action_required';

  /** 卡片标题（必填） */
  title: string;

  /** 卡片描述文本（可选） */
  description?: string;

  /** 触发此通知的来源 Bot ID */
  sourceBotId?: string;

  /** 触发此通知的来源 Bot 名称（冗余存储，避免额外查询） */
  sourceBotName?: string;

  /** 操作按钮列表（最多 3 个） */
  actions?: Array<{
    /** 按钮显示文本 */
    label: string;
    /** 按钮动作类型 */
    action: 'view_result' | 'retry' | 'navigate';
    /** 动作附带的载荷数据 */
    payload?: Record<string, unknown>;
  }>;

  /** 任务执行耗时（毫秒），cardType=task_complete 时展示 */
  executionTimeMs?: number;

  /** 通知产生的时间戳 (ISO 8601) */
  timestamp: string;
}
```

### 卡片类型与渲染映射

| cardType | 图标 | 背景色 | 边框色 | 用途 |
|----------|------|--------|--------|------|
| `task_complete` | [v] 绿色对勾 | `#E8F5E9` (浅绿) | `#4CAF50` (绿) | 任务执行成功 |
| `error` | [x] 红色叉号 | `#FFEBEE` (浅红) | `#F44336` (红) | 任务执行失败 |
| `info` | [i] 蓝色信息 | `#E3F2FD` (浅蓝) | `#2196F3` (蓝) | 一般信息通知 |
| `action_required` | [!] 黄色感叹号 | `#FFF8E1` (浅黄) | `#FFC107` (黄) | 需要用户操作 |

### Zod 验证 Schema（服务端写入时校验）

```typescript
// packages/shared/src/schemas/bot-notification.schema.ts

import { z } from 'zod';

export const botNotificationActionSchema = z.object({
  label: z.string().min(1).max(50),
  action: z.enum(['view_result', 'retry', 'navigate']),
  payload: z.record(z.unknown()).optional(),
});

export const botNotificationMetadataSchema = z.object({
  cardType: z.enum(['task_complete', 'error', 'info', 'action_required']),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  sourceBotId: z.string().optional(),
  sourceBotName: z.string().optional(),
  actions: z.array(botNotificationActionSchema).max(3).optional(),
  executionTimeMs: z.number().int().min(0).optional(),
  timestamp: z.string().datetime(),
});
```

### 共享包导出

```typescript
// packages/shared/src/index.ts — 新增导出

export type { BotNotificationMetadata } from './types/bot-notification';
export { botNotificationMetadataSchema } from './schemas/bot-notification.schema';
```

**关键文件**：

```
packages/shared/src/types/bot-notification.ts          # TypeScript 类型
packages/shared/src/schemas/bot-notification.schema.ts  # Zod 验证 schema
packages/shared/src/index.ts                            # 导出入口
```

---

## 7.4 通知卡片组件

Flutter 和 Desktop 各实现一个 NotificationCard 组件，根据 `BotNotificationMetadata.cardType` 渲染不同样式的卡片。

### Flutter: NotificationCard

```dart
// apps/mobile/lib/features/chat/widgets/notification_card.dart

import 'package:flutter/material.dart';

class NotificationCard extends StatelessWidget {
  final Map<String, dynamic> metadata;

  const NotificationCard({super.key, required this.metadata});

  @override
  Widget build(BuildContext context) {
    final cardType = metadata['cardType'] as String? ?? 'info';
    final title = metadata['title'] as String? ?? '';
    final description = metadata['description'] as String?;
    final actions = metadata['actions'] as List<dynamic>?;
    final executionTimeMs = metadata['executionTimeMs'] as int?;
    final sourceBotName = metadata['sourceBotName'] as String?;

    final style = _getCardStyle(cardType);

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: style.backgroundColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: style.borderColor, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 标题行
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: Row(
              children: [
                Icon(style.icon, color: style.iconColor, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: style.iconColor,
                    ),
                  ),
                ),
              ],
            ),
          ),

          // 描述文本
          if (description != null && description.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(40, 4, 12, 0),
              child: Text(
                description,
                style: const TextStyle(fontSize: 13, color: Color(0xFF666666)),
              ),
            ),

          // 来源 + 耗时
          Padding(
            padding: const EdgeInsets.fromLTRB(40, 8, 12, 0),
            child: Row(
              children: [
                if (sourceBotName != null)
                  Text(
                    '来自 $sourceBotName',
                    style: const TextStyle(fontSize: 11, color: Color(0xFF999999)),
                  ),
                if (sourceBotName != null && executionTimeMs != null)
                  const Text(
                    ' · ',
                    style: TextStyle(fontSize: 11, color: Color(0xFF999999)),
                  ),
                if (executionTimeMs != null)
                  Text(
                    '耗时 ${_formatDuration(executionTimeMs)}',
                    style: const TextStyle(fontSize: 11, color: Color(0xFF999999)),
                  ),
              ],
            ),
          ),

          // 操作按钮
          if (actions != null && actions.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(32, 8, 12, 12),
              child: Wrap(
                spacing: 8,
                children: actions.map((a) {
                  final action = a as Map<String, dynamic>;
                  return _ActionButton(
                    label: action['label'] as String? ?? '',
                    actionType: action['action'] as String? ?? '',
                    payload: action['payload'] as Map<String, dynamic>?,
                    accentColor: style.iconColor,
                  );
                }).toList(),
              ),
            )
          else
            const SizedBox(height: 12),
        ],
      ),
    );
  }

  static String _formatDuration(int ms) {
    if (ms < 1000) return '${ms}ms';
    final seconds = (ms / 1000).toStringAsFixed(1);
    return '${seconds}s';
  }

  static _CardStyle _getCardStyle(String cardType) {
    switch (cardType) {
      case 'task_complete':
        return _CardStyle(
          icon: Icons.check_circle_outline,
          iconColor: const Color(0xFF4CAF50),
          backgroundColor: const Color(0xFFE8F5E9),
          borderColor: const Color(0xFF4CAF50).withOpacity(0.3),
        );
      case 'error':
        return _CardStyle(
          icon: Icons.error_outline,
          iconColor: const Color(0xFFF44336),
          backgroundColor: const Color(0xFFFFEBEE),
          borderColor: const Color(0xFFF44336).withOpacity(0.3),
        );
      case 'action_required':
        return _CardStyle(
          icon: Icons.warning_amber_outlined,
          iconColor: const Color(0xFFFFC107),
          backgroundColor: const Color(0xFFFFF8E1),
          borderColor: const Color(0xFFFFC107).withOpacity(0.3),
        );
      case 'info':
      default:
        return _CardStyle(
          icon: Icons.info_outline,
          iconColor: const Color(0xFF2196F3),
          backgroundColor: const Color(0xFFE3F2FD),
          borderColor: const Color(0xFF2196F3).withOpacity(0.3),
        );
    }
  }
}

class _CardStyle {
  final IconData icon;
  final Color iconColor;
  final Color backgroundColor;
  final Color borderColor;

  const _CardStyle({
    required this.icon,
    required this.iconColor,
    required this.backgroundColor,
    required this.borderColor,
  });
}

class _ActionButton extends StatelessWidget {
  final String label;
  final String actionType;
  final Map<String, dynamic>? payload;
  final Color accentColor;

  const _ActionButton({
    required this.label,
    required this.actionType,
    this.payload,
    required this.accentColor,
  });

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: () {
        // Sprint 2: 操作按钮 UI 就绪，具体动作在 Sprint 3 实现
        // TODO: 根据 actionType 路由到对应处理逻辑
        debugPrint('[NotificationCard] Action tapped: $actionType, payload: $payload');
      },
      style: OutlinedButton.styleFrom(
        foregroundColor: accentColor,
        side: BorderSide(color: accentColor.withOpacity(0.5)),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        minimumSize: const Size(0, 28),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(6),
        ),
      ),
      child: Text(label, style: const TextStyle(fontSize: 12)),
    );
  }
}
```

### Flutter: BotBadge

```dart
// apps/mobile/lib/features/chat/widgets/bot_badge.dart

import 'package:flutter/material.dart';

/// 在头像右下角叠加 Bot 标识角标
class BotBadge extends StatelessWidget {
  final Widget child;
  final double badgeSize;

  const BotBadge({
    super.key,
    required this.child,
    this.badgeSize = 16,
  });

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        child,
        Positioned(
          right: -2,
          bottom: -2,
          child: Container(
            width: badgeSize,
            height: badgeSize,
            decoration: BoxDecoration(
              color: const Color(0xFF2196F3),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 1.5),
            ),
            child: Icon(
              Icons.smart_toy,
              size: badgeSize * 0.6,
              color: Colors.white,
            ),
          ),
        ),
      ],
    );
  }
}
```

### Desktop: NotificationCard.tsx

```tsx
// apps/desktop/src/renderer/components/NotificationCard.tsx

import React from 'react';

interface NotificationAction {
  label: string;
  action: string;
  payload?: Record<string, unknown>;
}

interface BotNotificationMetadata {
  cardType: 'task_complete' | 'error' | 'info' | 'action_required';
  title: string;
  description?: string;
  sourceBotName?: string;
  executionTimeMs?: number;
  actions?: NotificationAction[];
}

interface NotificationCardProps {
  metadata: BotNotificationMetadata;
}

const CARD_STYLES: Record<
  string,
  { icon: string; iconColor: string; bgColor: string; borderColor: string }
> = {
  task_complete: {
    icon: '\u2705',  // check mark
    iconColor: '#4CAF50',
    bgColor: '#E8F5E9',
    borderColor: 'rgba(76, 175, 80, 0.3)',
  },
  error: {
    icon: '\u274C',  // cross mark
    iconColor: '#F44336',
    bgColor: '#FFEBEE',
    borderColor: 'rgba(244, 67, 54, 0.3)',
  },
  info: {
    icon: '\u2139\uFE0F',  // info
    iconColor: '#2196F3',
    bgColor: '#E3F2FD',
    borderColor: 'rgba(33, 150, 243, 0.3)',
  },
  action_required: {
    icon: '\u26A0\uFE0F',  // warning
    iconColor: '#FFC107',
    bgColor: '#FFF8E1',
    borderColor: 'rgba(255, 193, 7, 0.3)',
  },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function NotificationCard({ metadata }: NotificationCardProps) {
  const style = CARD_STYLES[metadata.cardType] || CARD_STYLES.info;

  const handleAction = (action: NotificationAction) => {
    // Sprint 2: UI 就绪，具体动作在 Sprint 3 实现
    console.log('[NotificationCard] Action:', action.action, action.payload);
  };

  return (
    <div
      className="notification-card"
      style={{
        backgroundColor: style.bgColor,
        border: `1px solid ${style.borderColor}`,
        borderRadius: '12px',
        padding: '12px',
        margin: '4px 0',
        maxWidth: '360px',
      }}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '16px' }}>{style.icon}</span>
        <span
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: style.iconColor,
          }}
        >
          {metadata.title}
        </span>
      </div>

      {/* 描述文本 */}
      {metadata.description && (
        <p
          style={{
            margin: '4px 0 0 24px',
            fontSize: '13px',
            color: '#666',
          }}
        >
          {metadata.description}
        </p>
      )}

      {/* 来源 + 耗时 */}
      <div
        style={{
          margin: '8px 0 0 24px',
          fontSize: '11px',
          color: '#999',
        }}
      >
        {metadata.sourceBotName && <span>来自 {metadata.sourceBotName}</span>}
        {metadata.sourceBotName && metadata.executionTimeMs != null && (
          <span> · </span>
        )}
        {metadata.executionTimeMs != null && (
          <span>耗时 {formatDuration(metadata.executionTimeMs)}</span>
        )}
      </div>

      {/* 操作按钮 */}
      {metadata.actions && metadata.actions.length > 0 && (
        <div
          style={{
            margin: '8px 0 0 24px',
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          {metadata.actions.map((action, index) => (
            <button
              key={index}
              onClick={() => handleAction(action)}
              style={{
                padding: '4px 12px',
                fontSize: '12px',
                color: style.iconColor,
                border: `1px solid ${style.borderColor}`,
                borderRadius: '6px',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Desktop: BotBadge.tsx

```tsx
// apps/desktop/src/renderer/components/BotBadge.tsx

import React from 'react';

interface BotBadgeProps {
  children: React.ReactNode;
  size?: number;
}

export function BotBadge({ children, size = 16 }: BotBadgeProps) {
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {children}
      <div
        style={{
          position: 'absolute',
          right: -2,
          bottom: -2,
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: '#2196F3',
          border: '1.5px solid white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.55,
          lineHeight: 1,
        }}
        title="Bot"
      >
        <span role="img" aria-label="bot" style={{ color: 'white' }}>
          &#x1F916;
        </span>
      </div>
    </div>
  );
}
```

**新增文件目录**：

```
apps/mobile/lib/features/chat/widgets/
  ├── notification_card.dart     # BOT_NOTIFICATION 渲染器
  └── bot_badge.dart             # Bot 头像角标叠加层

apps/desktop/src/renderer/components/
  ├── NotificationCard.tsx       # BOT_NOTIFICATION 渲染器
  └── BotBadge.tsx               # Bot 头像角标叠加层
```

---

## 7.5 Bot 消息路由检测

在 `MessagesService.create()` 中，消息发送后检测收件人是否为 Bot。Sprint 2 仅做检测与日志记录，实际 AI 回复生成在 Sprint 3 实现。

### MessagesService 修改

```typescript
// apps/server/src/messages/messages.service.ts — create 方法修改

async create(userId: string, dto: CreateMessageDto) {
  // 1. 创建消息（已有逻辑）
  const message = await this.prisma.message.create({
    data: {
      content: dto.content,
      type: dto.type ?? 'TEXT',
      metadata: dto.metadata ?? {},
      converseId: dto.converseId,
      authorId: userId,
    },
    include: {
      author: {
        select: { id: true, username: true, displayName: true, avatarUrl: true },
      },
    },
  });

  // 2. 更新 ConverseMember.lastMessageId（已有逻辑）
  await this.prisma.converseMember.updateMany({
    where: { converseId: dto.converseId },
    data: { lastMessageId: message.id },
  });

  // 3. 广播到会话房间（已有逻辑）
  this.broadcastService.emitToRoom(dto.converseId, 'message:new', message);

  // 4. [新增] 检测收件人是否为 Bot
  await this.detectBotRecipient(userId, dto.converseId, message);

  return message;
}

/**
 * 检测消息收件人是否为 Bot
 *
 * Sprint 2: 仅记录日志
 * Sprint 3: 路由到 AI pipeline 生成回复
 */
private async detectBotRecipient(
  senderId: string,
  converseId: string,
  message: { id: string; content: string; type: string },
): Promise<void> {
  // 查找会话中的其他成员
  const otherMembers = await this.prisma.converseMember.findMany({
    where: {
      converseId,
      userId: { not: senderId },
    },
  });

  for (const member of otherMembers) {
    const bot = await this.prisma.bot.findUnique({
      where: { userId: member.userId },
    });

    if (bot) {
      this.logger.log(
        `[Bot] Message to ${bot.name} (${bot.id}): ` +
        `type=${message.type}, content="${message.content.substring(0, 100)}"`,
      );

      // Sprint 3 TODO: 将消息路由到 AI pipeline
      // await this.botPipelineService.processMessage(bot, message);
    }
  }
}
```

### Logger 注入

```typescript
// MessagesService 类中添加 Logger

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  // ...
}
```

**要点**：
- `detectBotRecipient` 为异步方法但不阻塞消息返回 —— 消息已经创建并广播，Bot 检测在后台执行
- Sprint 2 阶段仅打印日志，不生成任何 AI 回复
- Sprint 3 将在此处接入 `BotPipelineService`，根据 `bot.agentConfig` 调用 LLM 生成回复
- 支持群聊场景（虽然 Sprint 2 仅有 DM）：遍历所有非发送者成员检测是否为 Bot

---

## 7.6 Flutter Bot UI

整合 7.1-7.4 的产出到 Flutter 聊天界面，实现 Bot 会话置顶、Bot 头像角标、BOT_NOTIFICATION 卡片渲染。

### converse_tile.dart（修改已有组件）

```dart
// apps/mobile/lib/features/chat/widgets/converse_tile.dart
//
// 在已有的会话列表 tile 组件中增加 Bot 识别逻辑

import 'package:flutter/material.dart';
import 'bot_badge.dart';

class ConverseTile extends StatelessWidget {
  final Map<String, dynamic> converse;
  final VoidCallback onTap;

  const ConverseTile({
    super.key,
    required this.converse,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isBot = converse['isBot'] as bool? ?? false;
    final isPinned = converse['isPinned'] as bool? ?? false;
    final botInfo = converse['botInfo'] as Map<String, dynamic>?;
    final displayName = _getDisplayName();
    final avatarUrl = _getAvatarUrl();
    final lastMessage = converse['lastMessage'] as Map<String, dynamic>?;
    final unreadCount = converse['unreadCount'] as int? ?? 0;

    // 构建头像 Widget
    Widget avatarWidget = CircleAvatar(
      radius: 24,
      backgroundColor: isBot
          ? const Color(0xFF2196F3).withOpacity(0.1)
          : const Color(0xFFE0E0E0),
      backgroundImage: avatarUrl != null ? NetworkImage(avatarUrl) : null,
      child: avatarUrl == null
          ? Text(
              displayName.isNotEmpty ? displayName[0].toUpperCase() : '?',
              style: TextStyle(
                color: isBot ? const Color(0xFF2196F3) : const Color(0xFF666666),
                fontWeight: FontWeight.w600,
              ),
            )
          : null,
    );

    // Bot 头像叠加角标
    if (isBot) {
      avatarWidget = BotBadge(child: avatarWidget);
    }

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: avatarWidget,
      title: Row(
        children: [
          Expanded(
            child: Text(
              displayName,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (isPinned)
            const Padding(
              padding: EdgeInsets.only(left: 4),
              child: Icon(Icons.push_pin, size: 14, color: Color(0xFF999999)),
            ),
        ],
      ),
      subtitle: _buildSubtitle(lastMessage),
      trailing: unreadCount > 0
          ? Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFFF44336),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                unreadCount > 99 ? '99+' : '$unreadCount',
                style: const TextStyle(color: Colors.white, fontSize: 11),
              ),
            )
          : null,
      onTap: onTap,
    );
  }

  Widget? _buildSubtitle(Map<String, dynamic>? lastMessage) {
    if (lastMessage == null) return null;

    final type = lastMessage['type'] as String? ?? 'TEXT';
    final content = lastMessage['content'] as String? ?? '';

    // BOT_NOTIFICATION 类型显示卡片标题
    if (type == 'BOT_NOTIFICATION') {
      final metadata = lastMessage['metadata'] as Map<String, dynamic>?;
      final title = metadata?['title'] as String? ?? '通知';
      return Text(
        '[通知] $title',
        style: const TextStyle(fontSize: 13, color: Color(0xFF999999)),
        overflow: TextOverflow.ellipsis,
      );
    }

    return Text(
      content,
      style: const TextStyle(fontSize: 13, color: Color(0xFF999999)),
      overflow: TextOverflow.ellipsis,
      maxLines: 1,
    );
  }

  String _getDisplayName() {
    final botInfo = converse['botInfo'] as Map<String, dynamic>?;
    if (botInfo != null) return botInfo['name'] as String? ?? '';

    // 普通 DM：取对方成员的 displayName
    final members = converse['members'] as List<dynamic>?;
    if (members != null && members.length == 2) {
      // 从 members 中取非自己的那个成员
      for (final m in members) {
        final member = m as Map<String, dynamic>;
        final user = member['user'] as Map<String, dynamic>?;
        if (user != null) return user['displayName'] as String? ?? '';
      }
    }
    return converse['name'] as String? ?? '';
  }

  String? _getAvatarUrl() {
    final members = converse['members'] as List<dynamic>?;
    if (members != null) {
      for (final m in members) {
        final member = m as Map<String, dynamic>;
        final user = member['user'] as Map<String, dynamic>?;
        if (user != null) return user['avatarUrl'] as String?;
      }
    }
    return null;
  }
}
```

### message_bubble.dart（修改已有组件）

在消息气泡组件中根据 `message.type` 判断是否渲染 NotificationCard。

```dart
// apps/mobile/lib/features/chat/widgets/message_bubble.dart
//
// 在已有的消息气泡组件的 build 方法中添加类型分支

import 'notification_card.dart';

// 在 build() 方法中添加：

Widget _buildMessageContent(Map<String, dynamic> message) {
  final type = message['type'] as String? ?? 'TEXT';

  // BOT_NOTIFICATION: 渲染通知卡片
  if (type == 'BOT_NOTIFICATION') {
    final metadata = message['metadata'] as Map<String, dynamic>? ?? {};
    return NotificationCard(metadata: metadata);
  }

  // SYSTEM: 系统消息（居中灰色文字）
  if (type == 'SYSTEM') {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(
          message['content'] as String? ?? '',
          style: const TextStyle(fontSize: 12, color: Color(0xFF999999)),
        ),
      ),
    );
  }

  // TEXT / 其他: 普通文本气泡（已有逻辑）
  return _buildTextBubble(message);
}
```

### 会话列表排序（Provider 层）

```dart
// apps/mobile/lib/features/chat/providers/converse_provider.dart
//
// 从 API 获取的会话列表已经由服务端排好序（isPinned 置顶），
// 客户端无需二次排序，直接使用即可。
// 如果需要客户端离线排序作为兜底：

List<Map<String, dynamic>> sortConverses(List<Map<String, dynamic>> converses) {
  return List.from(converses)..sort((a, b) {
    final aPinned = a['isPinned'] as bool? ?? false;
    final bPinned = b['isPinned'] as bool? ?? false;
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return 0;
  });
}
```

---

## 7.7 Desktop Bot UI

整合 7.1-7.4 的产出到 Desktop 聊天界面。

### ConverseList.tsx（修改已有组件）

```tsx
// apps/desktop/src/renderer/components/ConverseList.tsx
//
// 在已有的会话列表组件中增加 Bot 识别逻辑

import { BotBadge } from './BotBadge';

interface Converse {
  id: string;
  type: string;
  isBot: boolean;
  isPinned: boolean;
  botInfo: { id: string; name: string; type: string } | null;
  members: Array<{
    user: {
      id: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
    };
  }>;
  lastMessage: {
    content: string;
    type: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  } | null;
  unreadCount: number;
}

interface ConverseListItemProps {
  converse: Converse;
  isActive: boolean;
  onClick: () => void;
}

function ConverseListItem({ converse, isActive, onClick }: ConverseListItemProps) {
  const displayName = converse.botInfo?.name
    || converse.members[0]?.user.displayName
    || '未知';

  const avatarUrl = converse.members[0]?.user.avatarUrl;

  // 构建最后一条消息的预览文本
  const lastMessagePreview = (() => {
    if (!converse.lastMessage) return '';
    if (converse.lastMessage.type === 'BOT_NOTIFICATION') {
      const title = (converse.lastMessage.metadata as any)?.title ?? '通知';
      return `[通知] ${title}`;
    }
    return converse.lastMessage.content;
  })();

  // 头像组件
  const avatar = (
    <div
      className="converse-avatar"
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        backgroundColor: converse.isBot ? '#E3F2FD' : '#E0E0E0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={displayName} style={{ width: '100%', height: '100%' }} />
      ) : (
        <span style={{ color: converse.isBot ? '#2196F3' : '#666', fontWeight: 600 }}>
          {displayName[0]?.toUpperCase() ?? '?'}
        </span>
      )}
    </div>
  );

  return (
    <div
      className={`converse-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 16px',
        cursor: 'pointer',
        backgroundColor: isActive ? '#E8E8E8' : 'transparent',
      }}
    >
      {/* 头像 + Bot 角标 */}
      {converse.isBot ? <BotBadge>{avatar}</BotBadge> : avatar}

      {/* 名称 + 最后消息 */}
      <div style={{ flex: 1, marginLeft: 12, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </span>
          {converse.isPinned && (
            <span style={{ fontSize: 12, color: '#999' }} title="已置顶">
              &#x1F4CC;
            </span>
          )}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: '#999',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {lastMessagePreview}
        </p>
      </div>

      {/* 未读计数 */}
      {converse.unreadCount > 0 && (
        <span
          style={{
            backgroundColor: '#F44336',
            color: 'white',
            fontSize: 11,
            borderRadius: 10,
            padding: '2px 6px',
            minWidth: 18,
            textAlign: 'center',
          }}
        >
          {converse.unreadCount > 99 ? '99+' : converse.unreadCount}
        </span>
      )}
    </div>
  );
}
```

### MessageBubble.tsx（修改已有组件）

```tsx
// apps/desktop/src/renderer/components/MessageBubble.tsx
//
// 在已有的消息气泡组件中增加 BOT_NOTIFICATION 类型分支

import { NotificationCard } from './NotificationCard';

interface Message {
  id: string;
  content: string;
  type: string;
  metadata?: Record<string, unknown>;
  author: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  };
  createdAt: string;
}

interface MessageBubbleProps {
  message: Message;
  isOwnMessage: boolean;
}

export function MessageBubble({ message, isOwnMessage }: MessageBubbleProps) {
  // BOT_NOTIFICATION: 渲染通知卡片（不使用气泡样式）
  if (message.type === 'BOT_NOTIFICATION' && message.metadata) {
    return (
      <div style={{ margin: '8px 0', maxWidth: '80%' }}>
        <NotificationCard metadata={message.metadata as any} />
      </div>
    );
  }

  // SYSTEM: 系统消息（居中）
  if (message.type === 'SYSTEM') {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '8px 0',
          fontSize: 12,
          color: '#999',
        }}
      >
        {message.content}
      </div>
    );
  }

  // TEXT / 其他: 普通气泡（已有逻辑）
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isOwnMessage ? 'flex-end' : 'flex-start',
        margin: '4px 0',
      }}
    >
      <div
        style={{
          maxWidth: '70%',
          padding: '8px 12px',
          borderRadius: 12,
          backgroundColor: isOwnMessage ? '#95EC69' : '#FFFFFF',
          fontSize: 14,
          lineHeight: 1.5,
          wordBreak: 'break-word',
        }}
      >
        {message.content}
      </div>
    </div>
  );
}
```

---

## WS 事件与 API 变更总结

### API 变更

| 端点 | 变更 |
|------|------|
| GET `/api/v1/converses` | 响应新增 `isBot`, `isPinned`, `botInfo` 三个字段 |

### 无新增 WS 事件

Phase 7 不引入新的 WS 事件。Bot 消息使用已有的 `message:new` / `message:updated` / `message:deleted` 事件。

### 共享包新增

| 文件 | 说明 |
|------|------|
| `packages/shared/src/types/bot-notification.ts` | BotNotificationMetadata 类型 |
| `packages/shared/src/schemas/bot-notification.schema.ts` | Zod 验证 schema |

---

## Flutter 类型同步

Flutter 无法直接消费 TypeScript 类型，需手动镜像 `BotNotificationMetadata`。

```dart
// apps/mobile/lib/core/constants/bot_notification_types.dart

/// BOT_NOTIFICATION 卡片类型常量
class BotNotificationCardType {
  static const taskComplete = 'task_complete';
  static const error = 'error';
  static const info = 'info';
  static const actionRequired = 'action_required';
}

/// BOT_NOTIFICATION 操作按钮类型常量
class BotNotificationAction {
  static const viewResult = 'view_result';
  static const retry = 'retry';
  static const navigate = 'navigate';
}
```

> **同步纪律**：每次修改 `packages/shared/src/types/bot-notification.ts` 时，同步更新 `bot_notification_types.dart` 和 `notification_card.dart`。

---

## 设计说明

### Bot 会话与普通 DM 的关系

Bot 的 DM Converse 在数据库层面与普通好友 DM 完全一致（`type=DM`，两个 `ConverseMember`）。区别仅在于：

1. 对方成员的 User 关联了 Bot 记录
2. 服务端在返回会话列表时附加 `isBot` / `isPinned` / `botInfo` 标志
3. 客户端根据这些标志调整 UI 渲染（角标、置顶、通知卡片）

这种设计保证了消息收发链路完全复用已有的社交消息基础设施，无需为 Bot 建立独立的消息管道。

### Sprint 2 vs Sprint 3 边界

| 功能 | Sprint 2 (本 Phase) | Sprint 3 |
|------|---------------------|----------|
| 用户发消息给 Bot | 消息正常存储 + 日志记录 | 路由到 AI pipeline，生成回复 |
| BOT_NOTIFICATION 卡片 | UI 组件就绪，可渲染已有通知 | Supervisor 自动汇总事件并生成通知 |
| 操作按钮 | 可点击，打印日志 | 实际执行 view_result / retry / navigate |
| 回复建议 (Whisper) | 不实现 | Bot 消息触发 Whisper 建议 |

### 性能考虑

- `findUserConverses` 中为每个 DM 会话查询一次 Bot 表，最坏情况 O(N) 次 DB 查询。MVP 阶段用户会话数量有限（<100），可接受
- 后续优化方案：在 ConverseMember 上增加 `isBot` 冗余字段，Phase 6 创建 Bot DM 时一并写入，消除运行时查询

---

## 完成标准

- [ ] Bot 会话置顶在会话列表顶部（`isPinned=true` 的 Bot 排最前）
- [ ] Bot 头像显示机器人角标（蓝色圆形 + robot 图标）
- [ ] BOT_NOTIFICATION 类型消息渲染为卡片（非纯文本气泡）
- [ ] 通知卡片根据 cardType 显示正确的图标和颜色（绿/红/蓝/黄）
- [ ] 通知卡片上的操作按钮可点击（UI 就绪，动作 stub 到日志）
- [ ] 用户发消息到 Bot DM 时，消息正常存储并广播
- [ ] 服务端日志记录 Bot 消息路由检测结果（`[Bot] Message to ...`）
- [ ] Flutter Bot UI 渲染正确（会话列表 + 消息线程）
- [ ] Desktop Bot UI 渲染正确（会话列表 + 消息线程）
