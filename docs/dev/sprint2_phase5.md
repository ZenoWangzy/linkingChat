# Sprint 2 — Phase 5：Bot Model + CRUD API

> **负责人**：线 B 开发者
>
> **前置条件**：Phase 0 Schema 扩展已完成（Bot model 已在 Prisma schema 中定义，migration 已执行）
>
> **产出**：BotsModule + BotsService + Bot CRUD REST API + agentConfig Zod 验证 + 单元测试
>
> **参考**：[sprint2_implement.md](./sprint2_implement.md) | [database-schema.md](../dev-plan/database-schema.md) | [reference-architecture-guide.md](../dev-plan/reference-architecture-guide.md)

---

## 设计理念：Bot-as-User

Bot 在系统中作为特殊 User 存在（参考 Tailchat 的设计模式）。每个 Bot 对应一条 User 记录，使得 Bot 可以：

- 作为消息的 author 出现在聊天流中
- 作为 ConverseMember 加入会话
- 与真实用户共用统一的头像、昵称显示逻辑
- 被好友系统、会话系统无缝识别

Bot User 使用不可登录的邮箱（`bot_*@linkingchat.bot`）和随机密码，确保不会被用作真实登录凭证。

---

## 任务清单

| # | 任务 | 产出文件 | 依赖 |
|---|------|---------|------|
| 5.1 | 验证 Bot model 已在 Prisma schema 中 | `apps/server/prisma/schema.prisma` | Phase 0 |
| 5.2 | 创建 BotsModule + BotsService | `apps/server/src/bots/` | 5.1 |
| 5.3 | 实现 Bot CRUD REST API | `apps/server/src/bots/bots.controller.ts` | 5.2 |
| 5.4 | Bot-User 关联逻辑 | `apps/server/src/bots/bots.service.ts` | 5.2 |
| 5.5 | agentConfig JSON schema 验证 | `packages/shared/src/schemas/bot.schema.ts` | 无 |
| 5.6 | 单元测试 | `apps/server/src/bots/bots.service.spec.ts` | 5.2-5.5 |

---

## 5.1 验证 Bot Model（Phase 0 已创建）

Phase 0 已在 Prisma schema 中新增了 Bot model、BotType enum，以及 User model 上的关联字段。本步骤仅需验证 migration 成功、PrismaClient 类型可用。

### 预期 Schema

```prisma
model Bot {
  id          String   @id @default(cuid())
  name        String
  description String?
  avatarUrl   String?
  type        BotType  @default(REMOTE_EXEC)
  agentConfig Json     // { systemPrompt, llmProvider, tools[], ... }
  ownerId     String
  isPinned    Boolean  @default(true)
  isDeletable Boolean  @default(true)   // Supervisor/Coding Bot 为 false
  userId      String   @unique          // 关联的 User 记录
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  owner User @relation("BotOwner", fields: [ownerId], references: [id])
  user  User @relation("BotUser", fields: [userId], references: [id])

  @@index([ownerId])
  @@map("bots")
}

enum BotType {
  REMOTE_EXEC    // 远程执行（MVP 唯一类型）
  SOCIAL_MEDIA   // 社媒运营 (v1.x)
  CUSTOM         // 自定义 (v2.0)
}
```

### User model 需新增的关联字段

```prisma
model User {
  // ... 既有字段 ...
  deletedAt   DateTime?              // 软删除支持（Phase 0 新增）

  ownedBots   Bot[]  @relation("BotOwner")
  botProfile  Bot?   @relation("BotUser")

  // ... 既有关联 ...
}
```

### 验证命令

```bash
# 确认 migration 已执行
pnpm --filter server prisma migrate status

# 确认 PrismaClient 类型可用
pnpm --filter server prisma generate

# 快速验证：能否创建 Bot 记录
pnpm --filter server ts-node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.bot.findMany().then(console.log).catch(console.error).finally(() => p.\$disconnect());
"
```

### 验收标准

