# Sprint 1 实施记录

> **目标**：手机发一条文字指令 → 云端转发 → 桌面端执行 Shell 命令 → 结果 <3秒 返回手机显示
>
> **本次完成**：Phase 0 + Phase 1（Server 核心）+ Phase 2（Desktop 客户端）+ Phase 3（Flutter Mobile）
>
> **完成日期**：2026-02-14
>
> **测试登录邮箱**： test@linkingchat.com / Test1234x

---

## 当前进度

| Phase | 内容 | 状态 | 里程碑 |
|-------|------|------|--------|
| Phase 0 | 共享类型（ws-protocol + shared） | ✅ 完成 | — |
| Phase 1 | Server 核心（Auth + Devices + WS Gateway） | ✅ 完成 | M1 ✅ M2 ✅ |
| Phase 2 | Electron Desktop（登录 + WS + Shell 执行） | ✅ 完成 | M3 ✅ |
| Phase 3 | Flutter Mobile（登录 + 设备列表 + 命令发送） | ✅ 完成 | M4 ✅ |
| Phase 4 | 全链路集成测试 | ✅ 手动验证通过 | M5 ✅ |

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

Sprint 1 全部 Phase 已完成。全链路手动验证通过：手机发命令 → 云端转发 → 桌面执行 → 结果 64ms 返回手机。

| 优先级 | 内容 | 说明 |
|--------|------|------|
| P0 | Sprint 2 开始 | 社交消息基础（1v1 聊天、消息持久化、离线推送） |
| P1 | Token 自动刷新 | Mobile 端 AuthInterceptor 已有 refresh 逻辑，Desktop 端还需补齐 |
| P2 | 原生平台测试 | 当前 Mobile 仅在 Flutter Web 验证，需 iOS/Android 真机测试 |
| P2 | Desktop 打包 | electron-builder 配置已有，需验证 Windows/macOS 打包 |

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

---

## Phase 3：Flutter Mobile 客户端

> **完成日期**：2026-02-14

### 一句话总结

搭建了完整的 Flutter 移动端应用：登录页 → JWT 存储 → 设备列表（REST + WS 状态同步）→ 命令发送（WebSocket）→ 结果实时展示。与 Phase 1 Server + Phase 2 Desktop 联调验证，全链路命令执行 **64ms** 返回。

### 环境准备

- Flutter 3.41.1 / Dart 3.11.0（安装到 `D:\flutter`）
- `flutter doctor` 验证：Windows ✓、Chrome ✓
- 当前阶段使用 **Flutter Web** 测试（`flutter run -d web-server --web-port 8080`）
- Server 添加 `app.enableCors()` 以支持 Flutter Web 跨域请求

### 新增文件清单

总计 **17 个新文件 + 2 个更新文件**：

```
apps/mobile/lib/
├── main.dart                                      # [更新] 简化入口，ProviderScope 包裹
├── app.dart                                       # MaterialApp.router + GoRouter
├── router.dart                                    # GoRouter 路由定义 + Auth 重定向守卫
│
├── core/
│   ├── constants/
│   │   ├── api_endpoints.dart                     # API 基础 URL 常量
│   │   └── ws_events.dart                         # WS 事件名常量（镜像 ws-protocol）
│   └── network/
│       ├── auth_repository.dart                   # JWT 存储（Web 用内存，原生用 secure_storage）
│       ├── auth_interceptor.dart                  # Dio QueuedInterceptor：自动 Bearer + 401 刷新
│       ├── api_client.dart                        # Dio 实例 + AuthInterceptor 组装
│       └── ws_service.dart                        # Socket.IO 客户端：连接/事件监听/命令发送
│
├── features/
│   ├── auth/
│   │   ├── models/
│   │   │   └── auth_response.dart                 # AuthResponse + UserInfo 数据模型
│   │   ├── providers/
│   │   │   └── auth_provider.dart                 # AuthNotifier：login/logout/checkSavedAuth
│   │   └── pages/
│   │       └── login_page.dart                    # 登录表单 + 自动登录检测
│   │
│   └── device/
│       ├── models/
│       │   ├── device.dart                        # Device 模型 + platformIcon/platformLabel
│       │   └── command_result.dart                # CommandResult 模型
│       ├── providers/
│       │   ├── device_provider.dart               # 设备列表 Notifier（REST + WS 状态监听）
│       │   └── command_provider.dart              # 命令发送 Notifier（发送/ACK/结果/超时）
│       ├── pages/
│       │   ├── device_list_page.dart              # 设备列表页（刷新/登出/点击进命令页）
│       │   └── command_page.dart                  # 命令输入页 + 实时结果展示
│       └── widgets/
│           └── command_result_card.dart           # 结果卡片（成功/失败、输出、耗时、退出码）

apps/mobile/test/
└── widget_test.dart                               # [更新] 适配新应用结构

apps/server/src/
└── main.ts                                        # [更新] 添加 CORS 支持
```

