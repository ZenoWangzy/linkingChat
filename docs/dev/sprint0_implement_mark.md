# Sprint 0 实施总结

> **完成日期**：2026-02-14
>
> **提交**：`f54ff5f` feat: implement Sprint 0 infrastructure scaffold

---

## Sprint 0 做了什么

Sprint 0 的目标是**搭建开发基础设施**，让团队任何人 `git clone → pnpm install → docker compose up → pnpm dev:server` 就能跑起来。不写任何业务代码，只搭骨架。

---

## 根目录结构总览

```
LinkChat_new/
├── package.json              ← 根 package，定义全局脚本
├── pnpm-workspace.yaml       ← 声明子项目位置
├── pnpm-lock.yaml            ← 所有子项目共享的依赖锁定文件
├── turbo.json                ← Turborepo 任务编排配置
├── .gitignore                ← Git 忽略规则
├── CLAUDE.md                 ← Claude Code 工作上下文指引
│
├── apps/                     ← 可运行的应用
│   ├── server/               ← Cloud Brain — NestJS 后端
│   ├── desktop/              ← 桌面客户端 — Electron + React
│   └── mobile/               ← 手机客户端 — Flutter
│
├── packages/                 ← 共享库（被 apps/ 引用）
│   ├── shared/               ← 通用枚举 + Zod 验证 schemas
│   ├── ws-protocol/          ← WebSocket 类型定义（事件名 + Payload + 类型化 Socket）
│   ├── api-client/           ← [空占位] 未来放 HTTP 客户端封装
│   └── ui/                   ← [空占位] 未来放共享 UI 组件
│
├── docker/                   ← Docker Compose 开发环境
│   └── docker-compose.yaml   ← 5 个服务容器
│
├── keys/                     ← JWT RS256 密钥对（.gitignore 已排除）
│   ├── jwt-private.pem       ← Access Token 签发私钥
│   ├── jwt-public.pem        ← Access Token 验证公钥
│   ├── jwt-refresh-private.pem
│   └── jwt-refresh-public.pem
│
├── .github/workflows/        ← GitHub Actions CI
│   └── ci.yaml
│
└── docs/                     ← 设计文档 + 实施文档
```

---

## 一、Monorepo 管理层（根目录文件）

### 什么是 Monorepo

传统做法是 server、desktop、mobile 各一个 Git 仓库。Monorepo（单仓库多项目）把它们放在同一个仓库，好处是：

- **共享代码无摩擦** — `packages/shared` 不需要发布 npm 包，子项目直接 `import` 使用
- **一条命令操作全部** — `pnpm build` 按依赖顺序构建所有项目
- **统一版本管理** — 一个 Git 历史、一套 CI、一份代码审查

### `pnpm-workspace.yaml` — 工作区声明

```yaml
packages:
  - "apps/*"       # 可运行的应用（server, desktop, mobile）
  - "packages/*"   # 共享库（被 apps 引用）
```

告诉 pnpm："这些目录下的每个子目录都是独立项目，但共享同一个 node_modules 树"。

### `turbo.json` — 任务编排

```json
{
  "tasks": {
    "build":      { "dependsOn": ["^build"], "outputs": ["dist/**", "out/**"] },
    "dev":        { "cache": false, "persistent": true },
    "test":       { "dependsOn": ["build"] },
    "type-check": { "dependsOn": ["^build"] }
  }
}
```

- `build` 中的 `^build` 表示"先构建我依赖的包，再构建我自己"
  - 例如 server 依赖 shared → 先 build shared → 再 build server
- `dev` 设置 `persistent: true`，因为开发服务器是常驻进程
- `test` 依赖 `build`，确保测试前代码已编译

**注意**：Turbo v2 使用 `tasks` 键，v1 使用 `pipeline`，不可混用。

### `package.json` — 全局脚本

