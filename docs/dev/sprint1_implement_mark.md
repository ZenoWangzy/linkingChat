# Sprint 1 实施记录

> **目标**：手机发一条文字指令 → 云端转发 → 桌面端执行 Shell 命令 → 结果 <3秒 返回手机显示
>
> **本次完成**：Phase 0 + Phase 1（Server 核心）+ Phase 2（Desktop 客户端）
>
> **完成日期**：2026-02-14

---

## 当前进度

| Phase | 内容 | 状态 | 里程碑 |
|-------|------|------|--------|
| Phase 0 | 共享类型（ws-protocol + shared） | ✅ 完成 | — |
| Phase 1 | Server 核心（Auth + Devices + WS Gateway） | ✅ 完成 | M1 ✅ M2 ✅ |
| Phase 2 | Electron Desktop（登录 + WS + Shell 执行） | ✅ 完成 | M3 待集成验证 |
| Phase 3 | Flutter Mobile（登录 + 设备列表 + 命令发送） | ⏳ 待开始 | M4 |
| Phase 4 | 全链路集成测试 | ⏳ 待开始 | M5 |

---

## Phase 0+1 做了什么

### 一句话总结

搭建了完整的**云端大脑 (Cloud Brain)** 后端服务：JWT RS256 认证体系 + 设备管理 REST API + WebSocket 实时网关 + Redis 适配器 + 危险命令拦截 + E2E 测试全覆盖。

### 新增文件清单

总计 **16 个新文件**（14 个源文件 + 2 个测试文件），约 **1,100 行代码**。

```
apps/server/src/
├── prisma/                          # Prisma 数据库模块（25 行）
│   ├── prisma.service.ts            # PrismaClient 封装，带连接/断开生命周期
│   └── prisma.module.ts             # @Global() 全局模块，全应用可注入 PrismaService
│
├── auth/                            # 认证模块（338 行）
│   ├── dto/
│   │   ├── register.dto.ts          # 注册 DTO（class-validator 校验：email, username 3-30, password 8-100）
│   │   ├── login.dto.ts             # 登录 DTO（email + password）
│   │   └── refresh.dto.ts           # 刷新 DTO（refreshToken）
│   ├── strategies/
│   │   └── jwt.strategy.ts          # Passport RS256 策略，从 env 读取 base64 编码公钥
│   ├── guards/
│   │   └── jwt-auth.guard.ts        # AuthGuard('jwt') 路由守卫封装
│   ├── decorators/
│   │   └── current-user.decorator.ts # @CurrentUser() 参数装饰器，从 request 中提取用户
│   ├── auth.service.ts              # 核心服务：register, login, refresh(Token Rotation), logout
│   ├── auth.controller.ts           # 4 个 POST 端点：/api/v1/auth/*
│   └── auth.module.ts               # 组装 PassportModule + JwtModule + AuthService + JwtStrategy
│
├── devices/                         # 设备模块（208 行）
│   ├── devices.service.ts           # CRUD + upsertDevice + setOffline + updateLastSeen
│   ├── devices.controller.ts        # GET/PATCH/DELETE /api/v1/devices/*（全部要 JWT）
│   ├── commands.service.ts          # create(PENDING), complete(状态+结果), findByUser(游标分页)
│   └── devices.module.ts            # 导出 DevicesService + CommandsService
│
├── gateway/                         # WebSocket 网关模块（377 行）
│   ├── adapters/
│   │   └── redis-io.adapter.ts      # Redis pub/sub 适配器，支持多实例水平扩展
│   ├── middleware/
│   │   └── ws-auth.middleware.ts     # WS 握手认证中间件（原生 jsonwebtoken RS256）
│   ├── device.gateway.ts            # /device 命名空间完整网关（最大文件，279 行）
│   └── gateway.module.ts            # 导入 DevicesModule，提供 DeviceGateway
│
├── app.module.ts                    # [更新] 导入所有新模块
└── main.ts                          # [更新] 添加 ValidationPipe + ShutdownHooks + RedisIoAdapter

apps/server/test/
├── jest-e2e.json                    # E2E 测试配置
└── app.e2e-spec.ts                  # 12 个 E2E 测试用例
```

### 修改的已有文件