### 关键设计决策

**状态管理：Riverpod StateNotifier**
- `AuthNotifier`：管理认证状态（unauthenticated → authenticating → authenticated）
- `DeviceListNotifier`：REST 拉取设备列表 + WS 监听 `device:status:changed` 实时更新
- `CommandNotifier`：管理命令生命周期（idle → sending → waiting → completed/error）
- Provider 之间通过 `Ref` 互相访问，`authProvider` 驱动 GoRouter 重定向

**路由守卫：GoRouter + ChangeNotifier Bridge**
- `refreshListenable` 桥接 Riverpod 的 `authProvider` 到 GoRouter
- `_AuthRefreshNotifier` 监听 auth 状态变化，触发 GoRouter `redirect` 重新评估
- 未认证时任何页面自动跳转 `/login`

**平台自适应存储**
- `kIsWeb` 判断运行平台
- Web：`Map<String, String>` 内存存储（页面刷新会清空，通过路由守卫处理）
- 原生：`flutter_secure_storage`（iOS Keychain / Android EncryptedSharedPreferences）

**WebSocket 客户端（Socket.IO）**
- Web 平台使用默认传输（polling + websocket upgrade）
- 原生平台强制 websocket-only 传输
- 自定义事件分发系统：`_listeners` Map + `on()/off()` 注册回调
- `emitWithAck` 发送命令获取服务端 ACK 回调

**命令 ID 双轨跟踪**
- `_currentCommandId`：客户端生成的临时 ID（`cmd_{timestamp}`），用于发送请求
- `_serverCommandId`：服务端返回的 Prisma cuid，用于匹配 ACK 和结果
- ACK 事件触发 `_serverCommandId` 赋值，后续 `resultDelivered` 按此匹配

### 核心依赖

| 包 | 版本 | 用途 |
|----|------|------|
| flutter_riverpod | ^2.6.1 | 状态管理 |
| go_router | ^14.8.1 | 声明式路由 + 重定向守卫 |
| dio | ^5.7.0 | HTTP 客户端 + 拦截器 |
| socket_io_client | ^3.0.2 | Socket.IO WebSocket 客户端 |
| flutter_secure_storage | ^9.2.4 | 原生平台安全存储 |
| json_annotation | ^4.9.0 | JSON 序列化注解 |

### 遇到的 Bug 与修复

#### Bug 1：flutter_secure_storage Web 端 OperationError

**现象**：Flutter Web 启动后，`flutter_secure_storage` 初始化时抛出 `SubtleCrypto OperationError`，页面白屏。

**原因**：`flutter_secure_storage` 的 Web 实现依赖 Web Crypto API (`SubtleCrypto`)。在某些情况下（非 HTTPS、特定浏览器策略），初始化阶段生成/导入加密密钥会失败。

**修复**：`kIsWeb` 判断平台，Web 端绕过 `flutter_secure_storage`，使用内存 `Map<String, String>` 存储。接受页面刷新后 token 丢失（通过路由守卫重定向到登录页）。

```dart
// auth_repository.dart
class AuthRepository {
  static final Map<String, String> _memStore = {};
  final FlutterSecureStorage? _storage;

  AuthRepository() : _storage = kIsWeb ? null : const FlutterSecureStorage();

  Future<void> _write(String key, String value) async {
    if (kIsWeb) { _memStore[key] = value; }
    else { await _storage!.write(key: key, value: value); }
  }
}
```

#### Bug 2：页面刷新后 401 → 无限请求循环

**现象**：浏览器刷新后，内存 token 丢失，但 URL hash 仍是 `#/devices`，GoRouter 直接渲染设备列表页，Dio 请求返回 401。

**修复**：
1. GoRouter 添加 `redirect` 守卫，未认证时强制跳转 `/login`
2. `AuthInterceptor` 添加 `onAuthExpired` 回调，refresh 失败时触发 `authProvider.logout()`
3. `_AuthRefreshNotifier`（ChangeNotifier）桥接 Riverpod auth state 到 GoRouter 的 `refreshListenable`

```dart
// router.dart
redirect: (context, state) {
  final isAuth = authState.status == AuthStatus.authenticated;
  final isLoginRoute = state.matchedLocation == '/login';
  if (!isAuth && !isLoginRoute) return '/login';
  return null;
},
```

#### Bug 3：socket_io_client Web 端收不到事件

