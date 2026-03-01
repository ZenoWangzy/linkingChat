# Phase 7 设计方案：群聊 @Bot 路由 + @ai 兜底

> 创建日期：2026-03-01
> 状态：待实施
> 作者：CTO 规划

## 1. 背景与目标

### 1.1 当前状态

- ✅ Phase 5: OpenClaw Gateway 云端集成完成
- ✅ Phase 6: Agent Architecture + Supervisor 通知汇总完成
- ✅ AI 模块基础设施（LLM Router、Whisper、Draft、Predictive）已实现

### 1.2 问题

Bot 目前只能在私信中工作，群聊中 @Bot 没有任何响应。

### 1.3 目标

实现群聊中 @Bot 精准调用 + @ai 兜底机制。

### 1.4 成功标准

1. 群聊中 `@CodingBot 执行命令` → CodingBot 响应
2. 群聊中 `@ai 问题` → Supervisor 响应
3. 响应延迟 < 3 秒

## 2. 技术调研总结

### 2.1 Discord/Telegram/OpenClaw 集成模式

主流平台的 AI Agent 集成都遵循统一模式：

```
消息事件 → @mention 解析 → Agent 路由 → 响应
```

| 平台 | 连接方式 | Mention 检测 | 响应方式 |
|------|----------|-------------|----------|
| Discord | WebSocket | `message.mentions.users.has()` | `message.reply()` |
| Telegram | Webhook/Long Polling | 实体解析 | `/sendMessage` |
| OpenClaw | Channel Adapter | 统一接口 | 多平台适配 |

### 2.2 关键学习点

1. **事件驱动架构** - 与我们现有 Agent 系统一致
2. **Channel Adapter 模式** - 统一的消息接口
3. **Bot 自身检测** - 避免无限循环
4. **群聊策略** - 仅响应 @mention

## 3. 架构设计

### 3.1 核心模式

```
群聊消息 → @mention 解析 → Bot/AI 路由 → Agent 响应 → WebSocket 推送
```

### 3.2 组件架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      MessagesService.create()                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MentionService (新增)                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ parse()         │  │ validate()      │  │ route()         │ │
│  │ 解析 @mentions  │→ │ 验证 Bot 存在   │→ │ 路由到 Agent    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │ @CodingBot   │ │ @OtherBot    │ │ @ai          │
     │ → Agent A    │ │ → Agent B    │ │ → Supervisor │
     └──────────────┘ └──────────────┘ └──────────────┘
              │             │             │
              └─────────────┼─────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                 AgentOrchestratorService (复用)                  │
│                 dispatchEvent(botId, event)                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Bot Agent 处理                               │
│                 → 执行任务 / 生成回复                            │
│                 → BroadcastService.toRoom()                     │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 服务分离 | 新建 MentionService | 职责清晰，可复用 |
| 复用现有架构 | 不修改 Agent 核心 | 降低风险，快速交付 |
| @ai 兜底 | 复用 WhisperService | 功能一致，扩展群聊 |

## 4. 组件设计

### 4.1 MentionService

**位置**：`apps/server/src/mentions/mentions.service.ts`

**职责**：
- `parse(content)` - 解析消息中的 @mentions
- `validate(mentions, converseId)` - 验证 Bot 存在性
- `route(mentions, message)` - 路由到对应处理器

**接口定义**：

```typescript
interface ParsedMention {
  name: string;
  fullMatch: string;
  startIndex: number;
}

interface ValidMention {
  type: 'bot' | 'ai';
  name: string;
  fullMatch: string;
  botId?: string;
  userId?: string;
}

interface MentionService {
  parse(content: string): ParsedMention[];
  validate(mentions: ParsedMention[], converseId: string): Promise<ValidMention[]>;
  route(mentions: ValidMention[], message: Message, senderId: string, converseId: string): Promise<void>;
}
```

### 4.2 MessagesService 修改

**位置**：`apps/server/src/messages/messages.service.ts`

**修改点**：在 `create()` 方法中，群聊消息调用 MentionService