| 文件 | 变更 |
|------|------|
| `apps/server/src/app.module.ts` | 新增导入 PrismaModule, AuthModule, DevicesModule, GatewayModule |
| `apps/server/src/main.ts` | 新增 ValidationPipe、enableShutdownHooks、RedisIoAdapter |
| `apps/server/package.json` | 新增 jsonwebtoken、socket.io-client 等依赖；test:e2e 加 --forceExit |

---

## 关键技术设计

### 1. 认证流程

```
注册/登录
  │
  ├── argon2 哈希密码（比 bcrypt 更安全、抗 GPU/ASIC 攻击）
  │
  └── 生成 Token Pair（RS256 非对称签名）
       ├── Access Token（15 分钟，含 sub + username + jti）
       └── Refresh Token（30 天，含 sub + type + jti）
            └── 存储到 refresh_tokens 表

刷新（Token Rotation）
  ├── 验证旧 refresh token → 查数据库确认存在
  ├── 删除旧 token
  └── 生成全新的 token pair

jti 防碰撞
  └── 每个 JWT 含 crypto.randomUUID()，避免同秒签发产生相同 token
```

### 2. WebSocket 架构

```
客户端连接
  │
  ├── 1) 握手阶段：ws-auth.middleware 验证 JWT（AUTH_MISSING / AUTH_EXPIRED / AUTH_INVALID）
  │
  ├── 2) 连接成功：加入 u-{userId} 房间
  │
  ├── 3) 设备注册：upsert 设备 → 加入 d-{deviceId} 房间 → 广播 online 状态
  │
  ├── 4) 命令流程：
  │     Mobile → device:command:send → 危险命令检查
  │       ├── 通过 → 创建 Command(PENDING) → emit 到 d-{targetDeviceId}
  │       └── 拦截 → 返回 COMMAND_DANGEROUS 错误
  │
  ├── 5) 结果回报：
  │     Desktop → device:result:complete → 更新 Command → emit 到 u-{issuerId}
  │
  └── 6) 断开连接：设备 offline → 广播状态变更
```

### 3. 危险命令拦截

12 条正则模式，阻止以下类型的命令：

| 类型 | 示例 |
|------|------|
| 递归删除根目录 | `rm -rf /`, `rm -rf ~` |
| 格式化磁盘 | `format`, `mkfs.ext4` |
| 直写磁盘 | `dd if=...` |
| Fork 炸弹 | `:(){ :|:& };:` |
| 关机/重启 | `shutdown`, `reboot`, `halt`, `poweroff` |
| 递归权限修改 | `chmod 777 /`, `chown -R ... /` |
| 覆写块设备 | `> /dev/sda` |
| 管道执行远程脚本 | `... | bash`, `curl ... | sh` |

---

## 测试验证方法

### 方法 1：运行自动化测试（推荐）

```bash
# 前提：Docker 服务已启动
docker compose -f docker/docker-compose.yaml up -d

# 单元测试（2 个）
pnpm --filter server test

# E2E 测试（12 个，覆盖 M1 + M2 全部验收点）
pnpm --filter server test:e2e

# 全量构建（4 个包）
pnpm build
```

### 方法 2：手动 curl 验证

```bash
# 0. 启动服务
pnpm --filter server dev

# 1. 注册用户
curl -X POST http://localhost:3008/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","username":"testuser","password":"Test1234!","displayName":"Test"}'

# 返回 { user: {...}, accessToken: "eyJ...", refreshToken: "eyJ..." }

# 2. 登录
curl -X POST http://localhost:3008/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Test1234!"}'

# 3. 用 JWT 访问设备列表
curl http://localhost:3008/api/v1/devices \
  -H "Authorization: Bearer <accessToken>"

# 4. 无 JWT 应返回 401
curl http://localhost:3008/api/v1/devices
# → { "statusCode": 401, "message": "Unauthorized" }

# 5. 刷新 Token
curl -X POST http://localhost:3008/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'

# 6. 访问 Swagger 文档
# 浏览器打开 http://localhost:3008/api/docs
```

### 方法 3：Swagger UI 可视化测试

浏览器打开 `http://localhost:3008/api/docs`，可以看到所有 API 端点，点击 "Try it out" 直接测试。

### 验收检查清单

