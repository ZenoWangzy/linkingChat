# Sprint 3：AI 三模式 + 延迟项补全

> **目标**：让 Bot 真正"智能" — 实现 LLM 路由、@ai Whisper 建议、Draft & Verify 草稿确认、Predictive Actions 预测执行；同时补全 Sprint 2 延迟的 OpenClaw 集成和 Supervisor 通知汇总
>
> **前置条件**：[Sprint 2](./sprint2_implement.md) 已完成（好友系统、1 对 1 聊天、在线状态、已读回执、Bot 框架、群组聊天 Server + 全端 UI）
>
> **不包含**：文件/图片/语音消息、推送通知、消息搜索、生产部署、i18n、语音/视频通话
>
> **参考**：[websocket-protocol.md](../dev-plan/websocket-protocol.md) §七 | [tech-decisions-v2.md](../decisions/tech-decisions-v2.md) §八 | [project-brief.md](../decisions/project-brief.md)

---

## 并行策略

```
线 A — AI 模块（后端为主）                 线 B — 延迟项 + 增强
  Phase 0: LLM Router 服务                  Phase 5: OpenClaw Node 集成（Sprint 2 延迟）
  Phase 1: @ai Whisper 触发                  Phase 6: Supervisor 通知汇总（Sprint 2 延迟）
  Phase 2: Draft & Verify 状态机             Phase 7: @Bot 群聊路由 + @ai 兜底
  Phase 3: Predictive Actions                Phase 8: Profile 页面（Flutter + Desktop）
  Phase 4: Bot 间通信                        Phase 9: 群权限增强（可选）

       线 A 和线 B 大部分独立，可同时推进
       Phase 7 依赖 Phase 5（OpenClaw）和线 A Phase 0（LLM Router）
```

---

## 快速启动指令

> 以下内容供 AI IDE（如 Claude Code、Cursor 等）直接使用。
> 开发者只需复制对应的启动指令，粘贴给 AI 即可开始工作。

### 线 A 启动指令

```
请实施 Sprint 3 线 A — AI 模块。

负责 Phase 0 → 1 → 2 → 3 → 4（AI 全链路）。
实施文档在 docs/dev/sprint3_implement.md 的「线 A — AI 模块」部分。

工作流程：
1. 先阅读 docs/dev/sprint3_implement.md 了解完整需求
2. 阅读 CLAUDE.md 了解项目架构和技术栈
3. 从 main 分支创建 feat/sprint3-ai-phase0 开始工作
4. 按 Phase 0 → 1 → 2 → 3 → 4 顺序逐步实施
5. 每个 Phase 完成后提交

关键约束：
- Server 代码在 apps/server/src/ai/ 下新建
- 改 packages/ws-protocol/ 或 packages/shared/ 时要在 commit message 加 [SHARED] 标记
- 参考现有代码风格（看 apps/server/src/friends/ 和 apps/server/src/bots/ 的写法）
- 每个 Phase 都要写单元测试
- 先做 Server 后端，UI 部分（Flutter + Desktop）放在每个 Phase 最后做
```

### 线 B 启动指令

```
请实施 Sprint 3 线 B — 延迟项 + 增强。

负责 Phase 5 → 6 → 7 → 8 → 9（OpenClaw + Supervisor + 群聊 Bot + Profile + 权限增强）。
实施文档在 docs/dev/sprint3_implement.md 的「线 B — 延迟项 + 增强」部分。

工作流程：
1. 先阅读 docs/dev/sprint3_implement.md 了解完整需求
2. 阅读 CLAUDE.md 了解项目架构和技术栈
3. 从 main 分支创建 feat/sprint3-openclaw-phase5 开始工作
4. 按 Phase 5 → 6 → 7 → 8 → 9 顺序逐步实施
5. 每个 Phase 完成后提交

关键约束：
- OpenClaw 相关代码在 apps/desktop/src/main/services/ 下
- Supervisor 通知在 apps/server/src/bots/ 下扩展
- 群组相关代码在 apps/server/src/converses/ 下扩展（Sprint 2 已有群组 CRUD）
- 群组 REST 端点路径为 /api/v1/converses/groups/:converseId（不是 /api/v1/groups/:id）
- 权限基于 GroupRole 枚举（OWNER/ADMIN/MEMBER），不是字符串权限列表
- 参考 sprint2_implement_mark.md Phase 8 了解现有群组实现
- 每个 Phase 都要写单元测试
```

---

## 双人协作规范

### Git 分支策略

```
main
 ├── feat/sprint3-ai-phase0        ← 开发者 A 从 main 切出
 │    └── Phase 0 → 1 → 2 → 3 → 4 逐步提交
 │
 └── feat/sprint3-openclaw-phase5   ← 开发者 B 从 main 切出
      └── Phase 5 → 6 → 7 → 8 → 9 逐步提交
```