- `bots` 表存在于数据库中
- `BotType` enum 包含 `REMOTE_EXEC`、`SOCIAL_MEDIA`、`CUSTOM`
- `Bot` 与 `User` 的双向关联正确建立（`@@index([ownerId])` + `userId @unique`）
- `prisma generate` 后 TypeScript 类型提示正常

---

## 5.2 创建 BotsModule + BotsService

### 目录结构

```
apps/server/src/bots/
  ├── bots.module.ts
  ├── bots.controller.ts
  ├── bots.service.ts
  ├── bots.service.spec.ts
  └── dto/
      ├── create-bot.dto.ts
      ├── update-bot.dto.ts
      └── bot-response.dto.ts
```

### Module

```typescript
// apps/server/src/bots/bots.module.ts

import { Module } from '@nestjs/common';
import { BotsController } from './bots.controller';
import { BotsService } from './bots.service';

@Module({
  controllers: [BotsController],
  providers: [BotsService],
  exports: [BotsService],
})
export class BotsModule {}
```

**要点**：
- `exports: [BotsService]` — Phase 6 的 AuthModule 需要调用 BotsService 来自动创建默认 Bot
- PrismaModule 是 `@Global()`，无需在 imports 中声明

### App Module 注册

```typescript
// apps/server/src/app.module.ts — 新增 BotsModule

import { BotsModule } from './bots/bots.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    DevicesModule,
    GatewayModule,
    BotsModule,       // ← 新增
    // ... 其他模块
  ],
})
export class AppModule {}
```

---

## 5.3 实现 Bot CRUD REST API

### REST API 端点

| Method | Path | 说明 | 认证 |
|--------|------|------|------|
| POST | `/api/v1/bots` | 创建 Bot（自动创建关联 User） | JWT |
| GET | `/api/v1/bots` | 当前用户的 Bot 列表 | JWT |
| GET | `/api/v1/bots/:id` | Bot 详情 | JWT |
| PATCH | `/api/v1/bots/:id` | 更新 Bot 配置 | JWT |
| DELETE | `/api/v1/bots/:id` | 删除 Bot（需 isDeletable=true） | JWT |

### Controller

```typescript
// apps/server/src/bots/bots.controller.ts

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BotsService } from './bots.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { UpdateBotDto } from './dto/update-bot.dto';

@Controller('api/v1/bots')
@UseGuards(JwtAuthGuard)
export class BotsController {
  constructor(private readonly botsService: BotsService) {}

  /** POST /api/v1/bots — 创建 Bot（自动创建关联 User） */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateBotDto,
  ) {
    return this.botsService.create(userId, dto);
  }

  /** GET /api/v1/bots — 当前用户的 Bot 列表 */
  @Get()
  findAll(@CurrentUser('userId') userId: string) {
    return this.botsService.findByOwner(userId);
  }

  /** GET /api/v1/bots/:id — Bot 详情 */
  @Get(':id')
  findOne(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.botsService.findOne(id, userId);
  }

  /** PATCH /api/v1/bots/:id — 更新 Bot 配置 */
  @Patch(':id')
  update(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBotDto,
  ) {
    return this.botsService.update(id, userId, dto);
  }

  /** DELETE /api/v1/bots/:id — 删除 Bot（需 isDeletable=true） */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.botsService.delete(id, userId);
  }
}
```

### DTOs

```typescript
// apps/server/src/bots/dto/create-bot.dto.ts

import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsObject,
  MinLength,
  MaxLength,
  IsUrl,
} from 'class-validator';

export class CreateBotDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @IsOptional()
  @IsEnum(['REMOTE_EXEC', 'SOCIAL_MEDIA', 'CUSTOM'])
  type?: 'REMOTE_EXEC' | 'SOCIAL_MEDIA' | 'CUSTOM';

  @IsObject()
  agentConfig: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}
```