| # | 验收项 | 命令/操作 | 预期结果 |
|---|--------|----------|----------|
| 1 | 注册用户 | POST /api/v1/auth/register | 201，返回 user + tokens |
| 2 | 重复注册 | 同上，相同 email | 409 Conflict |
| 3 | 登录 | POST /api/v1/auth/login | 200，返回 tokens |
| 4 | 错误密码 | 同上，错误密码 | 401 Unauthorized |
| 5 | 刷新 Token | POST /api/v1/auth/refresh | 200，新 token ≠ 旧 token |
| 6 | 无 JWT 访问 | GET /api/v1/devices（无 Header） | 401 |
| 7 | 有 JWT 访问 | GET /api/v1/devices（Bearer token） | 200，返回数组 |
| 8 | WS 无 token | 连接 /device 不带 auth | AUTH_MISSING 错误 |
| 9 | WS 无效 token | 连接 /device 带假 token | AUTH_INVALID 错误 |
| 10 | WS 连接 + 注册 | 连接 /device → emit device:register | success: true |
| 11 | 危险命令拦截 | emit device:command:send `rm -rf /` | COMMAND_DANGEROUS |
| 12 | Swagger UI | 浏览器 /api/docs | 页面可访问 |

---

## 编译期修复记录

| 问题 | 原因 | 修复方式 |
|------|------|----------|
| `expiresIn` 类型不兼容 | @nestjs/jwt v11 使用 `ms` 包的 branded `StringValue` 类型，普通 `string` 不可赋值 | `as any` 类型断言 |
| Prisma JSON 字段类型 | `Record<string, unknown>` 不匹配 Prisma 的 `InputJsonValue` | `as Prisma.InputJsonValue` |
| Refresh Token unique 冲突 | 同秒内多次 JWT 签发，payload + iat 相同导致生成完全相同的 token | 添加 `jti: crypto.randomUUID()` claim |

---

## E2E 测试结果

```
Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total (3.4s)

  M1: Auth endpoints
    ✓ POST /api/v1/auth/register — create user (86ms)
    ✓ POST /api/v1/auth/register — reject duplicate (5ms)
    ✓ POST /api/v1/auth/login — authenticate (47ms)
    ✓ POST /api/v1/auth/login — reject bad password (39ms)
    ✓ POST /api/v1/auth/refresh — rotate tokens (12ms)
    ✓ GET /api/v1/devices — require auth (2ms)
    ✓ GET /api/v1/devices — work with JWT (5ms)

  M2: WebSocket /device namespace
    ✓ reject connection without token (7ms)
    ✓ reject connection with invalid token (3ms)
    ✓ connect with valid JWT and register device (10ms)
    ✓ block dangerous commands (4ms)

  Swagger docs
    ✓ GET /api/docs — serve Swagger UI (2ms)
```

---

## REST API 端点总览

### Auth（无需 JWT）

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/v1/auth/register` | 注册（argon2 hash） |
| POST | `/api/v1/auth/login` | 登录 → JWT RS256 token pair |
| POST | `/api/v1/auth/refresh` | 刷新 access token（Token Rotation） |
| POST | `/api/v1/auth/logout` | 登出（删除 refresh token） |

### Devices（需要 JWT）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/v1/devices` | 当前用户设备列表 |
| GET | `/api/v1/devices/:id` | 单个设备详情 |
| PATCH | `/api/v1/devices/:id` | 更新设备名称 |
| DELETE | `/api/v1/devices/:id` | 删除设备 |

### WebSocket 事件（/device 命名空间）

| 事件 | 方向 | 说明 |
|------|------|------|
| `device:register` | Client→Server | 桌面端注册设备 |
| `device:heartbeat` | Client→Server | 心跳保活 |
| `device:command:send` | Client→Server | 手机端发送命令 |
| `device:command:cancel` | Client→Server | 取消命令 |
| `device:result:complete` | Client→Server | 桌面端回报结果 |
| `device:command:execute` | Server→Client | 下发命令给桌面 |
| `device:command:ack` | Server→Client | 命令已分发确认 |
| `device:result:delivered` | Server→Client | 结果推送给手机 |
| `device:status:changed` | Server→Client | 设备上下线通知 |

---

## 下一步