- 两条线在**独立分支**上工作，不直接往 main 推代码
- 每个 Phase 完成后提交（不必等整条线全部完成）
- 一条线完成阶段性工作后 merge 回 main，另一条线 `git rebase main` 后继续

### 共享文件冲突风险

以下文件/目录两条线都可能修改，需要注意协调：

| 共享区域 | 线 A 改动 | 线 B 改动 | 协调方式 |
|----------|-----------|-----------|---------|
| `packages/ws-protocol/` | 加 AI 相关 WS 事件类型 | 加 OpenClaw 相关 WS 事件类型 | commit message 加 `[SHARED]` 标记，先合入的优先 |
| `packages/shared/` | 加 LLM 相关类型定义 | 加 OpenClaw 相关类型定义 | 同上 |
| `apps/server/src/bots/` | Phase 4 加 Bot 间消息路由 | Phase 6 扩展 Supervisor 通知 | 改动文件不同但模块相同，merge 时检查 module imports |
| `apps/server/src/app.module.ts` | 注册 AiModule | 注册 OpenClaw 相关 Module | 合并时手动处理 imports 数组 |
| `.env.example` | 加 `DEEPSEEK_API_KEY`, `KIMI_API_KEY` | 加 OpenClaw 相关配置 | 追加即可，不冲突 |

> **规则**：凡修改 `packages/` 下共享包的 commit，message 必须包含 `[SHARED]` 标记，例如：
> `feat(ws-protocol): [SHARED] add AI whisper event types`

### 推荐合并顺序

```
时间 ──────────────────────────────────────────────────────────────►

开发者 A（线 A）：
  ①  Phase 0 (LLM Router)  ──merge→ main
  ③  Phase 1+2+3 (Whisper + Draft + Predictive) ──merge→ main
  ⑤  Phase 4 (Bot 间通信) ──merge→ main

开发者 B（线 B）：
  ②  Phase 5+6 (OpenClaw + Supervisor) ──merge→ main
  ④  rebase main → Phase 7+8 (@Bot 路由 + Profile) ──merge→ main
  ⑤  Phase 9 (群权限增强，可选) ──merge→ main
```

**关键依赖**：Phase 7 (@Bot 群聊路由) 需要 Phase 0 (LLM Router) 和 Phase 5 (OpenClaw) 都已合入 main。所以 B 应按 **5→6→8→7→9** 顺序做（先跳过 7，做完 8 后等 A 的 Phase 0 合入再回头做 7）。

### 每日同步检查

- 各自 `git fetch origin main` 检查对方是否有新合入
- 如果 main 有更新，及时 `git rebase main` 到自己的分支
- 遇到 `[SHARED]` 包冲突时优先沟通，不要盲目 resolve

---

## 线 A — AI 模块

### Phase 0: LLM Router 服务

**目标**：多供应商 LLM 路由，根据任务复杂度自动选择模型 — DeepSeek 处理轻量任务，Kimi 2.5 处理复杂任务。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 0.1 | 创建 AiModule + LlmRouterService | `apps/server/src/ai/` | 模块可注入 |
| 0.2 | DeepSeek API 客户端 | `ai/providers/deepseek.provider.ts` | 文本补全 + 流式响应 |
| 0.3 | Kimi 2.5 API 客户端 | `ai/providers/kimi.provider.ts` | 文本补全 + 流式响应 |
| 0.4 | 路由策略实现 | LlmRouterService.route() | 根据 taskType 自动选择 provider |
| 0.5 | Provider 降级逻辑 | 主 provider 超时/失败 → 切换备选 | 3 秒超时自动降级 |
| 0.6 | 调用计量 + 日志 | 记录每次 LLM 调用的 provider、耗时、token 数 | 日志可查询 |
| 0.7 | 环境变量配置 | .env.example 更新 | DEEPSEEK_API_KEY, KIMI_API_KEY |
| 0.8 | 单元测试 | llm-router.service.spec.ts | Mock provider 测试路由逻辑 |

**路由策略**：

```typescript
// ai/services/llm-router.service.ts
export class LlmRouterService {
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const provider = this.selectProvider(request.taskType);
    try {
      return await provider.complete(request, { timeout: 3000 });
    } catch (error) {
      // 降级：DeepSeek 失败 → Kimi，Kimi 失败 → DeepSeek
      return await this.fallbackProvider(provider).complete(request);
    }
  }

  private selectProvider(taskType: LlmTaskType): LlmProvider {
    switch (taskType) {
      case 'whisper':        return this.deepseek;  // 低延迟优先
      case 'draft':          return this.kimi;      // 质量优先
      case 'predictive':     return this.deepseek;  // 低延迟优先
      case 'chat':           return this.deepseek;  // 日常对话
      case 'complex_analysis': return this.kimi;    // 复杂分析
      default:               return this.deepseek;
    }
  }
}
```

