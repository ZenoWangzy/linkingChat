# Tinode Chat 深度调研报告

> 调研日期：2026-02-11
>
> 背景：团队同事提议使用 [tinode/chat](https://github.com/tinode/chat) 作为 IM 后端。本报告基于对 Tinode 仓库、文档、协议、许可证、插件系统的深度调研，给出评估结论。

---

## 一、项目概览

| 属性 | 详情 |
|------|------|
| **仓库** | [github.com/tinode/chat](https://github.com/tinode/chat) |
| **Stars** | ~13,100 |
| **语言** | Go（服务端） |
| **许可证** | **GPL-3.0**（服务端）/ **Apache-2.0**（客户端 SDK + Protobuf 定义） |
| **最新版本** | v0.25.1 (2025-12-26) |
| **维护状态** | 活跃，4,165+ commits |
| **架构模型** | Pub-Sub Hub-and-Spoke |
| **数据库** | MySQL, PostgreSQL 13+, MongoDB, RethinkDB (deprecated) |
| **传输协议** | JSON over WebSocket / Protobuf over gRPC / Long Polling |

---

## 二、架构分析

### 2.1 Hub-and-Spoke 模型

```
Clients (WS / LP / gRPC)
       │
   ┌───v───┐
   │Session│  ← 每个客户端连接对应一个 Session
   └───┬───┘
       │
   ┌───v───┐
   │  Hub  │  ← 中央路由器，管理所有 Topic 生命周期
   └───┬───┘
       │
   ┌───v───┐
   │ Topic │  ← 通信频道 (me / fnd / usr / grp / chn / slf / sys)
   └───┬───┘
       │
   ┌───v───┐
   │ Store │  ← 可插拔数据库适配器 (MySQL / PG / MongoDB)
   └───────┘
```

### 2.2 Topic 类型体系

| Topic 类型 | 前缀 | 描述 | 创建方式 |
|-----------|------|------|---------|
| **me** | `me` | 个人配置/通知中心 | 自动创建 |
| **fnd** | `fnd` | 用户/话题发现（标签搜索） | 自动创建 |
| **slf** | `slf` | 私人书签/收藏 | 自动创建 |
| **P2P** | `usr` | 1对1 对话 | 订阅对方 userId |
| **Group** | `grp` | 群聊 | `{sub topic="new"}` |
| **Channel** | `chn` | 频道（无限只读订阅者） | `{sub topic="nch"}` |
| **sys** | `sys` | 系统管理通知 | 系统管理 |

### 2.3 集群方案

- **一致性哈希**分布 Topic 到不同节点
- Master Topic（权威实例在 owner 节点）+ Proxy Topic（其他节点转发）
- 节点间通过 gRPC 通信
- 负载均衡器分配客户端连接

---

## 三、协议详解

### 3.1 Client → Server 消息类型（10 种）

| 消息类型 | 用途 | 示例 |
|---------|------|------|
| `{hi}` | 握手，协商协议版本 | `{"hi":{"ver":"0.22","ua":"App/1.0"}}` |
| `{acc}` | 创建/修改账号 | |
| `{login}` | 认证（basic/token/anonymous/rest） | |
| `{sub}` | 订阅 Topic（同时可创建/加入） | |
| `{pub}` | 发布消息 | |
| `{get}` | 查询元数据/历史消息 | |
| `{set}` | 修改 Topic/用户元数据 | |
| `{del}` | 删除消息/Topic/订阅 | |
| `{note}` | 通知：已读/送达/输入中（临时，不存储） | |
| `{leave}` | 取消订阅 | |

### 3.2 Server → Client 消息类型（5 种）

| 消息类型 | 用途 |
|---------|------|
| `{ctrl}` | 控制响应（HTTP 风格状态码：200/400/401/403/404/500） |
| `{data}` | 消息内容推送（含顺序 ID `seq`） |
| `{meta}` | 元数据响应（描述/订阅者/权限） |
| `{pres}` | 在线状态变更（临时，不存储） |
| `{info}` | 转发其他用户的 `{note}` 通知 |

### 3.3 权限系统（位图 ACL）

| 字符 | 权限 | 说明 |
|------|------|------|
| J | Join | 订阅 Topic |
| R | Read | 接收 `{data}` |
| W | Write | 发布 `{pub}` |
| P | Presence | 接收 `{pres}` |
| A | Approve | 管理员：审批加入、封禁 |
| S | Sharing | 邀请他人 |
| D | Delete | 硬删除消息 |
| O | Owner | 完全控制（每个 Topic 只有一个） |
| N | None | 明确无权限 |

每个订阅有 **Want**（用户请求）+ **Given**（管理员授权）→ **Effective = Want AND Given**。

### 3.4 消息送达与已读

通过三个序列 ID 标记追踪：

- `seq`: Topic 中最高消息 ID（服务端管理）
- `recv`: 客户端已接收的最高消息 ID（`{note what="recv"}`）
- `read`: 用户已阅读的最高消息 ID（`{note what="read"}`）

未读数 = `seq - read`。

---

## 四、插件系统

### 4.1 gRPC Plugin 服务（6 个方法）

```protobuf
service Plugin {
  rpc FireHose(ClientReq) returns (ServerResp) {}       // 拦截所有客户端消息（核心）
  rpc Find(SearchQuery) returns (SearchFound) {}         // 自定义搜索
  rpc Account(AccountEvent) returns (Unused) {}          // 账户生命周期（只读）
  rpc Topic(TopicEvent) returns (Unused) {}              // Topic 生命周期（只读）
  rpc Subscription(SubscriptionEvent) returns (Unused) {} // 订阅事件（只读）
  rpc Message(MessageEvent) returns (Unused) {}          // 消息事件（只读）
}
```

### 4.2 FireHose 拦截器

对每条客户端消息调用，插件返回处理指令：

| 返回码 | 值 | 行为 |
|--------|---|------|
| `CONTINUE` | 0 | Tinode 正常处理 |
| `DROP` | 1 | 静默丢弃消息 |
| `RESPOND` | 2 | 向客户端发送自定义响应 |
| `REPLACE` | 3 | 替换消息内容后继续处理 |

### 4.3 插件系统的限制

- 文档几乎不存在（[Issue #636](https://github.com/tinode/chat/issues/636) 用户反馈找不到文档）
- 参考实现仅有一个返回随机引言的 Python chatbot
- 插件是外部 gRPC 进程，每条消息都需要跨进程 RPC 调用
- 没有内建的异步任务/队列系统

---

## 五、许可证分析

### 5.1 双许可结构

| 组件 | 许可证 | 影响 |
|------|--------|------|
| 服务端（Go） | **GPL-3.0** | 强 Copyleft |
| 客户端 SDK（Android/iOS/Web） | **Apache-2.0** | 宽松 |
| gRPC Protobuf 定义（pbx/） | **Apache-2.0** | 宽松 |

### 5.2 GPL-3.0 vs AGPL-3.0 的关键区别

**GPL-3.0 有"SaaS Loophole"**：仅在分发二进制时触发 Copyleft。作为网络服务运行不算分发。

| 场景 | GPL 义务？ | 说明 |
|------|-----------|------|
| 修改 Tinode 部署为 SaaS（Cloud Brain） | **无** | SaaS loophole |
| 把 Tinode 打包进 Electron 安装包分发 | **有** | 属于分发，必须开源 |
| 仅使用 Tinode 协议（自己实现服务端） | **无** | 协议不受版权保护 |
| 使用 pbx/model.proto 定义 | **无** | Apache-2.0 |
| 使用客户端 SDK | **无** | Apache-2.0 |

### 5.3 商业许可

| 层级 | 价格 | 内容 |
|------|------|------|
| Basic | 免费 | 自行安装，社区支持 |
| Professional | $500/年 | 管理工具，品牌化客户端 |
| Enterprise | $1,500/年 | 协助安装，专属支持 |
| Cloud | $1.50/用户/月 | 全托管 |

购买商业许可可移除 GPL 义务。

---

## 六、Flutter/Dart SDK 状态

| 属性 | 详情 |
|------|------|
| 仓库 | [tinode/dart-sdk](https://github.com/tinode/dart-sdk) |
| 状态 | 🚨 **已归档（2025-11-18 archived，read-only）** |
| Stars | 42 |
| pub.dev 版本 | 仅 4 个 **alpha** 版本（1.0.0-alpha ~ alpha.4，2021 年发布） |
| Dart SDK 要求 | 2.12（当前 Dart 3.x，**不兼容**） |
| 已知缺陷 | 不支持 Drafty 富文本消息格式 |
| 文档 | "will be created soon"（从未完成） |

**结论：Tinode Dart SDK 已死亡。** 如果使用 Tinode 后端，需要从零编写 Flutter 客户端 SDK。

---

## 七、功能覆盖对比

| 功能 | Tinode | linkingChat 需求 | 匹配 |
|------|--------|-----------------|------|
| 1对1 文字聊天 | ✅ | ✅ | ✅ |
| 群聊 | ✅ | ✅ | ✅ |
| 文件/图片发送 | ✅ (S3/本地) | ✅ | ✅ |
| 消息推送 | ✅ (FCM + TNPG) | ✅ | ✅ |
| 在线/离线状态 | ✅ (`{pres}`) | ✅ | ✅ |
| 已读回执 | ✅ (`{note}` read) | ✅ | ✅ |
| 消息撤回/编辑 | ✅ (`{del}`) | ✅ | ✅ |
| 消息搜索 | ✅ | ✅ | ✅ |
| 语音消息 | ✅ | ✅ | ✅ |
| 好友系统 | ✅ (fnd + tags) | ✅ | ✅ |
| i18n | 有限 | ✅ 从一开始 | ⚠️ |
| **设备远程控制** | ❌ | ✅ (核心功能) | ❌ |
| **AI Draft & Verify** | ❌ | ✅ | ❌ |
| **AI Whisper (<800ms)** | ❌ | ✅ | ❌ |
| **AI Predictive Actions** | ❌ | ✅ | ❌ |

社交功能覆盖率约 95%，但 linkingChat 的核心差异化功能（设备控制 + AI 三模式）完全不被覆盖。

---

## 八、方案对比：Tinode vs NestJS 自建

| 维度 | Tinode 做后端 | NestJS 自建（当前方案） | 优势方 |
|------|-------------|----------------------|--------|
| IM 功能成熟度 | ⭐⭐⭐⭐⭐ 开箱即用 | ⭐⭐ 需逐个实现 | Tinode |
| 许可证 | 🚨 GPL-3.0 | ✅ MIT 全栈 | NestJS |
| Flutter SDK | 🚨 已归档 | ✅ socket_io_client（成熟） | NestJS |
| 语言一致性 | ❌ Go vs TypeScript | ✅ TypeScript everywhere | NestJS |
| OpenClaw 集成 | ❌ 需 gRPC 桥接 | ✅ 原生 WS 同语言 | NestJS |
| AI 集成 | ❌ gRPC 插件 + 外部服务 | ✅ NestJS 内原生 LLM 调用 | NestJS |
| Whisper <800ms | ⚠️ gRPC 中转增加延迟 | ✅ 直接 WS 推送 | NestJS |
| 数据库 | ✅ 支持 PostgreSQL | ✅ PostgreSQL + TypeORM | 平手 |
| 集群扩展 | ⭐⭐⭐⭐ 一致性哈希 | ⭐⭐ Redis Adapter | Tinode |
| 社交功能开发速度 | ⭐⭐⭐⭐ 快 | ⭐⭐ 慢 | Tinode |
| 设备控制+AI 开发速度 | ⭐ 很慢（跨语言） | ⭐⭐⭐⭐ 快 | NestJS |
| 长期维护 | ⚠️ 依赖 Tinode 团队 | ✅ 完全自控 | NestJS |

---

## 九、结论

### 不推荐将 Tinode 作为 linkingChat 后端

原因按严重程度排序：

1. **Dart SDK 已归档** — Flutter 客户端无法对接，需从零写 SDK（工作量大于直接用 Socket.IO）
2. **GPL-3.0 许可证** — 虽有 SaaS loophole，但法律灰色地带，且限制未来分发场景
3. **Go ≠ TypeScript** — 团队已确认 "TypeScript everywhere"，引入 Go 增加学习和维护成本
4. **AI 三模式集成困难** — Q5 答案"都做"（Draft & Verify + Whisper + Predictive Actions），需要深度消息管线集成，gRPC 插件层增加延迟和复杂度
5. **设备控制无原生支持** — linkingChat 的核心差异化功能在 Tinode 中完全没有概念

### Tinode 的参考价值

| 可借鉴的设计 | 应用到 linkingChat |
|-------------|-------------------|
| Topic 类型体系 (me/fnd/usr/grp/chn) | 丰富 Conversation type 枚举，考虑增加 `channel` 类型 |
| `{note}` kp/recv/read 事件 | 输入状态 + 送达确认 + 已读回执的事件设计 |
| `{pres}` on/off/ua 事件 | 在线状态 + User-Agent 设备标识 |
| 位图 ACL (JRWPASDON, Want+Given→Effective) | 未来群权限系统参考 |
| seq/recv/read 三标记追踪 | 消息送达状态追踪的替代方案 |
| FireHose CONTINUE/DROP/RESPOND/REPLACE | AI 消息拦截器中间件模式设计灵感 |
| pbx/model.proto (Apache-2.0) | gRPC 接口定义参考（可合法复用） |
| theCard vCard-like 格式 | 用户/群组描述数据格式参考 |

---

## 附录：参考资源

| 资源 | 链接 |
|------|------|
| Tinode GitHub | https://github.com/tinode/chat |
| Tinode 官网 | https://tinode.co/ |
| Tinode API 文档 | https://github.com/tinode/chat/blob/master/docs/API.md |
| Tinode Dart SDK（已归档） | https://github.com/tinode/dart-sdk |
| Tinode Protobuf 定义 | https://github.com/tinode/chat/tree/master/pbx |
| Tinode Python Chatbot 参考 | https://github.com/tinode/chat/tree/master/chatbot/python |
| Tinode 商业许可 | https://tinode.co/products.html |
| Tinode DeepWiki 架构分析 | https://deepwiki.com/tinode/chat |
| Plugin 文档缺失 Issue | https://github.com/tinode/chat/issues/636 |