| Phase | 内容 | 前置条件 |
|-------|------|----------|
| **Phase 3** | Flutter Mobile：登录页 → 设备列表 → 命令输入 → 结果展示 | Phase 1 ✅ + Flutter SDK |
| **Phase 4** | 全链路集成测试：手机 → 云 → 桌面 → 手机 < 3 秒 | Phase 2 ✅ + Phase 3 |

---

## Phase 2：Electron Desktop 客户端

> **完成日期**：2026-02-14

### 一句话总结

搭建了完整的 Electron 桌面客户端：登录 UI → JWT 安全存储 → WebSocket 自动连接 → 设备注册 → 命令接收执行 → 结果回报 → 实时 UI 展示。

### 新增文件清单

总计 **13 个新文件 + 3 个更新文件**：

```
apps/desktop/src/
├── main/                                       # 主进程
│   ├── index.ts                                # [更新] 完整入口：IPC 注册 + WS 客户端 + 自动连接
│   ├── ipc/
│   │   ├── auth.ipc.ts                         # IPC handler：登录 / 登出 / 获取 token
│   │   └── device.ipc.ts                       # IPC handler：连接状态 / 设备信息 / 命令日志
│   ├── services/
│   │   ├── auth-store.service.ts               # JWT 安全存储（electron-store + safeStorage 加密）
│   │   ├── ws-client.service.ts                # Socket.IO 客户端核心（连接/注册/命令/结果）
│   │   └── command-executor.service.ts         # Shell 命令执行器（child_process.exec）
│   └── utils/
│       ├── command-blacklist.ts                # 客户端侧危险命令拦截（defense-in-depth）
│       └── platform.ts                         # 设备信息工具（hostname, platform, deviceId）
│
├── preload/
│   └── index.ts                                # [更新] contextBridge 暴露完整 API
│
└── renderer/                                   # 渲染进程 (React)
    ├── App.tsx                                 # [更新] 路由：Login / Dashboard
    ├── env.d.ts                                # window.electronAPI 类型声明
    ├── pages/
    │   ├── Login.tsx                           # 登录表单
    │   └── Dashboard.tsx                       # 主界面：状态 + 日志
    ├── components/
    │   ├── ConnectionStatus.tsx                # 连接状态指示器 + 设备信息
    │   └── CommandLog.tsx                      # 命令日志列表
    └── styles/
        └── global.css                          # 全局样式（深色主题）

electron-builder.yaml                           # 打包配置
```

### 关键设计决策

**IPC 通信模式**：
- 渲染进程 → 主进程：`ipcRenderer.invoke()` 请求-响应模式（登录、获取状态）
- 主进程 → 渲染进程：`webContents.send()` 事件推送（状态变更、命令日志更新）
- 所有网络请求（HTTP + WebSocket）仅在主进程中执行
- preload 脚本作为白名单桥梁，渲染进程无法直接访问 Node.js API

**JWT 安全存储**：
- 使用 `electron-store` + `safeStorage` 双层保护
- `safeStorage.isEncryptionAvailable()` 时使用系统级加密
- 回退方案：开发环境直接存储 JSON

**WebSocket 客户端**：
- 自动重连（1s → 30s 递增，无限重试）
- 连接成功自动注册设备
- 实时推送连接状态到渲染进程

**Shell 执行器**：
- 默认 30 秒超时，最大 512 KB 输出缓冲
- Windows 用 `cmd.exe`，macOS/Linux 用 `/bin/sh`
- 双层危险命令拦截（服务端 + 客户端）

### 构建验证

```
electron-vite build:
  main/index.js      11.26 KB   (8 modules)
  preload/index.js    0.98 KB   (1 module)
  renderer/index.js 564.12 KB   (32 modules)
  renderer/index.css   4.23 KB
```

### Phase 2 验证方法

```bash
# 1. 确保服务端运行
pnpm --filter server dev

# 2. 启动桌面端
pnpm --filter desktop dev

# 3. 手动验证清单：
#    - Electron 窗口打开，显示登录表单
#    - 输入邮箱/密码，点击登录
#    - 登录成功后跳转到 Dashboard
#    - 显示连接状态（Connected / Disconnected）
#    - 显示设备信息（主机名、平台）
#    - 命令日志区域显示 "等待命令"

# 4. M3 里程碑完整验证需要 Phase 3（手机端）发送命令
#    届时桌面端应能接收命令 → 执行 → 返回结果
```