**LLM Provider 接口**：

```typescript
interface LlmProvider {
  name: string;
  complete(request: LlmRequest, options?: LlmOptions): Promise<LlmResponse>;
  stream(request: LlmRequest, options?: LlmOptions): AsyncIterable<LlmChunk>;
}

interface LlmRequest {
  taskType: LlmTaskType;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
}

type LlmTaskType = 'whisper' | 'draft' | 'predictive' | 'chat' | 'complex_analysis';
```

**关键文件**：

```
apps/server/src/ai/
  ├── ai.module.ts
  ├── ai.controller.ts
  ├── services/
  │   └── llm-router.service.ts     # 多 provider 路由
  ├── providers/
  │   ├── llm-provider.interface.ts  # Provider 接口
  │   ├── deepseek.provider.ts       # DeepSeek API
  │   └── kimi.provider.ts           # Kimi 2.5 API
  └── dto/
      └── llm-request.dto.ts
```

**验收标准**：
- DeepSeek 和 Kimi 两个 provider 均可正常调用
- whisper 类型请求自动路由到 DeepSeek
- DeepSeek 超时后 3 秒内自动降级到 Kimi
- 每次调用有 provider 名称 + 耗时 + token 数日志

---

### Phase 1: @ai Whisper 触发

**目标**：用户在聊天中输入 `@ai` 后，LLM 生成 1 个主推荐 + 2 个备选回复建议，<2 秒内返回。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 1.1 | 创建 WhisperService | `ai/services/whisper.service.ts` | 接收触发消息 → 返回建议 |
| 1.2 | @ai 触发词识别 | MessageListener | POST /messages 中检测 content 包含 @ai |
| 1.3 | 聊天上下文提取 | 最近 20 条消息作为 LLM 上下文 | 包含消息内容 + 发送者信息 |
| 1.4 | LLM 调用生成建议 | 1 主推荐 + 2 备选 | 使用 DeepSeek（低延迟） |
| 1.5 | WS 推送 ai:whisper:suggestions | 建议推送到触发用户 | 推送到 u-{userId} |
| 1.6 | WS 接收 ai:whisper:accept | 用户采纳建议 | 记录采纳的 suggestionId + selectedIndex |
| 1.7 | AiSuggestion 持久化 | 写入 ai_suggestions 表 (type=WHISPER) | 可追溯建议历史 |
| 1.8 | 超时处理 | >2 秒未返回则放弃 | 客户端不显示过期建议 |
| 1.9 | Flutter UI：建议展示 | 主推荐预填入输入框 + `...` 展开备选 | Tab 采纳，Esc 忽略 |
| 1.10 | Desktop UI：建议展示 | 同上 | 同上 |
| 1.11 | 单元测试 | whisper.service.spec.ts | Mock LLM 测试建议生成 |

**Whisper 交互流程**：

```
用户发送 "@ai" 消息:
  POST /api/v1/messages { converseId, content: "@ai", type: TEXT }
    │
    ├── DB: INSERT message (正常存储)
    ├── WS: message:new → {converseId} 房间 (广播给所有人)
    │
    └── 异步触发 WhisperService:
          ├── 提取最近 20 条消息上下文
          ├── 调用 LlmRouterService.complete({ taskType: 'whisper', ... })
          ├── 生成: { primary: "...", alternatives: ["...", "..."] }
          ├── DB: INSERT ai_suggestions (type=WHISPER)
          └── WS: ai:whisper:suggestions → u-{userId}

用户采纳建议:
  WS: ai:whisper:accept { suggestionId, selectedIndex: 0 }
    → 客户端用建议内容替换输入框 → 用户点发送 → 走正常 POST /messages
```

**客户端 UI 交互**：

```
输入框区域:
  ┌──────────────────────────────────────────┐
  │ 我觉得这个方案可以，但需要调整一下时间线。  │  ← 主推荐（灰色预填）
  │                                [发送] [×] │
  └──────────────────────────────────────────┘
  [···]  ← 点击展开备选

  展开后:
  ┌──────────────────────────────────────────┐
  │ ① 我觉得这个方案可以，但需要调整一下时间线。│  ← 主推荐
  │ ② 时间上有点紧，能延后一周吗？             │  ← 备选 1
  │ ③ 同意，我这边开始准备。                   │  ← 备选 2
  └──────────────────────────────────────────┘
```