```typescript
// apps/server/src/bots/dto/update-bot.dto.ts

import { PartialType } from '@nestjs/mapped-types';
import { CreateBotDto } from './create-bot.dto';

export class UpdateBotDto extends PartialType(CreateBotDto) {}
```

```typescript
// apps/server/src/bots/dto/bot-response.dto.ts

/**
 * Bot API 响应格式（用于文档和类型参考，非运行时验证）
 */
export interface BotResponseDto {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  type: 'REMOTE_EXEC' | 'SOCIAL_MEDIA' | 'CUSTOM';
  agentConfig: Record<string, unknown>;
  isPinned: boolean;
  isDeletable: boolean;
  ownerId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}
```

**响应格式示例**：

```json
{
  "id": "clxyz...",
  "name": "Coding Bot",
  "description": "远程代码执行助手",
  "avatarUrl": null,
  "type": "REMOTE_EXEC",
  "agentConfig": {
    "systemPrompt": "You are Coding Bot...",
    "llmProvider": "deepseek",
    "tools": ["system.run", "system.which"]
  },
  "isPinned": true,
  "isDeletable": true,
  "ownerId": "clxyz_owner...",
  "userId": "clxyz_botuser...",
  "createdAt": "2026-02-14T10:00:00.000Z",
  "updatedAt": "2026-02-14T10:00:00.000Z"
}
```

---

## 5.4 Bot-User 关联逻辑

核心逻辑：创建 Bot 时在同一个数据库事务中创建对应的 User 记录。Bot User 使用不可登录的凭证。

### Service 完整实现