```json
{
  "scripts": {
    "dev:server":  "turbo run dev --filter=@linkingchat/server",   // 只启动 server
    "dev:desktop": "turbo run dev --filter=@linkingchat/desktop",  // 只启动 desktop
    "dev:all":     "turbo run dev --parallel",                     // 全部并行启动
    "build":       "turbo run build",                              // 按依赖序构建所有
    "test":        "turbo run test",                               // 全量测试
    "docker:up":   "docker compose -f docker/docker-compose.yaml up -d",
    "docker:down": "docker compose -f docker/docker-compose.yaml down",
    "db:migrate":  "pnpm --filter @linkingchat/server prisma migrate dev"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "@nestjs/core", "@prisma/client", "@prisma/engines",
      "argon2", "electron", "esbuild", "prisma"
    ]
  }
}
```

`onlyBuiltDependencies` 是 pnpm 10 的 breaking change：默认阻止依赖包的 postinstall 脚本（安全考虑），需要在此白名单中批准有原生编译需求的包。

---

## 二、`apps/server/` — NestJS 后端（Cloud Brain）

### 目录结构

```
server/
├── src/
│   ├── main.ts                 ← 入口：启动 NestJS、配置 Swagger、监听 3008 端口
│   ├── app.module.ts           ← 根模块：注册所有子模块（当前只有 ConfigModule）
│   ├── app.controller.ts       ← 根控制器：GET / 返回 hello，GET /health 返回健康状态
│   ├── app.service.ts          ← 根服务
│   └── app.controller.spec.ts  ← 单元测试（Jest，2 个 test case）
├── prisma/
│   ├── schema.prisma           ← 数据库模型定义
│   └── migrations/             ← 数据库迁移 SQL 文件
├── .env                        ← 环境变量（不入 Git）
├── .env.example                ← .env 模板（入 Git）
├── package.json                ← NestJS 11 + Prisma 6 + Socket.IO 等全部依赖
├── tsconfig.json / tsconfig.build.json / nest-cli.json
```

### Prisma — 数据库 ORM

Prisma 是 TypeScript 的数据库工具链，作用：

1. **schema.prisma** — 用声明式语法定义数据模型（而非手写 SQL）
2. **prisma migrate** — 自动生成并执行 SQL 迁移
3. **prisma generate** — 生成类型安全的 TypeScript 客户端（自动补全、编译时检查）

Sprint 0 创建的 4 张表：

| 表 (@@map) | 模型 | 用途 |
|------------|------|------|
| `users` | User | 用户账号（email, username, argon2 密码哈希, 头像等） |
| `devices` | Device | 设备注册（名称, 平台 darwin/win32/linux, 在线状态, 关联 user） |
| `commands` | Command | 命令记录（类型 shell/file/automation, JSON payload, 结果, 状态, 关联 device） |
| `refresh_tokens` | RefreshToken | JWT 刷新令牌（token, 过期时间, 关联 user） |

### main.ts 做了什么

```typescript
const app = await NestFactory.create(AppModule);
app.setGlobalPrefix('api/v1');          // 所有路由加前缀 /api/v1
// 配置 Swagger（API 文档，访问 /api/docs）
const port = process.env.APP_PORT || 3008;
await app.listen(port);
```

### 环境变量（.env）

```bash
APP_PORT=3008                           # NestJS 端口
DATABASE_URL=postgresql://...localhost:5440/linkingchat   # PostgreSQL
REDIS_URL=redis://localhost:6387        # Redis
JWT_ACCESS_PRIVATE_KEY=<base64>         # RS256 签发密钥
JWT_ACCESS_PUBLIC_KEY=<base64>          # RS256 验证密钥
# ... 其他：MinIO、邮件服务等
```

---

## 三、`apps/desktop/` — Electron 桌面端

### Electron 的三进程模型

```
主进程 (main/index.ts)       ← Node.js 环境，可调用操作系统 API
   ↕ IPC 通信                   创建窗口、读写文件、执行 Shell 命令
预加载 (preload/index.ts)    ← 安全桥接层
   ↕ contextBridge              只暴露允许的 API 给渲染进程
渲染进程 (renderer/)          ← 浏览器环境（和写网页完全一样）
   App.tsx, main.tsx             React UI，用户看到的界面
```