**验收标准**：
- 用户发送 "@ai" → 2 秒内收到 1 主 + 2 备选建议
- 主推荐以灰色文字预填入输入框
- 点击 `...` 可展开查看备选
- 选择任意建议后可直接发送
- 超过 2 秒未返回，客户端不显示建议

---

### Phase 2: Draft & Verify 状态机

**目标**：AI 生成操作草稿（消息草稿或命令草稿），用户确认后才执行。Bot 永远不自主行动。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 2.1 | 创建 DraftService | `ai/services/draft.service.ts` | 草稿状态机管理 |
| 2.2 | AiDraft model + migration | ai_drafts 表 | DraftStatus enum: PENDING → APPROVED / REJECTED / EXPIRED |
| 2.3 | 草稿生成触发 | Bot 回复用户意图时生成草稿 | 使用 Kimi 2.5（质量优先） |
| 2.4 | WS 推送 ai:draft:created | 草稿卡片推送到用户 | 包含 draftContent + expiresAt |
| 2.5 | WS 接收 ai:draft:approve | 用户批准 → 执行 | 消息草稿 → POST /messages |
| 2.6 | WS 接收 ai:draft:reject | 用户拒绝 → 标记 REJECTED | 可附带拒绝原因 |
| 2.7 | WS 接收 ai:draft:edit | 用户编辑后批准 | 用编辑内容替换原草稿再执行 |
| 2.8 | TTL 过期机制 | 5 分钟未操作 → EXPIRED | Redis TTL + 定时任务检查 |
| 2.9 | WS 推送 ai:draft:expired | 过期通知 | 客户端移除过期草稿卡片 |
| 2.10 | Flutter 草稿卡片 UI | 批准 / 拒绝 / 编辑 按钮 | 过期后灰显不可操作 |
| 2.11 | Desktop 草稿卡片 UI | 同上 | 同上 |
| 2.12 | 单元测试 | draft.service.spec.ts | 状态转换测试 + TTL 过期测试 |

> **注意**：命令草稿的执行（device:command:send）需要 Phase 5 OpenClaw 集成完成后才可端到端打通。Phase 2 先实现消息草稿的完整流程，命令草稿执行能力在 Phase 5 完成后回补。

**状态机**：

```
                  ┌─────────┐
  草稿生成 ──────>│ PENDING │
                  └────┬────┘
                       │
            ┌──────────┼──────────┐
            │          │          │
            ▼          ▼          ▼
     ┌──────────┐ ┌──────────┐ ┌──────────┐
     │ APPROVED │ │ REJECTED │ │ EXPIRED  │
     └──────────┘ └──────────┘ └──────────┘
         │                         ▲
         ▼                         │
     执行动作                  5 分钟 TTL
    (发消息/执行命令)
```

**草稿卡片 UI**：

```
Bot 聊天框:
  ┌──────────────────────────────────────────┐
  │ 草稿                                     │
  │                                          │
  │ 你想执行: git pull origin main           │
  │                                          │
  │ 4:32 后过期                              │
  │                                          │
  │ [批准]  [编辑]  [拒绝]                    │
  └──────────────────────────────────────────┘
```

**验收标准**：
- 用户向 Bot 表达意图 → Bot 生成草稿卡片 → 用户确认后执行
- 草稿 5 分钟未操作自动过期，客户端卡片灰显
- 编辑草稿后批准，使用编辑后的内容执行
- Bot 永远不自主执行任何操作

---

### Phase 3: Predictive Actions

**目标**：分析对话上下文（如 Shell 错误输出），智能推荐操作卡片，标注危险等级。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 3.1 | 创建 PredictiveService | `ai/services/predictive.service.ts` | 上下文分析 → 动作生成 |
| 3.2 | 上下文触发器 | MessageListener | 检测特定模式：错误输出、异常堆栈、构建失败 |
| 3.3 | 动作生成 | LLM 分析上下文 → 生成 action cards | 使用 DeepSeek（低延迟） |
| 3.4 | 危险等级分类 | safe / warning / dangerous | dangerous 级别命令交叉验证黑名单 |
| 3.5 | WS 推送 ai:predictive:action | 动作卡片推送 | PredictivePayload 格式 |
| 3.6 | WS 接收 ai:predictive:execute | 用户选择执行 | 走 Draft & Verify 流程（非直接执行） |
| 3.7 | WS 接收 ai:predictive:dismiss | 用户忽略 | 记录忽略事件，优化后续推荐 |
| 3.8 | AiSuggestion 持久化 | ai_suggestions 表 (type=PREDICTIVE) | 可追溯推荐历史 |
| 3.9 | 黑名单协同 | dangerous 命令拦截 | 引用 Sprint 1 的 isDangerousCommand |
| 3.10 | Flutter 动作卡片 UI | 带颜色的操作按钮 | 绿(safe) / 黄(warning) / 红(dangerous) |
| 3.11 | Desktop 动作卡片 UI | 同上 | 同上 |
| 3.12 | 单元测试 | predictive.service.spec.ts | 上下文匹配 + 危险分级测试 |