**现象**：Flutter Web 中 Socket.IO 连接成功（`onConnect` 触发），但后续服务端推送的事件（`commandAck`、`resultDelivered`）从未被接收。

**原因**：`setTransports(['websocket'])` 强制使用纯 WebSocket 传输，但 Socket.IO 的 WebSocket 传输在 Dart Web 平台有兼容性问题，导致事件无法正常接收。

**修复**：Web 平台使用默认传输（先 polling 建立连接，再升级到 websocket），仅原生平台使用 websocket-only。

```dart
// ws_service.dart
if (!kIsWeb) {
  builder.setTransports(['websocket']);
}
```

#### Bug 4：commandId 不匹配 — 命令永远卡在 "Sending"（核心问题）

**现象**：命令发送后显示 "Sending command..."，30 秒后超时。服务端日志显示命令已成功转发给桌面端，桌面端也执行并返回了结果。

**调试过程**：
1. 在 WsService 添加 `onAny` 全事件监听 + `debugPrint` 日志
2. 浏览器 Console 显示事件确实被接收：
   ```
   [WS] <<< EVENT: device:command:ack | data: {commandId: cmlm3ambu...}
   [WS] <<< EVENT: device:result:delivered | data: {commandId: cmlm3ambu..., output: hello}
   ```
3. 但 `CommandNotifier` 中的匹配条件 `payload['commandId'] == _currentCommandId` 始终为 `false`

**根因**：
- Mobile 生成 `_currentCommandId = 'cmd_1771059829378'`（客户端时间戳）
- Server `CommandsService.create()` 使用 Prisma 自动生成 cuid：`cmlm3ambu0009gd28nbh734r2`
- ACK 和结果事件中 `commandId` 是 Prisma 的 cuid，不是客户端的 requestId
- 匹配永远失败

**修复**：引入双 ID 跟踪机制——ACK 时保存服务端 commandId，后续用服务端 ID 匹配结果。

```dart
// command_provider.dart
String? _currentCommandId;    // 客户端生成的临时 ID
String? _serverCommandId;     // 服务端 Prisma cuid

// ACK 回调：保存服务端 ID
wsService.on(WsEvents.commandAck, (data) {
  final payload = data as Map<String, dynamic>;
  if (state.state == CommandState.sending) {
    _serverCommandId = payload['commandId'] as String;
    state = state.copyWith(state: CommandState.waiting);
  }
});

// 结果回调：按服务端 ID 匹配
wsService.on(WsEvents.resultDelivered, (data) {
  final result = CommandResult.fromJson(data as Map<String, dynamic>);
  if (result.commandId == _serverCommandId) {
    state = CommandStatus(state: CommandState.completed, result: result);
  }
});
```

#### Bug 5：emitWithAck ACK 回调中 Map 类型不匹配 — 危险命令拦截无法即时显示

**现象**：发送 `rm -rf /`，服务端立即在 ACK 中返回 `{success: false, error: {code: COMMAND_DANGEROUS, ...}}`，浏览器 Console 显示正确，但 UI 仍显示 "Sending command..." 直到 30 秒超时。

**调试过程**：
1. 第一次尝试：在 `sendCommand` 中添加 `onAckError` 回调，用 `response is Map<String, dynamic>` 判断 → 回调不触发
2. 第二次尝试：改为 `response is Map`（放宽类型检查）→ 仍不触发。检查日志发现 `(runtimeType)` 后缀未出现，说明代码未更新
3. 发现 Flutter Web dev server 有编译缓存，`flutter clean` 后重启才能加载新代码

**根因**：
- `emitWithAck` 的 ACK 回调在 socket_io_client Web 实现中可能运行在不同的执行上下文，直接修改 StateNotifier 的 state 不可靠
- 同时 Flutter Web dev server 有强缓存，热重启不够，需要 `flutter clean` + 重启

**修复**：放弃直接回调模式。改用已验证可靠的 `_notifyListeners` 事件分发系统：
- `ws_service.dart`：ACK 返回 `success: false` 时，调用 `_notifyListeners(WsEvents.commandSendError, response)`
- `command_provider.dart`：监听 `commandSendError` 事件，立即转为 error 状态
- `ws_events.dart`：新增客户端专用事件 `commandSendError`

```dart
// ws_service.dart — ACK 回调中分发错误事件
ack: (response) {
  if (response is Map && response['success'] == false) {
    _notifyListeners(WsEvents.commandSendError, response);
  }
});

// command_provider.dart — 监听错误事件
wsService.on(WsEvents.commandSendError, (data) {
  if (state.state == CommandState.sending) {
    final response = data is Map ? data : {};
    final error = response['error'];
    final message = error is Map ? error['message'] as String? : null;
    state = CommandStatus(
      state: CommandState.error,
      errorMessage: message ?? 'Command rejected',
    );
  }
});
```