```typescript
// apps/server/src/bots/bots.service.ts

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { UpdateBotDto } from './dto/update-bot.dto';
import { randomBytes } from 'crypto';
import { agentConfigSchema } from '@linkingchat/shared/schemas/bot.schema';

@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建 Bot + 关联 User（事务）
   *
   * 流程：
   * 1. 验证 agentConfig 格式（Zod）
   * 2. 创建 Bot User 记录（不可登录的邮箱 + 随机密码）
   * 3. 创建 Bot 记录，关联到 Bot User 和 Owner
   */
  async create(ownerId: string, dto: CreateBotDto) {
    // 1. 验证 agentConfig
    const configResult = agentConfigSchema.safeParse(dto.agentConfig);
    if (!configResult.success) {
      throw new BadRequestException({
        message: 'Invalid agentConfig',
        errors: configResult.error.flatten().fieldErrors,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // 2. 创建 Bot User 记录
      const botUser = await tx.user.create({
        data: {
          email: `bot_${Date.now()}@linkingchat.bot`,
          username: `bot_${dto.name.toLowerCase().replace(/\s/g, '_')}_${Date.now()}`,
          password: randomBytes(32).toString('hex'),
          displayName: dto.name,
          avatarUrl: dto.avatarUrl,
        },
      });

      // 3. 创建 Bot 记录
      const bot = await tx.bot.create({
        data: {
          name: dto.name,
          description: dto.description,
          avatarUrl: dto.avatarUrl,
          type: dto.type || 'REMOTE_EXEC',
          agentConfig: configResult.data,
          ownerId,
          userId: botUser.id,
          isPinned: dto.isPinned ?? true,
          isDeletable: true,
        },
      });

      this.logger.log(
        `Bot created: ${bot.id} (${bot.name}) for owner ${ownerId}, botUser=${botUser.id}`,
      );

      return bot;
    });
  }

  /**
   * 获取用户的所有 Bot
   *
   * 排序：isPinned=true 的置顶，然后按创建时间升序
   */
  async findByOwner(ownerId: string) {
    return this.prisma.bot.findMany({
      where: { ownerId },
      orderBy: [
        { isPinned: 'desc' },
        { createdAt: 'asc' },
      ],
    });
  }

  /**
   * 获取单个 Bot 详情
   *
   * 仅 owner 可查看
   */
  async findOne(id: string, ownerId: string) {
    const bot = await this.prisma.bot.findFirst({
      where: { id, ownerId },
    });

    if (!bot) {
      throw new NotFoundException('Bot not found');
    }

    return bot;
  }

  /**
   * 更新 Bot 配置
   *
   * 仅 owner 可更新。如果更新 agentConfig，需重新验证。
   * 同步更新 Bot User 的 displayName 和 avatarUrl。
   */
  async update(id: string, ownerId: string, dto: UpdateBotDto) {
    const bot = await this.prisma.bot.findFirst({
      where: { id, ownerId },
    });

    if (!bot) {
      throw new NotFoundException('Bot not found');
    }

    // 验证 agentConfig（如果有更新）
    if (dto.agentConfig) {
      const configResult = agentConfigSchema.safeParse(dto.agentConfig);
      if (!configResult.success) {
        throw new BadRequestException({
          message: 'Invalid agentConfig',
          errors: configResult.error.flatten().fieldErrors,
        });
      }
      dto.agentConfig = configResult.data;
    }

    return this.prisma.$transaction(async (tx) => {
      // 更新 Bot 记录
      const updatedBot = await tx.bot.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.agentConfig !== undefined && { agentConfig: dto.agentConfig }),
          ...(dto.isPinned !== undefined && { isPinned: dto.isPinned }),
        },
      });

      // 同步更新 Bot User 的 displayName 和 avatarUrl
      if (dto.name !== undefined || dto.avatarUrl !== undefined) {
        await tx.user.update({
          where: { id: bot.userId },
          data: {
            ...(dto.name !== undefined && { displayName: dto.name }),
            ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
          },
        });
      }

      return updatedBot;
    });
  }

  /**
   * 删除 Bot（软删除）
   *
   * 前置检查：
   * - 仅 owner 可删除
   * - isDeletable=false 的 Bot（如 Supervisor、Coding Bot）不可删除，返回 403
   *
   * 删除策略：
   * - 硬删除 Bot 记录
   * - 软删除关联 User 记录（设置 deletedAt），保留历史消息
   */
  async delete(id: string, ownerId: string) {
    const bot = await this.prisma.bot.findFirst({
      where: { id, ownerId },
    });

    if (!bot) {
      throw new NotFoundException('Bot not found');
    }

    if (!bot.isDeletable) {
      throw new ForbiddenException(
        'This bot cannot be deleted. System bots (Supervisor, Coding Bot) are protected.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.bot.delete({ where: { id } }),
      this.prisma.user.update({
        where: { id: bot.userId },
        data: { deletedAt: new Date() },
      }),
    ]);

    this.logger.log(
      `Bot deleted: ${id} (${bot.name}) by owner ${ownerId}, botUser=${bot.userId} soft-deleted`,
    );
  }

  /**
   * 内部方法：创建系统 Bot（由 Phase 6 AuthService 调用）
   *
   * 与 create() 的区别：
   * - isDeletable 由调用方指定（系统 Bot 为 false）
   * - 不对外暴露为 REST API
   */
  async createSystemBot(
    ownerId: string,
    config: {
      name: string;
      description: string;
      type: 'REMOTE_EXEC' | 'SOCIAL_MEDIA' | 'CUSTOM';
      agentConfig: Record<string, unknown>;
      isPinned: boolean;
      isDeletable: boolean;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const botUser = await tx.user.create({
        data: {
          email: `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@linkingchat.bot`,
          username: `bot_${config.name.toLowerCase().replace(/\s/g, '_')}_${Date.now()}`,
          password: randomBytes(32).toString('hex'),
          displayName: config.name,
        },
      });

      const bot = await tx.bot.create({
        data: {
          name: config.name,
          description: config.description,
          type: config.type,
          agentConfig: config.agentConfig,
          ownerId,
          userId: botUser.id,
          isPinned: config.isPinned,
          isDeletable: config.isDeletable,
        },
      });

      return { bot, botUser };
    });
  }
}
```

### Bot-User 关联要点