**上下文触发示例**：

```
设备执行结果返回错误:
  device:result:complete { status: 'error', data: { output: "npm ERR! missing script: start" } }
    │
    └── PredictiveService.analyze(context)
          ├── 识别: npm 脚本缺失错误
          ├── 分析 package.json 上下文
          └── 生成动作卡片:
                actions: [
                  { type: 'shell', action: 'cat package.json | jq .scripts',
                    description: '查看可用 scripts', dangerLevel: 'safe' },
                  { type: 'shell', action: 'npm run dev',
                    description: '尝试运行 dev 脚本', dangerLevel: 'safe' },
                  { type: 'shell', action: 'npm init -y',
                    description: '初始化 package.json', dangerLevel: 'warning' },
                ]
```

**动作卡片 UI**：

```
Coding Bot 聊天框:
  ┌──────────────────────────────────────────┐
  │ 检测到 npm 脚本缺失错误                  │
  │                                          │
  │ [绿] 查看可用 scripts                    │
  │    cat package.json | jq .scripts        │
  │                                          │
  │ [绿] 尝试运行 dev 脚本                   │
  │    npm run dev                           │
  │                                          │
  │ [黄] 初始化 package.json                 │
  │    npm init -y                           │
  │                                          │
  │ [忽略]                                   │
  └──────────────────────────────────────────┘
```

**验收标准**：
- 命令执行报错 → 2 秒内推送相关操作建议
- 每个操作卡片标注危险等级（颜色区分）
- dangerous 级别的命令不可直接执行（转入 Draft & Verify）
- 选择执行后走 Draft & Verify 确认流程
- 忽略后记录到 ai_suggestions

---

### Phase 4: Bot 间通信

**目标**：Bot 之间可以触发协作消息，但必须标注触发来源。用户不确定找谁时 Supervisor 引导。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 4.1 | 触发来源标签模型 | Message.metadata 扩展 | `{ triggerSource: { botId, botName, reason } }` |
| 4.2 | Bot 间消息路由 | BotsService 扩展 | Bot A 可向 Bot B 的 agent 发送请求 |
| 4.3 | Supervisor 协调逻辑 | 用户不确定找谁 → Supervisor 引导 | 分析用户意图，推荐合适的 Bot |
| 4.4 | 跨 Bot 通知卡片 | BOT_NOTIFICATION 扩展 | 卡片显示 "[来自 XX Bot 的协作]" |
| 4.5 | 限流保护 | Bot 间通信频率限制 | 防止 Bot 互相调用形成死循环 |
| 4.6 | 测试 | bot-communication.spec.ts | A 触发 B → B 通知用户 + 标注来源 |

**跨 Bot 通知示例**：

```
Coding Bot 完成数据爬取 → 触发社媒 Bot:
  社媒 Bot 聊天框:
    ┌──────────────────────────────────────────┐
    │ [来自 Coding Bot 的协作]                 │
    │                                          │
    │ Coding Bot 完成了数据爬取，发现 3 条热点。│
    │ 需要我帮你写推文吗？                      │
    │                                          │
    │ [查看数据] [写推文] [忽略]                │
    └──────────────────────────────────────────┘
```

**限流规则**：
- 同一 Bot 对另一个 Bot 的调用：最多 5 次/分钟
- 链式调用深度限制：最多 3 层（A → B → C，不允许 C → D）
- 循环检测：A → B → A 直接拒绝

**验收标准**：
- Bot A 完成任务后可通知 Bot B
- 跨 Bot 通知卡片明确标注触发来源
- 循环调用被自动阻止
- Supervisor 可根据用户意图推荐合适的 Bot

---

## 线 B — 延迟项 + 增强

### Phase 5: OpenClaw Node 集成

> 从 Sprint 2 延迟。将 Sprint 1 的 `child_process.exec()` 替换为 OpenClaw Node，获得更丰富的执行能力和安全模型。

