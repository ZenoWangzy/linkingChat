# Phase 5: OpenClaw Gateway 云端集成设计文档

> 创建日期: 2026-02-28
> 更新日期: 2026-02-28
> 状态: ✅ 实现完成（所有 8 个任务已完成）
> 作者: CTO (Claude)

## 1. 背景

Sprint 3 Phase 5 需要将现有的 `child_process.exec()` 命令执行方式替换为 OpenClaw Gateway，实现更安全、更可控的远程命令执行能力。

### 1.1 核心原则

- **零门槛**: 用户只需安装 + 授权，无需任何技术配置
- **安全优先**: 默认询问策略，危险命令需确认
- **智能汇报**: 执行结果经过 Agent 处理后再返回用户

### 1.2 重要发现（2026-02-28）

**OpenClaw 无需修改代码即可云端部署！**

```bash
openclaw gateway --port 18790 --bind lan --token <user-token>
```

- `--bind lan` = 绑定到 `0.0.0.0`（外部可访问）
- `--token` = Token 认证
- `--port` = 动态端口分配

## 2. 架构设计

### 2.1 数据流

```
用户手机 App 发送命令
        ↓
Cloud Brain (NestJS) 处理 + 转发
        ↓
Gateway Manager 启动用户专属 OpenClaw Gateway
        ↓
Desktop (Electron) 通过 openclaw-node 连接到 Gateway
        ↓
OpenClaw Agent 执行 shell 命令（system.run）
        ↓
结果返回 → Cloud Agent Service
        ↓
Agent 分析 + 智能处理 + 汇报
        ↓
推送到用户手机端
```

### 2.2 组件架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cloud Brain (NestJS)                    │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │ WS Gateway   │ ←→ │ Gateway      │ ←→ │ Agent Service    │   │
│  │ (现有)       │    │ Manager      │    │ (智能处理)       │   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
│                              │                                   │
│                              ↓ 管理多个进程                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ OpenClaw    │  │ OpenClaw    │  │ OpenClaw    │  ...        │
│  │ Gateway     │  │ Gateway     │  │ Gateway     │             │
│  │ :18790      │  │ :18791      │  │ :18792      │             │
│  │ (用户A)     │  │ (用户B)     │  │ (用户C)     │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
└─────────┼───────────────┼───────────────┼──────────────────────┘
          │               │               │
   ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
   │ Desktop     │ │ Desktop     │ │ Desktop     │
   │ (用户A)     │ │ (用户B)     │ │ (用户C)     │
   │ openclaw    │ │ openclaw    │ │ openclaw    │
   │ -node       │ │ -node       │ │ -node       │
   └─────────────┘ └─────────────┘ └─────────────┘
```

## 3. 核心组件

### 3.1 Cloud Brain 组件

| 组件 | 职责 | 技术 |
|------|------|------|
| **Gateway Manager Service** | 管理多用户 Gateway 实例 | NestJS Service |
| **OpenClaw Gateway** | 命令路由、Agent 调度、安全策略 | OpenClaw (开源) |
| **Agent Service** | 结果分析、智能汇报 | NestJS Service |

### 3.2 Desktop 组件

| 组件 | 职责 | 技术 |
|------|------|------|
| **openclaw-node** | 连接 Gateway、执行命令 | npm 包 |
| **Command Executor** | Shell 命令执行（降级） | child_process |

## 4. 安全模型

### 4.1 OpenClaw 原生安全策略

OpenClaw Gateway 支持四种认证模式：

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| `none` | 无认证 | ❌ 不安全，不推荐 |
| `token` | Token 认证 | ✅ 推荐，用于云端 |
| `password` | 密码认证 | ✅ 可用 |
| `trusted-proxy` | 代理信任 | ✅ 配合 Nginx |

### 4.2 LinkingChat JWT 集成

```
1. 用户登录 → 获取 JWT Token
2. Desktop 连接 → 使用 JWT 换取 Gateway Token
3. Gateway Manager → 验证 JWT，生成用户专属 Gateway Token
4. Desktop → 使用 Token 连接 OpenClaw Gateway
```

### 4.3 危险命令检测

OpenClaw 内置 `system.run` 审批机制：
- 支持命令白名单
- 支持危险命令检测
- 支持用户确认流程

## 5. 能力上报

Desktop 启动时自动上报支持的能力（通过 OpenClaw Node）：

```typescript
{
  deviceId: "device-uuid",
  capabilities: [
    "system.run",      // Shell 命令执行
    "system.notify",   // 系统通知
    // 未来扩展:
    // "camera.snap",
    // "screen.record",
  ],
  platform: "darwin" | "win32",
  version: "1.0.0"
}
```

## 6. 降级策略

当 OpenClaw Gateway 不可用时，Desktop 自动降级到 `child_process.exec()`：

```typescript
async executeCommand(command: string): Promise<CommandResult> {
  if (this.openClawClient?.isConnected()) {
    try {
      return await this.executeViaOpenClaw(command);
    } catch (error) {
      this.logger.warn('OpenClaw unavailable, falling back');
    }
  }
  return await this.executeWithChildProcess(command);
}
```

## 7. 开发任务

| # | 任务 | 预估 | 状态 |
|---|------|------|------|
| 1 | 研究 OpenClaw 架构 | 0.5天 | ✅ 完成 |
| 2 | 修改 Gateway 网络绑定 | - | ⏭️ 跳过（原生支持） |
| 3 | 创建 Gateway Manager Service | 1天 | ✅ 完成 |
| 4 | 集成 JWT 认证 | 0.5天 | ✅ 完成 |
| 5 | Desktop 集成 openclaw-node | 1天 | ✅ 完成 |
| 6 | 连接数据流 | 0.5天 | ✅ 完成 |
| 7 | 端到端测试 | 0.5天 | ✅ 完成 |
| 8 | 更新文档 | 0.5天 | ✅ 完成 |

**总计: 约 4.5 天**

## 8. 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| OpenClaw Gateway 进程崩溃 | 中 | 自动重启 + 降级策略 |
| 跨平台兼容性 | 中 | Windows/macOS 双平台测试 |
| 资源消耗（多进程） | 中 | 端口池管理 + 进程限制 |

## 9. 决策记录

### 2026-02-28 架构决策

- **选择方案**: 使用 OpenClaw Gateway（无需修改代码）
- **原因**: OpenClaw 原生支持 `--bind lan` 云端部署
- **确认人**: CEO

### 关键发现

- OpenClaw 支持 `--bind lan` 绑定到 0.0.0.0
- OpenClaw 支持 `--token` Token 认证
- OpenClaw 支持 `--port` 动态端口
- **无需 Fork 或修改 OpenClaw 代码！**

### 关键澄清

- 执行结果必须经过 Cloud Agent 处理后再返回用户
- Agent 负责结果分析、智能处理、上下文添加
- 每个用户一个 Gateway 实例（多租户架构）
