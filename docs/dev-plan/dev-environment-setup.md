# 开发环境搭建指南

---

## 一、前置要求

| 工具 | 版本 | 说明 |
|------|------|------|
| **Node.js** | >= 22.0.0 | 服务端 + 桌面端运行时 |
| **pnpm** | >= 9.0.0 | Monorepo 包管理器 |
| **Docker & Docker Compose** | 最新稳定版 | 数据库 + Redis + MinIO |
| **Flutter** | >= 3.22 | 移动端开发 |
| **Git** | >= 2.40 | 版本控制 |
| **VS Code** 或 **WebStorm** | 最新 | 推荐 IDE |

### 可选

| 工具 | 用途 |
|------|------|
| **OpenClaw** | 桌面端设备执行能力 (`npm i -g openclaw@latest`) |
| **Xcode** (macOS) | iOS 模拟器 |
| **Android Studio** | Android 模拟器 |

---

## 二、初始化步骤

### Step 1: 克隆仓库

```bash
git clone https://github.com/ZenoWangzy/linkingChat.git
cd linkingChat
```

### Step 2: 创建 Monorepo 结构

```bash
# 创建目录
mkdir -p packages/{server,desktop,mobile,shared}
mkdir -p docker

# 初始化 pnpm workspace
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - "packages/*"
EOF

# 安装依赖
pnpm install
```

### Step 3: 初始化 Server (基于 brocoders 脚手架)

```bash
# 方式一：直接克隆脚手架到 packages/server
cd packages
git clone --depth 1 https://github.com/brocoders/nestjs-boilerplate.git server
cd server
rm -rf .git  # 移除脚手架的 git 历史

# 安装依赖
pnpm install

# 复制环境变量模板
cp env-example-relational .env

# 修改 package.json 的 name
# "name": "@linkingchat/server"
```

### Step 4: 初始化 Shared 类型包

```bash
cd packages/shared
pnpm init

# 安装 TypeScript
pnpm add -D typescript

# 创建 tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
EOF
```

### Step 5: 初始化 Flutter 移动端

```bash
cd packages
flutter create --org com.linkingchat --project-name linkingchat_mobile mobile
cd mobile

# 添加核心依赖
flutter pub add dio socket_io_client flutter_riverpod go_router flutter_secure_storage intl
```

### Step 6: 初始化 Electron 桌面端

```bash
cd packages/desktop
pnpm init

# 推荐使用 electron-vite 或 electron-forge
pnpm add electron electron-builder
pnpm add -D typescript vite @vitejs/plugin-react  # 如用 React
```

---

## 三、Docker 开发环境

### docker/docker-compose.yaml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: linkingchat-postgres
    environment:
      POSTGRES_USER: linkingchat
      POSTGRES_PASSWORD: linkingchat_dev
      POSTGRES_DB: linkingchat
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U linkingchat"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: linkingchat-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    container_name: linkingchat-minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: linkingchat
      MINIO_ROOT_PASSWORD: linkingchat_dev
    ports:
      - "9000:9000"    # S3 API
      - "9001:9001"    # Web Console
    volumes:
      - minio_data:/data

  adminer:
    image: adminer:latest
    container_name: linkingchat-adminer
    ports:
      - "8080:8080"

  maildev:
    image: maildev/maildev
    container_name: linkingchat-maildev
    ports:
      - "1080:1080"    # Web UI
      - "1025:1025"    # SMTP

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

### 启动开发环境

```bash
# 启动所有服务
docker compose -f docker/docker-compose.yaml up -d

# 验证服务状态
docker compose -f docker/docker-compose.yaml ps

# 访问管理界面
# PostgreSQL Adminer:  http://localhost:8080
# MinIO Console:       http://localhost:9001
# MailDev:             http://localhost:1080
```

---

## 四、Server 环境变量 (.env)