**目标**：Electron 端集成 OpenClaw Node 进程，命令通过 OpenClaw 执行而非直接 child_process。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 5.1 | OpenClaw Node 进程管理 | `apps/desktop/src/main/services/openclaw.service.ts` | spawn / 健康检查 / 重启 |
| 5.2 | OpenClaw WebSocket 客户端 | 桌面端连接 OpenClaw Node | JSON-RPC 通信 |
| 5.3 | 命令执行桥接 | device:command:execute → openclaw system.run | 替换 child_process.exec |
| 5.4 | 安全模式配置 | exec-approvals: ask | 需要用户确认的命令弹出审批对话框 |
| 5.5 | 能力上报 | device:register payload 中包含 capabilities | 上报 OpenClaw Node 支持的能力列表 |
| 5.6 | 回退逻辑 | OpenClaw 不可用时回退到 child_process.exec | 保证基本功能不中断 |
| 5.7 | Windows 兼容性验证 | 在 Windows 上测试 OpenClaw Node | 记录已知问题和 workaround |
| 5.8 | 单元测试 | openclaw.service.spec.ts | Mock 进程管理 + 命令执行 |

**关键实现**：

```typescript
// apps/desktop/src/main/services/openclaw.service.ts
import { spawn, ChildProcess } from 'child_process';

export class OpenClawService {
  private process: ChildProcess | null = null;

  async start(token: string): Promise<void> {
    this.process = spawn('openclaw', [
      'node', 'run',
      '--host', '127.0.0.1',
      '--port', '18790',
      '--display-name', 'LinkingChat Desktop',
    ], {
      env: { ...process.env, OPENCLAW_GATEWAY_TOKEN: token },
    });

    this.process.on('exit', (code) => {
      // 异常退出时自动重启（最多 3 次）
    });
  }

  async executeCommand(command: string, timeout = 30000): Promise<CommandResult> {
    // WebSocket JSON-RPC 调用 system.run
    // { type: "req", id: cuid(), method: "system.run", params: { command, timeout } }
  }

  async stop(): Promise<void> {
    this.process?.kill('SIGTERM');
  }
}
```

**验收标准**：
- Electron 启动时自动 spawn OpenClaw Node 子进程
- 命令通过 OpenClaw 执行，结果正确返回
- OpenClaw 崩溃后 3 秒内自动重启
- OpenClaw 不可用时回退到 child_process.exec，日志记录回退原因

---

### Phase 6: Supervisor 通知汇总

> 从 Sprint 2 延迟。所有 Bot 的关键事件汇总到 Supervisor 聊天流中，以 BOT_NOTIFICATION 卡片形式展示。

**目标**：Supervisor Bot 聚合所有 Bot 事件通知，用户在 Supervisor 聊天框内看到全局动态。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 6.1 | Bot 事件监听 | `apps/server/src/bots/bot-event.listener.ts` | 监听所有 Bot 的执行结果 |
| 6.2 | Supervisor 通知生成 | 将 Bot 事件转化为 BOT_NOTIFICATION 消息 | 写入 Supervisor 的 DM Converse |
| 6.3 | WS 推送通知 | bot:notification 事件 | 推送到 u-{userId} |
| 6.4 | 通知聚合策略 | 5 秒内同一 Bot 的多个事件合并为一条 | 避免通知风暴 |
| 6.5 | 触发来源标注 | 跨 Bot 触发时标注来源 | 卡片显示 "[来自 Coding Bot 的协作]" |
| 6.6 | 单元测试 | bot-event.listener.spec.ts | 事件捕获 + 聚合 + 通知生成 |

**事件流**：

```
Coding Bot 执行完命令:
  device:result:complete
    → BotEventListener 捕获
    → 生成 BOT_NOTIFICATION 消息
    → 写入 Supervisor 的 DM Converse
    → WS: message:new → Supervisor 聊天房间
    → WS: bot:notification → u-{userId}（通知用户）
```

**验收标准**：
- Coding Bot 完成任务 → Supervisor 聊天框自动出现完成通知卡片
- 连续执行 3 个命令 → 通知卡片合并为"完成 3 个任务"
- 卡片中的 [查看结果] 按钮跳转到 Coding Bot 聊天框

---

### Phase 7: @Bot 群聊路由 + @ai 兜底

**目标**：群聊中 Bot 可以被 @提及 精准调用，@ai 触发 Supervisor 兜底响应。

> **前置**：Sprint 2 Phase 8 已实现群组 CRUD + 成员管理。本 Phase 在其基础上增加 Bot 作为群成员的能力。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 7.1 | Bot 加群 API | POST `/api/v1/converses/groups/:converseId/bots/:botId` | 将 Bot 的 User 加入 ConverseMember |
| 7.2 | Bot 移出群 | DELETE `/api/v1/converses/groups/:converseId/bots/:botId` | 仅 OWNER/ADMIN 可操作 |
| 7.3 | @Bot 消息路由 | 检测 @CodingBot → 路由到对应 agent | 消息中 @mention 匹配 Bot userId |
| 7.4 | @ai 群聊兜底 | @ai = Supervisor 响应 | Supervisor 可以不在群内也能响应 @ai |
| 7.5 | Bot 回复关联 | Bot 回复携带 replyToMessageId | 明确回复哪条消息 |
| 7.6 | 群内 Bot 列表 | 群详情 API 返回含 Bot 标识 | 成员列表中 Bot 有特殊标识 |
| 7.7 | Flutter 群 Bot UI | 群详情成员列表标注 Bot 角标 | @提及自动补全支持 Bot |
| 7.8 | Desktop 群 Bot UI | 同上 | 同上 |
| 7.9 | 单元测试 | group-bot.spec.ts | Bot 加群 + @mention 路由 + @ai 兜底 |

