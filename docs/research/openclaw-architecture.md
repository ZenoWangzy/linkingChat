# OpenClaw 架构研究

> 研究日期: 2026-02-28
> 目的: 评估 OpenClaw Gateway 云端部署可行性

## 1. 核心发现

### ✅ OpenClaw 已支持云端部署！

**不需要修改代码**，只需正确配置参数即可。

### 2. Gateway 启动参数

```bash
openclaw gateway --port 18790 --bind lan --token <your-token>
```

| 参数 | 说明 | 选项 |
|------|------|------|
| `--port` | 监听端口 | 任意可用端口 |
| `--bind` | 绑定模式 | `loopback`(默认), `lan`, `tailnet`, `auto`, `custom` |
| `--token` | Token 认证 | 任意字符串 |
| `--auth` | 认证模式 | `none`, `token`, `password`, `trusted-proxy` |
| `--password` | 密码认证 | 任意字符串 |

### 3. 绑定模式详解

| 模式 | 绑定地址 | 用途 |
|------|----------|------|
| `loopback` | `127.0.0.1` | 本地开发（默认） |
| `lan` | `0.0.0.0` | **云端部署** ✅ |
| `tailnet` | Tailscale IP | Tailscale 网络 |
| `custom` | 用户指定 IP | 自定义配置 |
| `auto` | 自动选择 | 智能回退 |

### 4. 认证模式

| 模式 | 说明 | 云端适用 |
|------|------|---------|
| `none` | 无认证 | ❌ 不安全 |
| `token` | Token 认证 | ✅ 推荐 |
| `password` | 密码认证 | ✅ 可用 |
| `trusted-proxy` | 代理信任 | ✅ 配合 Nginx |

### 5. 多用户部署方案

```
Cloud Brain
├── 用户 A: openclaw gateway --port 18790 --bind lan --token <user-a-token>
├── 用户 B: openclaw gateway --port 18791 --bind lan --token <user-b-token>
└── 用户 C: openclaw gateway --port 18792 --bind lan --token <user-c-token>
```

### 6. 关键文件位置

| 文件 | 路径 | 用途 |
|------|------|------|
| Gateway 启动 | `src/cli/gateway-cli/run.ts` | 命令行入口 |
| 网络绑定 | `src/gateway/net.ts` | 绑定逻辑 |
| 认证逻辑 | `src/gateway/auth.ts` | 认证处理 |
| Node 执行 | `src/gateway/node-invoke-system-run-approval.ts` | 安全策略 |

### 7. openclaw-node 客户端

```typescript
import { OpenClawClient } from "openclaw-node";

const client = new OpenClawClient({
  url: "ws://cloud-host:18790",
  token: "user-a-token",
});

await client.connect();

// 发送消息给 Agent
const stream = client.chat("Execute command: ls -la");
for await (const chunk of stream) {
  if (chunk.type === "text") {
    console.log(chunk.text);
  }
}
```

### 8. 安全考虑

1. **必须使用 Token 或 Password 认证** - `--bind lan` 时强制要求
2. **建议使用 Nginx 反向代理** - 添加 HTTPS
3. **端口隔离** - 每个用户独立端口
4. **资源限制** - 限制每个 Gateway 实例的资源使用

## 9. 结论

**OpenClaw 可以直接用于云端部署，无需修改代码。**

实施方案：
1. 使用 `--bind lan` 绑定到外部接口
2. 使用 `--token` 或 `--password` 进行认证
3. 使用 `--port` 进行动态端口分配
4. 在 NestJS 中管理多个 Gateway 进程

## 10. 参考资料

- OpenClaw GitHub: https://github.com/openclaw/openclaw
- openclaw-node npm: https://npm.im/openclaw-node