为什么要三个进程？**安全**。渲染进程跑的是网页代码，如果直接给它 Node.js 权限（`nodeIntegration: true`），一个 XSS 漏洞就能执行任意命令。预加载层做了"最小权限"隔离。

### electron-vite

开发时同时管理三个构建目标：
- `main` → Node.js bundle（给主进程）
- `preload` → Node.js bundle（给预加载脚本）
- `renderer` → Vite 开发服务器（给渲染进程，支持 HMR 热更新）

构建产物输出到 `out/` 目录（注意不是 `dist/`，所以 turbo.json 中 outputs 同时包含 `dist/**` 和 `out/**`）。

### 当前骨架状态

`App.tsx` 只显示一行文字 "LinkingChat Desktop — Sprint 0 skeleton ready"。Sprint 1 Phase 2 会加入登录界面、WS 连接、命令执行等功能。

---

## 四、`apps/mobile/` — Flutter 移动端

### 目录结构

```
mobile/
├── lib/main.dart             ← Dart 入口 + MaterialApp + 骨架 UI
├── test/widget_test.dart     ← Widget 测试
├── pubspec.yaml              ← 依赖声明
├── analysis_options.yaml     ← Dart lint 规则
└── android/ ios/ ...         ← 平台目录（需 Flutter SDK 生成）
```

### 预装的依赖（pubspec.yaml）

| 包 | 用途 |
|----|------|
| `dio` | HTTP 客户端（调用 REST API） |
| `socket_io_client` | WebSocket 客户端（接收实时事件） |
| `flutter_riverpod` | 状态管理 |
| `go_router` | 路由导航 |
| `flutter_secure_storage` | 安全存储 JWT token |
| `intl` | 国际化 |

### 当前状态

Dart 源码已就绪，但 Flutter SDK 未安装，缺少平台目录。安装后运行：

```bash
cd apps/mobile
flutter create . --org com.linkingchat --project-name linkingchat_mobile
flutter pub get && flutter run
```

---

## 五、`packages/shared/` — 共享枚举和验证

### 为什么需要共享包

Server 定义了 `CommandStatus.PENDING`，Desktop 和 Mobile 也要用这个常量。如果各自定义，很容易出现拼写不一致。共享包确保**三端用同一份类型定义**。

### 内容

```typescript
// 枚举 — 三端通用
export enum DevicePlatform { DARWIN = 'darwin', WIN32 = 'win32', LINUX = 'linux' }
export enum CommandStatus { PENDING, RUNNING, COMPLETED, FAILED, CANCELLED }
export enum DeviceStatus { ONLINE, OFFLINE }

// Zod schemas — 请求体验证（Server 用来校验，Client 用来构造）
export const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(8),
  displayName: z.string().min(1).max(50),
});
```

**Zod** 是运行时类型验证库。TypeScript 的类型只在编译时检查，运行时就消失了。Zod schema 可以在运行时验证 HTTP 请求体是否合法，同时自动推导 TypeScript 类型。

---

## 六、`packages/ws-protocol/` — WebSocket 协议类型

### 为什么需要这个包

WebSocket 不像 REST 有 Swagger 文档，事件名和 Payload 全靠约定。这个包把约定变成**代码级契约**：

```typescript
// 事件名常量 — 不再手写字符串
DEVICE_EVENTS.COMMAND_SEND     = 'device:command:send'
DEVICE_EVENTS.COMMAND_EXECUTE  = 'device:command:execute'

// 类型化 Socket — 编译时检查事件名和 Payload 类型
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>
```

Server 发事件、Desktop 收事件用的是**同一套接口定义**。事件名拼错或 Payload 字段不对，TypeScript 编译就会报错。

### 信封格式（Envelope）

所有 WS 消息统一包装：