**群聊 Bot 交互示例**：

```
群聊「项目组」（成员：用户, 同事A, @CodingBot）:

  同事A: 这段代码跑不起来
  用户: @CodingBot 帮我看看     ← 精准调用群内 Bot
  CodingBot: [回复同事A] 你缺少 numpy 依赖，建议执行 pip install numpy

  同事B: 周五能搞定吗？
  用户: @ai 帮我回复             ← @ai = Supervisor 兜底
  [ai:whisper:suggestions → 用户]
```

**验收标准**：
- Bot 可被添加到群组（ConverseMember，role=MEMBER）
- @CodingBot 消息正确路由到 Coding Bot agent
- @ai 在群聊中触发 Supervisor（即使 Supervisor 不在群内）
- Bot 回复明确关联原始消息

---

### Phase 8: Profile 页面

> Sprint 2 底部导航已预留 Profile tab 占位。本 Phase 实现个人资料页面。

**目标**：Flutter 和 Desktop 端的用户个人资料展示和编辑。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 8.1 | GET `/api/v1/users/me` | 当前用户详情 API | 返回完整用户信息 |
| 8.2 | PATCH `/api/v1/users/me` | 更新用户信息 | displayName, avatarUrl, status |
| 8.3 | Flutter Profile 页面 | `lib/features/profile/pages/profile_page.dart` | 头像+昵称+设备列表+登出 |
| 8.4 | Flutter 编辑 Profile | 昵称编辑 + 状态切换 | 编辑后即时保存 |
| 8.5 | Desktop Profile 页面 | Settings 中的用户信息面板 | 头像+昵称+邮箱+设备列表 |
| 8.6 | 登出功能 | 清除 token + 断开 WS + 跳转登录页 | Flutter + Desktop 均支持 |
| 8.7 | 单元测试 | users.service.spec.ts | 用户信息更新测试 |

**验收标准**：
- Profile 页面正确显示用户信息（头像、昵称、邮箱、在线状态）
- 可编辑昵称，保存后会话列表中的显示名同步更新
- 登出后清除本地存储，跳转到登录页

---

### Phase 9: 群权限增强（可选）

> 基于 Sprint 2 已有的 GroupRole 枚举（OWNER/ADMIN/MEMBER）权限矩阵，增加细粒度控制。
>
> **此 Phase 为可选**，Sprint 2 的 OWNER/ADMIN/MEMBER 三级权限已满足 MVP 需求。仅在有明确需求时实施。

**目标**：在现有角色权限矩阵基础上，增加禁言、封禁等管理能力。

| # | 任务 | 产出 | 验收标准 |
|---|------|------|---------|
| 9.1 | 禁言功能 | PATCH `/api/v1/converses/groups/:converseId/members/:memberId/mute` | ConverseMember 增加 muteUntil 字段 |
| 9.2 | 禁言校验 | MessagesService.create() 中检查 | 被禁言用户无法在群中发消息 |
| 9.3 | 禁言自动解除 | 到期后自动恢复 | 基于 muteUntil 时间比较 |
| 9.4 | 封禁功能 | POST `/api/v1/converses/groups/:converseId/bans/:userId` | 新增 GroupBan 模型或黑名单字段 |
| 9.5 | 封禁效果 | 踢出 + 禁止重新加入 | 创建 ConverseMember 时检查封禁列表 |
| 9.6 | 解封 | DELETE `/api/v1/converses/groups/:converseId/bans/:userId` | 仅 OWNER/ADMIN |
| 9.7 | Flutter 管理 UI | 群详情中的禁言/封禁按钮 | 长按成员弹出操作菜单 |
| 9.8 | Desktop 管理 UI | 同上 | 同上 |
| 9.9 | 单元测试 | converses.service.spec.ts 扩展 | 禁言 + 封禁流程测试 |

**验收标准**：
- OWNER/ADMIN 可禁言成员，指定时长
- 被禁言成员发消息返回 403
- 禁言到期自动解除
- 封禁成员自动踢出 + 无法重新加入
- 解封后可重新加入