| 属性 | Bot User 值 | 说明 |
|------|------------|------|
| `email` | `bot_{timestamp}@linkingchat.bot` | `.bot` 域名不可登录 |
| `username` | `bot_{name}_{timestamp}` | 带 `bot_` 前缀，全局唯一 |
| `password` | `randomBytes(32).toString('hex')` | 64 字符随机哈希，不可猜测 |
| `displayName` | Bot 的 name | 在聊天中显示为 Bot 名称 |
| `avatarUrl` | Bot 的 avatarUrl | 与 Bot 保持同步 |
| `deletedAt` | null（正常）/ Date（删除时） | 软删除后保留历史消息引用 |

**为什么不直接给 User 加 isBot 字段？**

当前方案通过 `Bot.userId` 反查判断一个 User 是否为 Bot，避免在高频查询的 User 表上增加列。Phase 6+ 如果需要高频判断，可以考虑添加 `User.isBot` 字段作为优化。

---

## 5.5 agentConfig JSON Schema 验证

使用 Zod 在 `packages/shared` 中定义 agentConfig 的验证 schema，供服务端 BotsService 调用。

### Schema 定义

```typescript
// packages/shared/src/schemas/bot.schema.ts

import { z } from 'zod';

// ── agentConfig 结构验证 ────────────────────────────

export const agentConfigSchema = z.object({
  /** Agent system prompt — 定义 Bot 行为和人格 */
  systemPrompt: z.string().min(1).max(10000),

  /** LLM 提供商 — 决定调用哪个 AI 模型 */
  llmProvider: z.enum(['deepseek', 'kimi']).default('deepseek'),

  /** 具体模型名 — 可选，未指定时使用 provider 默认模型 */
  llmModel: z.string().optional(),

  /** 可用工具列表 — 如 ["system.run", "camera.snap"] */
  tools: z.array(z.string()).default([]),

  /** 最大输出 token 数 */
  maxTokens: z.number().int().min(1).max(100000).optional(),

  /** 生成温度 — 0 = 确定性，2 = 最大随机性 */
  temperature: z.number().min(0).max(2).optional(),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

// ── 创建 Bot 请求体验证 ────────────────────────────

export const createBotSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
  type: z.enum(['REMOTE_EXEC', 'SOCIAL_MEDIA', 'CUSTOM']).default('REMOTE_EXEC'),
  agentConfig: agentConfigSchema,
  isPinned: z.boolean().optional(),
});

export type CreateBotInput = z.infer<typeof createBotSchema>;

// ── 更新 Bot 请求体验证 ────────────────────────────

export const updateBotSchema = createBotSchema.partial();

export type UpdateBotInput = z.infer<typeof updateBotSchema>;
```

### 导出注册

```typescript
// packages/shared/src/schemas/index.ts — 追加导出

export * from './bot.schema';
```

### agentConfig 验证规则详解

| 字段 | 类型 | 必填 | 约束 | 说明 |
|------|------|------|------|------|
| `systemPrompt` | string | 是 | 1-10000 字符 | Bot 的角色设定和行为指令 |
| `llmProvider` | enum | 否 | `'deepseek'` \| `'kimi'` | 默认 `'deepseek'`（便宜快速） |
| `llmModel` | string | 否 | - | 如 `'deepseek-chat'`、`'kimi-2.5'` |
| `tools` | string[] | 否 | 默认 `[]` | OpenClaw 支持的工具标识符 |
| `maxTokens` | number | 否 | 1-100000，整数 | 控制输出长度 |
| `temperature` | number | 否 | 0-2 | 控制生成随机性 |

### 验证失败响应示例

```json
// POST /api/v1/bots — agentConfig 缺少 systemPrompt
// 状态码: 400

{
  "statusCode": 400,
  "message": "Invalid agentConfig",
  "errors": {
    "systemPrompt": ["Required"]
  }
}
```

```json
// POST /api/v1/bots — temperature 超出范围
// 状态码: 400

{
  "statusCode": 400,
  "message": "Invalid agentConfig",
  "errors": {
    "temperature": ["Number must be less than or equal to 2"]
  }
}
```