```typescript
// 伪代码
async create(userId: string, dto: CreateMessageDto) {
  // ... 现有消息创建逻辑 ...

  // 新增：群聊 @mention 路由
  if (converse.type === 'GROUP') {
    const mentions = this.mentionService.parse(dto.content);
    const validMentions = await this.mentionService.validate(mentions, dto.converseId);

    if (validMentions.length > 0) {
      await this.mentionService.route(validMentions, message, userId, dto.converseId);
    }
  }
}
```

### 4.3 WhisperService 扩展

**位置**：`apps/server/src/ai/services/whisper.service.ts`

**修改点**：支持群聊 @ai 触发

```typescript
async handleWhisperTrigger(
  senderId: string,
  message: Message,
  converseId: string,
): Promise<void> {
  const converse = await this.prisma.converse.findUnique({
    where: { id: converseId },
  });

  // 私信和群聊都支持 @ai
  if (converse.type === 'DIRECT' || converse.type === 'GROUP') {
    // 现有逻辑...
  }
}
```

## 5. 数据流

```
1. 用户在群聊发送 "@CodingBot 帮我执行 ls"
2. WebSocket → ChatGateway → MessagesService.create()
3. MessagesService 调用 MentionService.parse()
   → 解析出 [{ name: "CodingBot", fullMatch: "@CodingBot" }]
4. MentionService.validate()
   → 查询数据库确认 Bot 存在
   → 返回 [{ type: "bot", botId: "xxx", name: "CodingBot" }]
5. MentionService.route()
   → 调用 AgentOrchestrator.dispatchEvent(botId, event)
6. Agent 处理事件
   → 执行命令 / 生成回复
7. Bot 通过 BroadcastService 推送响应到群聊
```

## 6. 错误处理

| 场景 | 处理方式 |
|------|----------|
| @mention 的 Bot 不存在 | 忽略，不响应 |
| Bot 处理超时 | 返回超时提示 |
| Bot 响应失败 | 记录日志，不阻塞消息流程 |
| 消息循环（Bot 回复触发 Bot） | 过滤 Bot 自己的消息 |

## 7. 性能考虑

1. **Bot 列表缓存** - 避免每次查询数据库
2. **异步处理** - @mention 路由不阻塞消息存储
3. **频率限制** - 防止滥用（5次/分钟）

## 8. 测试策略

### 8.1 单元测试

- MentionService.parse() - 各种 @mention 格式
- MentionService.validate() - Bot 存在/不存在场景
- MentionService.route() - 路由逻辑

### 8.2 集成测试

- 群聊消息 → @Bot → 响应
- 群聊消息 → @ai → Supervisor 响应
- 私信消息（不受影响）

### 8.3 端到端测试

- Desktop/Mobile 客户端群聊 @Bot 功能

## 9. 文件清单

### 9.1 新增文件

| 文件 | 说明 |
|------|------|
| `apps/server/src/mentions/mentions.module.ts` | NestJS 模块 |
| `apps/server/src/mentions/mentions.service.ts` | Mention 服务 |
| `apps/server/src/mentions/interfaces/mention.interface.ts` | 类型定义 |
| `apps/server/src/mentions/index.ts` | 导出 |
| `apps/server/src/mentions/__tests__/mentions.service.spec.ts` | 单元测试 |

### 9.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `apps/server/src/messages/messages.service.ts` | 调用 MentionService |
| `apps/server/src/ai/services/whisper.service.ts` | 群聊 @ai 支持 |
| `apps/server/src/app.module.ts` | 导入 MentionsModule |

## 10. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| @mention 解析不准确 | 低 | 严格正则 + Bot 名称验证 |
| Bot 滥用 | 中 | 频率限制（5次/分钟） |
| 性能影响 | 低 | 缓存 + 异步处理 |
| 消息循环 | 低 | 过滤 Bot 自己的消息 |

## 11. 后续扩展（Phase 7+）

1. **@用户提及** - 支持 @具体用户通知
2. **Bot 群成员管理 API** - 添加/移除 Bot 到群
3. **前端 @mention 自动补全** - 输入 @ 时显示候选列表
4. **流式响应** - Bot 回复逐字显示

## 12. 参考资料

- Discord Bot Mention: `message.mentions.users.has(botId)`
- Telegram Bot API: Webhook/Long Polling + Entity 解析
- OpenClaw Channels: Channel Adapter 统一消息接口