---

## 交付物总览

| 交付物 | 描述 | 对应 Phase |
|--------|------|-----------|
| LLM Router | DeepSeek + Kimi 2.5 多 provider 路由 + 降级 | Phase 0 |
| @ai Whisper | 1 主推荐 + 2 备选，<2s | Phase 1 |
| Draft & Verify | PENDING → APPROVED/REJECTED/EXPIRED，5min TTL | Phase 2 |
| Predictive Actions | 上下文分析 → 操作卡片 + 危险分级 | Phase 3 |
| Bot 间通信 | 消息路由 + 触发来源标注 + 限流 | Phase 4 |
| OpenClaw 集成 | OpenClaw Node 进程管理 + 命令执行 + 回退 | Phase 5 |
| Supervisor 通知 | Bot 事件聚合 + 通知卡片 + 5s 合并 | Phase 6 |
| @Bot 群聊路由 | @CodingBot 精准调用 + @ai 兜底 | Phase 7 |
| Profile 页面 | 个人资料展示 + 编辑 + 登出 | Phase 8 |
| 群权限增强 | 禁言 + 封禁（可选） | Phase 9 |

## 新增 REST API 端点

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/v1/users/me` | 当前用户详情 |
| PATCH | `/api/v1/users/me` | 更新用户信息 |
| POST | `/api/v1/converses/groups/:converseId/bots/:botId` | 添加 Bot 到群 |
| DELETE | `/api/v1/converses/groups/:converseId/bots/:botId` | 移除群内 Bot |
| PATCH | `/api/v1/converses/groups/:converseId/members/:memberId/mute` | 禁言成员（可选） |
| POST | `/api/v1/converses/groups/:converseId/bans/:userId` | 封禁成员（可选） |
| DELETE | `/api/v1/converses/groups/:converseId/bans/:userId` | 解封成员（可选） |

## 新增 WS 事件

| 事件名 | 方向 | 说明 |
|--------|------|------|
| `ai:whisper:suggestions` | S→C | 回复建议推送 |
| `ai:whisper:request` | C→S | 请求 AI 建议（@ai 触发） |
| `ai:whisper:accept` | C→S | 采纳建议 |
| `ai:draft:created` | S→C | 草稿卡片推送 |
| `ai:draft:approve` | C→S | 批准草稿 |
| `ai:draft:reject` | C→S | 拒绝草稿 |
| `ai:draft:edit` | C→S | 编辑后批准 |
| `ai:draft:expired` | S→C | 草稿过期通知 |
| `ai:predictive:action` | S→C | 预测操作卡片 |
| `ai:predictive:execute` | C→S | 执行预测操作 |
| `ai:predictive:dismiss` | C→S | 忽略预测 |

## 里程碑检查点

| 检查点 | 验收内容 | 对应 Phase |
|--------|---------|-----------|
| **M1** | LLM 可调用：DeepSeek + Kimi 2.5 双 provider + 降级逻辑 | Phase 0 |
| **M2** | @ai 可用：输入 @ai → 2 秒内收到建议 → 采纳后发送 | Phase 1 |
| **M3** | Draft 可用：Bot 生成草稿 → 用户确认 → 执行消息/命令 | Phase 2 |
| **M4** | Predictive 可用：错误上下文 → 操作卡片 → 确认执行 | Phase 3 |
| **M5** | Bot 互通：A 完成任务 → B 收到协作通知 + 来源标注 | Phase 4 |
| **M6** | OpenClaw 可用：命令通过 OpenClaw 执行 + 回退可用 | Phase 5 |
| **M7** | Supervisor 通知：Bot 事件自动聚合到 Supervisor 聊天流 | Phase 6 |
| **M8** | 群内 Bot：@CodingBot 精准调用 + @ai 兜底 | Phase 7 |

---

## Sprint 3 不做的事

| 功能 | 原因 | 何时做 |
|------|------|--------|
| 文件/图片/语音消息 | Sprint 3 仍为纯文本 | Sprint 4 |
| 推送通知 (FCM / APNs) | 依赖 WS 实时连接 | Sprint 4 |
| 消息搜索 | PG 全文搜索配置 | Sprint 4 |
| i18n | 硬编码中文 | Sprint 4 |
| 消息撤回（增强） | Sprint 2 已有基础软删除 | Sprint 4（加时间限制 + 管理员权限） |
| 语音/视频通话 | 明确排除出 MVP | 未规划 |
| 生产部署 | 仍跑 localhost | Sprint 4 |
| Ghost Text (灰体补全) | v2+ 计划，需要本地小模型 | 未规划 |

**完成后进入 → [Sprint 4](./sprint4_implement.md)**