---

## 5.6 单元测试

### 测试文件

```typescript
// apps/server/src/bots/bots.service.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { BotsService } from './bots.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';

// ── Mock PrismaService ────────────────────────────

const mockPrismaService = () => ({
  bot: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: {
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
});

// ── 测试数据 ────────────────────────────

const mockOwnerId = 'owner-001';

const validAgentConfig = {
  systemPrompt: 'You are a helpful assistant.',
  llmProvider: 'deepseek',
  tools: ['system.run'],
};

const mockCreateDto = {
  name: 'Test Bot',
  description: 'A test bot',
  type: 'REMOTE_EXEC' as const,
  agentConfig: validAgentConfig,
};

const mockBotUser = {
  id: 'bot-user-001',
  email: 'bot_123@linkingchat.bot',
  username: 'bot_test_bot_123',
  displayName: 'Test Bot',
  avatarUrl: null,
};

const mockBot = {
  id: 'bot-001',
  name: 'Test Bot',
  description: 'A test bot',
  avatarUrl: null,
  type: 'REMOTE_EXEC',
  agentConfig: validAgentConfig,
  ownerId: mockOwnerId,
  userId: 'bot-user-001',
  isPinned: true,
  isDeletable: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSystemBot = {
  ...mockBot,
  id: 'bot-system-001',
  name: 'Supervisor',
  isDeletable: false,
};

// ── 测试套件 ────────────────────────────

describe('BotsService', () => {
  let service: BotsService;
  let prisma: ReturnType<typeof mockPrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotsService,
        { provide: PrismaService, useFactory: mockPrismaService },
      ],
    }).compile();

    service = module.get<BotsService>(BotsService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── create() ────────────────────────────

  describe('create', () => {
    it('应在事务中创建 Bot + Bot User', async () => {
      prisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          user: { create: jest.fn().mockResolvedValue(mockBotUser) },
          bot: { create: jest.fn().mockResolvedValue(mockBot) },
        };
        return cb(tx);
      });

      const result = await service.create(mockOwnerId, mockCreateDto);

      expect(result).toEqual(mockBot);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('Bot User 邮箱应以 @linkingchat.bot 结尾', async () => {
      let capturedUserData: any;

      prisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          user: {
            create: jest.fn().mockImplementation(({ data }) => {
              capturedUserData = data;
              return Promise.resolve({ ...mockBotUser, ...data });
            }),
          },
          bot: { create: jest.fn().mockResolvedValue(mockBot) },
        };
        return cb(tx);
      });

      await service.create(mockOwnerId, mockCreateDto);

      expect(capturedUserData.email).toMatch(/@linkingchat\.bot$/);
    });

    it('Bot User username 应以 bot_ 前缀开头', async () => {
      let capturedUserData: any;

      prisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          user: {
            create: jest.fn().mockImplementation(({ data }) => {
              capturedUserData = data;
              return Promise.resolve({ ...mockBotUser, ...data });
            }),
          },
          bot: { create: jest.fn().mockResolvedValue(mockBot) },
        };
        return cb(tx);
      });

      await service.create(mockOwnerId, mockCreateDto);

      expect(capturedUserData.username).toMatch(/^bot_/);
    });

    it('Bot User 密码应为 64 字符随机哈希', async () => {
      let capturedUserData: any;

      prisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          user: {
            create: jest.fn().mockImplementation(({ data }) => {
              capturedUserData = data;
              return Promise.resolve({ ...mockBotUser, ...data });
            }),
          },
          bot: { create: jest.fn().mockResolvedValue(mockBot) },
        };
        return cb(tx);
      });

      await service.create(mockOwnerId, mockCreateDto);

      expect(capturedUserData.password).toHaveLength(64);
      expect(capturedUserData.password).toMatch(/^[0-9a-f]{64}$/);
    });

    it('agentConfig 缺少 systemPrompt 时应返回 400', async () => {
      const invalidDto = {
        ...mockCreateDto,
        agentConfig: { llmProvider: 'deepseek' }, // 缺少 systemPrompt
      };

      await expect(
        service.create(mockOwnerId, invalidDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('agentConfig temperature 超出范围时应返回 400', async () => {
      const invalidDto = {
        ...mockCreateDto,
        agentConfig: {
          ...validAgentConfig,
          temperature: 5, // 超出 0-2 范围
        },
      };

      await expect(
        service.create(mockOwnerId, invalidDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('agentConfig llmProvider 无效时应返回 400', async () => {
      const invalidDto = {
        ...mockCreateDto,
        agentConfig: {
          ...validAgentConfig,
          llmProvider: 'invalid-provider',
        },
      };

      await expect(
        service.create(mockOwnerId, invalidDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── findByOwner() ────────────────────────────

  describe('findByOwner', () => {
    it('应返回用户的所有 Bot，isPinned 优先', async () => {
      const bots = [mockBot, mockSystemBot];
      prisma.bot.findMany.mockResolvedValue(bots);

      const result = await service.findByOwner(mockOwnerId);

      expect(result).toEqual(bots);
      expect(prisma.bot.findMany).toHaveBeenCalledWith({
        where: { ownerId: mockOwnerId },
        orderBy: [
          { isPinned: 'desc' },
          { createdAt: 'asc' },
        ],
      });
    });

    it('用户没有 Bot 时应返回空数组', async () => {
      prisma.bot.findMany.mockResolvedValue([]);

      const result = await service.findByOwner('non-existent-owner');

      expect(result).toEqual([]);
    });
  });

  // ── findOne() ────────────────────────────

  describe('findOne', () => {
    it('应返回指定 Bot', async () => {
      prisma.bot.findFirst.mockResolvedValue(mockBot);

      const result = await service.findOne('bot-001', mockOwnerId);

      expect(result).toEqual(mockBot);
    });

    it('Bot 不存在时应抛出 NotFoundException', async () => {
      prisma.bot.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('non-existent', mockOwnerId),
      ).rejects.toThrow(NotFoundException);
    });

    it('非 owner 查看时应抛出 NotFoundException', async () => {
      // findFirst with { id, ownerId } where ownerId doesn't match returns null
      prisma.bot.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('bot-001', 'other-owner'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── update() ────────────────────────────

  describe('update', () => {
    it('应更新 Bot 配置', async () => {
      prisma.bot.findFirst.mockResolvedValue(mockBot);
      const updatedBot = { ...mockBot, name: 'Updated Bot' };

      prisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          bot: { update: jest.fn().mockResolvedValue(updatedBot) },
          user: { update: jest.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const result = await service.update('bot-001', mockOwnerId, {
        name: 'Updated Bot',
      });

      expect(result.name).toBe('Updated Bot');
    });

    it('更新 name 时应同步更新 Bot User 的 displayName', async () => {
      prisma.bot.findFirst.mockResolvedValue(mockBot);
      let userUpdateCalled = false;

      prisma.$transaction.mockImplementation(async (cb) => {
        const tx = {
          bot: { update: jest.fn().mockResolvedValue({ ...mockBot, name: 'New Name' }) },
          user: {
            update: jest.fn().mockImplementation(() => {
              userUpdateCalled = true;
              return Promise.resolve({});
            }),
          },
        };
        return cb(tx);
      });

      await service.update('bot-001', mockOwnerId, { name: 'New Name' });

      expect(userUpdateCalled).toBe(true);
    });

    it('Bot 不存在时应抛出 NotFoundException', async () => {
      prisma.bot.findFirst.mockResolvedValue(null);

      await expect(
        service.update('non-existent', mockOwnerId, { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('更新 agentConfig 时应验证格式', async () => {
      prisma.bot.findFirst.mockResolvedValue(mockBot);

      await expect(
        service.update('bot-001', mockOwnerId, {
          agentConfig: { llmProvider: 'invalid' } as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── delete() ────────────────────────────

  describe('delete', () => {
    it('应删除 Bot 并软删除 Bot User', async () => {
      prisma.bot.findFirst.mockResolvedValue(mockBot);
      prisma.$transaction.mockResolvedValue(undefined);

      await service.delete('bot-001', mockOwnerId);

      expect(prisma.$transaction).toHaveBeenCalledWith([
        expect.anything(), // bot.delete
        expect.anything(), // user.update (soft delete)
      ]);
    });

    it('isDeletable=false 的 Bot 应抛出 ForbiddenException', async () => {
      prisma.bot.findFirst.mockResolvedValue(mockSystemBot);

      await expect(
        service.delete('bot-system-001', mockOwnerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Bot 不存在时应抛出 NotFoundException', async () => {
      prisma.bot.findFirst.mockResolvedValue(null);

      await expect(
        service.delete('non-existent', mockOwnerId),
      ).rejects.toThrow(NotFoundException);
    });

    it('非 owner 删除时应抛出 NotFoundException', async () => {
      prisma.bot.findFirst.mockResolvedValue(null);

      await expect(
        service.delete('bot-001', 'other-owner'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
```