```bash
# App
NODE_ENV=development
APP_PORT=3000
APP_NAME="LinkingChat"
API_PREFIX=api
APP_FALLBACK_LANGUAGE=en
APP_HEADER_LANGUAGE=x-custom-lang
FRONTEND_DOMAIN=http://localhost:5173
BACKEND_DOMAIN=http://localhost:3000

# Database (PostgreSQL)
DATABASE_TYPE=postgres
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=linkingchat
DATABASE_PASSWORD=linkingchat_dev
DATABASE_NAME=linkingchat
DATABASE_SYNCHRONIZE=false
DATABASE_MAX_CONNECTIONS=100
DATABASE_SSL_ENABLED=false

# Redis (Socket.IO adapter + 缓存)
REDIS_URL=redis://localhost:6379

# Auth (JWT)
AUTH_JWT_SECRET=your-jwt-secret-change-in-production
AUTH_JWT_TOKEN_EXPIRES_IN=15m
AUTH_REFRESH_SECRET=your-refresh-secret-change-in-production
AUTH_REFRESH_TOKEN_EXPIRES_IN=3650d

# File Storage (MinIO as S3-compatible)
FILE_DRIVER=s3
ACCESS_KEY_ID=linkingchat
SECRET_ACCESS_KEY=linkingchat_dev
AWS_S3_REGION=us-east-1
AWS_DEFAULT_S3_BUCKET=linkingchat-files
AWS_S3_ENDPOINT=http://localhost:9000

# Mail (MailDev for development)
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_USER=
MAIL_PASSWORD=
MAIL_IGNORE_TLS=true
MAIL_SECURE=false
MAIL_REQUIRE_TLS=false
MAIL_DEFAULT_EMAIL=noreply@linkingchat.com
MAIL_DEFAULT_NAME=LinkingChat
```

---

## 五、日常开发命令

### Server

```bash
# 启动开发服务器 (热重载)
pnpm --filter @linkingchat/server start:dev

# 生成数据库 migration
pnpm --filter @linkingchat/server migration:generate -- src/database/migrations/MigrationName

# 执行 migration
pnpm --filter @linkingchat/server migration:run

# 执行种子数据
pnpm --filter @linkingchat/server seed:run:relational

# 生成新模块 (Hygen)
pnpm --filter @linkingchat/server generate:resource:relational -- --name friends

# 运行测试
pnpm --filter @linkingchat/server test
pnpm --filter @linkingchat/server test:e2e

# Swagger 文档
# 启动后访问 http://localhost:3000/docs
```

### Desktop

```bash
# 启动 Electron 开发模式
pnpm --filter @linkingchat/desktop dev

# 构建
pnpm --filter @linkingchat/desktop build
```

### Mobile

```bash
# 启动 Flutter
cd packages/mobile
flutter run

# iOS 模拟器
flutter run -d ios

# Android 模拟器
flutter run -d android

# 代码生成 (如用 riverpod_generator / freezed)
flutter pub run build_runner build
```

### Monorepo

```bash
# 同时启动 server + desktop
pnpm run dev:all

# 构建 shared 类型包
pnpm --filter @linkingchat/shared build

# 全量 lint
pnpm -r lint

# Docker 环境管理
pnpm run docker:up
pnpm run docker:down
```

---

## 六、IDE 推荐配置

### VS Code 推荐扩展

```json
// .vscode/extensions.json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "Dart-Code.dart-code",
    "Dart-Code.flutter",
    "ms-azuretools.vscode-docker",
    "Prisma.prisma",
    "ms-vscode.vscode-typescript-next"
  ]
}
```

### VS Code 工作区设置

```json
// .vscode/settings.json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.preferences.importModuleSpecifier": "relative",
  "eslint.workingDirectories": ["packages/server", "packages/desktop", "packages/shared"]
}
```

---

## 七、开发端口分配

| 服务 | 端口 | 说明 |
|------|------|------|
| **NestJS Server** | 3000 | REST API + WebSocket |
| **PostgreSQL** | 5432 | 数据库 |
| **Redis** | 6379 | Socket.IO adapter + 缓存 |
| **MinIO S3** | 9000 | 文件存储 API |
| **MinIO Console** | 9001 | 文件存储管理界面 |
| **Adminer** | 8080 | 数据库管理界面 |
| **MailDev Web** | 1080 | 邮件测试界面 |
| **MailDev SMTP** | 1025 | 邮件测试 SMTP |
| **Electron Dev** | 5173 | 桌面端渲染进程 (Vite) |
| **Flutter Dev** | - | 模拟器 / 真机 |