```typescript
interface WsEnvelope<T> {
  requestId: string;    // 请求追踪 ID
  timestamp: string;    // ISO 8601 时间戳
  data: T;              // 实际载荷
}

interface WsResponse<T> {
  requestId?: string;
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  timestamp: string;
}
```

---

## 七、`docker/` — 开发环境容器

### 5 个服务（端口全部 +8 避免冲突）

| 服务 | 外部端口 | 内部端口 | 用途 |
|------|---------|---------|------|
| **PostgreSQL 16** | 5440 | 5432 | 主数据库，存储用户/设备/命令 |
| **Redis 7** | 6387 | 6379 | Socket.IO 消息分发（多实例时共享状态）+ 缓存 |
| **MinIO** | 9008 / 9009 | 9000 / 9001 | S3 兼容的对象存储（头像、文件传输） |
| **Adminer** | 8088 | 8080 | 数据库管理 Web UI（浏览器访问） |
| **MailDev** | 1088 / 1033 | 1080 / 1025 | 假邮件服务（捕获注册验证邮件，不真正发送） |

端口 +8 的原因：同一台机器上可能有其他项目占用默认端口（5432、6379 等），全部偏移 8 避免冲突。

`docker-compose.yaml` 中设置了 `name: linkingchat`，在 Docker Desktop 中会显示为独立分组。

---

## 八、`keys/` — JWT RS256 密钥对

### RS256 vs HS256

| | HS256（对称） | RS256（非对称） |
|---|---|---|
| 密钥 | 一个 secret | 私钥 + 公钥 |
| 签发 | 用 secret | 用私钥 |
| 验证 | 用 secret | 用公钥 |
| 安全性 | 所有需要验证的服务都要知道 secret | 只有签发方知道私钥，验证方只需公钥 |

LinkingChat 使用 RS256，好处是：未来微服务架构下，其他服务只需公钥就能验证 token，无需知道签发私钥。

两对密钥：
- **Access Token**（jwt-private/public.pem）— 短期有效（15 分钟），用于 API 认证
- **Refresh Token**（jwt-refresh-private/public.pem）— 长期有效（30 天），用于无感续签

密钥以 base64 编码存储在 `.env` 中，方便环境变量传递。

---

## 九、`.github/workflows/ci.yaml` — CI 自动化

每次 push 或 PR 到 main/develop 自动运行：

1. 启动 PostgreSQL + Redis 服务容器
2. `pnpm install --frozen-lockfile`
3. 构建共享包 → 类型检查 → 运行测试
4. 单独构建 Electron desktop（验证编译通过）

---

## 十、验收结果

| 验收项 | 命令 | 结果 |
|--------|------|------|
| 依赖安装 | `pnpm install` | 0 errors, 0 warnings |
| Docker 环境 | `pnpm docker:up` | 5 services running |
| 数据库迁移 | `pnpm db:migrate` | 4 tables created |
| 后端启动 | `pnpm dev:server` | http://localhost:3008/api/v1 ✓ |
| 桌面端启动 | `pnpm dev:desktop` | Electron 窗口打开 ✓ |
| 全量构建 | `pnpm build` | 4 packages compiled ✓ |
| 单元测试 | `pnpm test` | 2 tests passed ✓ |
| 移动端 | `flutter run` | ⚠️ 需安装 Flutter SDK |

### 实施中遇到的问题

| 问题 | 解决方案 |
|------|---------|
| pnpm 10 阻止 postinstall 脚本 | 根 package.json 添加 `pnpm.onlyBuiltDependencies` 白名单 |
| Turbo v2 不认 `pipeline` | 改用 `tasks` 键 |
| Electron 找不到入口 `.ts` 文件 | `main` 字段改为 `./out/main/index.js`（编译产物） |
| Docker 容器分组在 "docker" 下 | 添加 `name: linkingchat` 到 docker-compose.yaml |
| Electron 二进制未下载 | 手动运行 `node node_modules/.pnpm/electron@35.x/node_modules/electron/install.js` |