### 运行测试

```bash
pnpm --filter server test -- --testPathPattern=bots.service.spec
```

---

## 关键文件汇总

```
apps/server/src/bots/
  ├── bots.module.ts              # NestJS 模块定义
  ├── bots.controller.ts          # REST CRUD 端点
  ├── bots.service.ts             # Bot + User 联创业务逻辑
  ├── bots.service.spec.ts        # 单元测试
  └── dto/
      ├── create-bot.dto.ts       # 创建 DTO（class-validator）
      ├── update-bot.dto.ts       # 更新 DTO（PartialType）
      └── bot-response.dto.ts     # 响应类型定义

packages/shared/src/schemas/
  ├── bot.schema.ts               # agentConfig Zod 验证 schema
  └── index.ts                    # 追加 export

apps/server/src/app.module.ts     # 注册 BotsModule
apps/server/prisma/schema.prisma  # Bot model + BotType enum（Phase 0 已添加）
```

---

## 错误码参考

| 状态码 | 场景 | 错误消息 |
|--------|------|---------|
| 400 | agentConfig 格式无效 | `Invalid agentConfig` + 详细字段错误 |
| 400 | name 为空或超长 | class-validator 标准错误 |
| 401 | 未携带或无效 JWT | `Unauthorized` |
| 403 | 删除 isDeletable=false 的 Bot | `This bot cannot be deleted` |
| 404 | Bot 不存在或非 owner | `Bot not found` |

---

## 完成标准

- [ ] POST /bots 在同一事务中创建 Bot + 关联 User 记录
- [ ] GET /bots 返回当前用户的 Bot 列表，isPinned 置顶排序
- [ ] PATCH /bots/:id 可更新 Bot 配置，同步更新 Bot User 的 displayName/avatarUrl
- [ ] DELETE /bots/:id 对 isDeletable=false 的 Bot 返回 403
- [ ] agentConfig 验证拒绝无效 schema，返回 400 + 详细错误信息
- [ ] Bot User 使用不可登录的 email（`@linkingchat.bot`）和随机密码
- [ ] 单元测试全部通过（覆盖 CRUD + 验证 + 权限检查）

---

## 与后续 Phase 的衔接

| 后续 Phase | 依赖本 Phase | 说明 |
|-----------|-------------|------|
| **Phase 6: 注册自动创建 Bot** | `BotsService.createSystemBot()` | 注册流程中调用创建 Supervisor + Coding Bot |
| **Phase 7: Bot 聊天 UI** | Bot-User 关联 | Bot 作为 ConverseMember 出现在聊天列表 |
| **Phase 9: Supervisor 通知** | Bot 数据模型 | 通过 Bot.type 和 agentConfig 路由通知 |