**经验教训**：Flutter Web 中 socket_io_client 的 `emitWithAck` ACK 回调和 `socket.on()` 事件回调虽然都在 JS 上下文中执行，但经过 `_notifyListeners` 分发的事件更可靠地触发 StateNotifier 重建。开发 Flutter Web 时修改核心逻辑后必须 `flutter clean` + 重启 dev server。

### 调试技巧总结

| 技巧 | 说明 |
|------|------|
| `onAny` 全事件监听 | Socket.IO 客户端添加 `_socket!.onAny((event, data) => debugPrint(...))` 可看到所有收到的事件 |
| `emitWithAck` | 替代普通 `emit`，在 ACK 回调中确认服务端是否收到消息 |
| 浏览器 Console | Flutter Web 的 `debugPrint` 输出到浏览器 Console，可实时看 WS 事件流 |
| 硬刷新 | Flutter Web dev server 不会热更新所有改动，需 `Ctrl+Shift+R` 强制重载 |
| Flutter dev server 重启 | 代码结构性变更后需停止并重启 `flutter run`，否则旧代码仍在运行 |
| `flutter clean` | 修改核心逻辑后仅重启不够，需 `flutter clean && flutter pub get` 清除编译缓存 |

### Phase 3 + Phase 4 验证方法

Phase 4（全链路集成测试）已通过手动验证。以下是完整的验证流程：

```bash
# 0. 前提：Docker 已启动（PostgreSQL + Redis）
docker compose -f docker/docker-compose.yaml up -d

# 1. 启动服务端（NestJS，端口 3008）
pnpm --filter server dev

# 2. 启动桌面端（Electron）
pnpm --filter desktop dev

# 3. 启动移动端（Flutter 自带 Web 开发服务器，非 Docker/pnpm）
#    flutter run 会编译 Dart→JS 并启动一个轻量 HTTP 服务器
#    端口可自选，默认随机分配
D:\flutter\bin\flutter.bat run -d web-server --web-port 8081
# 浏览器打开 http://localhost:8081

# 注意：修改 Flutter 代码后需要：
#   - 简单改动：浏览器 Ctrl+Shift+R 硬刷新
#   - 结构性改动：停止 flutter run → flutter clean → flutter pub get → 重新 flutter run

# 4. 桌面端登录：test@linkingchat.com / Test1234x
# 5. 移动端登录：test@linkingchat.com / Test1234x
```

### 全链路验收检查清单

| # | 验收项 | 操作 | 预期结果 | 状态 |
|---|--------|------|----------|------|
| 1 | 移动端登录 | 输入测试账号 → 点登录 | 跳转到设备列表页 | ✅ |
| 2 | 设备列表加载 | 登录后自动加载 | 显示已注册设备，状态标签正确 | ✅ |
| 3 | 设备在线状态同步 | 桌面端登录后 | 移动端设备列表自动更新为 Online | ✅ |
| 4 | 进入命令页 | 点击在线设备 | 跳转到命令输入页 | ✅ |
| 5 | 发送简单命令 | 输入 `echo hello` → 发送 | 显示 Success，输出 "hello"，耗时 <3s | ✅ (64ms) |
| 6 | 命令结果展示 | 同上 | 显示退出码、耗时、完整输出 | ✅ |
| 7 | 登出 | 点击 Logout | 跳转回登录页 | ✅ |
| 8 | 未登录重定向 | 刷新浏览器 | 自动跳转登录页（非 401 白屏） | ✅ |
| 9 | 危险命令拦截 | 输入 `rm -rf /` → 发送 | 即时显示 "Command blocked by safety filter" | ✅ |
| 10 | 错误命令 | 输入不存在的命令 → 发送 | 显示 Error + 错误信息 + 退出码 | ✅ |

### 建议追加测试（手动）

| # | 测试项 | 命令/操作 | 验证重点 |
|---|--------|----------|----------|
| 1 | 系统信息命令 | `whoami` | 返回桌面端用户名 |
| 2 | 目录列表 | `dir`（Win）/ `ls`（Mac） | 返回桌面端当前目录内容 |
| 3 | 多行输出 | `ipconfig`（Win）/ `ifconfig`（Mac） | 大段文本正确显示 |
| 4 | 错误命令 | `this_command_does_not_exist` | 显示 Error + 错误信息 |
| 5 | 危险命令拦截 | `rm -rf /` | 服务端拦截，返回 COMMAND_DANGEROUS |
| 6 | 桌面离线 | 关闭桌面端 → 发命令 | 超时或错误提示 |
| 7 | 连续命令 | 快速发送多条命令 | 每条独立返回结果 |
