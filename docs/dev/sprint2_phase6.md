> **状态：⬜ 未开始**

# Sprint 2 — Phase 6：注册自动创建 Bot（Auto-create Bots on Registration）

> **负责人**：后端开发者（线 B）
>
> **前置条件**：Phase 5（Bot Model + CRUD）已完成，`BotsService.create()` 可用；Phase 0（Schema 扩展）已完成，Converse / ConverseMember / Message model 可用；Phase 2（1 对 1 聊天）MessagesService.create() 可用
>
> **产出**：用户注册时自动创建 Supervisor + Coding Bot，各自带 DM 会话和欢迎消息
>
> **参考**：[sprint2_implement.md](./sprint2_implement.md) | [database-schema.md](../dev-plan/database-schema.md) | [sprint1_phase1.md](./sprint1_phase1.md)（AuthService.register 原始实现）

---

## 设计思路

当用户注册时，系统应自动为其创建两个默认 Bot（Supervisor 和 Coding Bot），每个 Bot 拥有独立的 User 记录、DM 会话和欢迎消息。这样用户注册后立刻能在聊天列表中看到两个 Bot 对话，体验到 AI-native 的产品定位。

### 核心原则

1. **Bot 用户不可登录**：Bot 的 User 记录使用随机密码和不可达邮箱（`bot-{id}@bot.linkingchat.internal`），杜绝人类登录
2. **事务一致性**：每个 Bot 的创建（User + Bot + Converse + ConverseMember + Message）在同一个 `$transaction` 中完成，避免中间状态
3. **注册流程无感知**：Bot 创建失败不应阻塞注册流程（try-catch + 日志告警），但在 E2E 测试中需验证成功
4. **复用已有模式**：DM Converse 的创建模式与 Phase 1 好友接受流程一致

### 数据流

```
POST /api/v1/auth/register
  │
  ├── 1. 创建 User（原有逻辑）
  │
  ├── 2. BotInitService.createDefaultBots(userId)  ← 新增
  │     │
  │     ├── for each template in DEFAULT_BOT_TEMPLATES:
  │     │     └── $transaction:
  │     │           ├── a. BotsService.createWithTx() → Bot + Bot.User
  │     │           ├── b. Converse.create(type: DM)
  │     │           ├── c. ConverseMember.createMany([user, bot])
  │     │           └── d. Message.create(welcomeMessage, authorId: bot.userId)
  │     │
  │     └── return (void, errors logged)
  │
  ├── 3. 生成 JWT token pair（原有逻辑）
  └── 4. 返回 { user, accessToken, refreshToken }
```

---

## 任务清单

| # | 任务 | 产出文件 | 依赖 |
|---|------|---------|------|
| 6.1 | 定义默认 Bot 模板 | `apps/server/src/bots/bot-templates.ts` | Phase 5 BotType enum |
| 6.2 | 注册钩子 — AuthService 调用 BotInitService | `apps/server/src/auth/auth.service.ts` 修改 | 6.1 |
| 6.3 | 自动创建 DM Converse | `apps/server/src/bots/bot-init.service.ts` | 6.1, Phase 0 Schema |
| 6.4 | 插入欢迎消息 | bot-init.service.ts 内同一事务 | 6.3 |
| 6.5 | E2E 测试 | `apps/server/test/bot-init.e2e-spec.ts` | 6.1-6.4 |

---

## 6.1 定义默认 Bot 模板

将 Supervisor 和 Coding Bot 的元数据定义为静态模板数组。这些模板决定了每个 Bot 的名称、描述、类型、Agent 配置和欢迎消息。

```typescript
// apps/server/src/bots/bot-templates.ts

import { BotType } from '@prisma/client';

/**
 * Bot 模板接口
 *
 * 用于定义系统默认 Bot 的完整配置。
 * 在用户注册时由 BotInitService 使用。
 */
export interface BotTemplate {
  /** Bot 显示名称 */
  name: string;
  /** Bot 功能描述 */
  description: string;
  /** Bot 类型（来自 Prisma enum） */
  type: BotType;
  /** 是否置顶在聊天列表 */
  isPinned: boolean;
  /** 用户是否可以删除此 Bot */
  isDeletable: boolean;
  /** 头像 URL（可选） */
  avatarUrl?: string;
  /** Agent 配置 — LLM 提供商、系统提示词、可用工具 */
  agentConfig: {
    systemPrompt: string;
    llmProvider: 'deepseek' | 'kimi';
    tools: string[];
  };
  /** 创建 DM 后自动发送的欢迎消息 */
  welcomeMessage: string;
}

/**
 * 系统默认 Bot 模板列表
 *
 * 每个新注册用户都会自动获得这些 Bot。
 * 新增 Bot 只需在此数组追加即可，无需改动其他代码。
 */
export const DEFAULT_BOT_TEMPLATES: BotTemplate[] = [
  {
    name: 'Supervisor',
    description: '你的智能助手管家，通知汇总 + 调度中心',
    type: 'REMOTE_EXEC',
    isPinned: true,
    isDeletable: false,
    agentConfig: {
      systemPrompt:
        "You are Supervisor, the user's intelligent assistant manager. " +
        'You aggregate notifications from other bots and help the user manage tasks.',
      llmProvider: 'deepseek',
      tools: [],
    },
    welcomeMessage:
      '你好！我是 Supervisor，你的智能管家。有任何问题可以问我。',
  },
  {
    name: 'Coding Bot',
    description: '远程代码执行助手，连接你的桌面设备',
    type: 'REMOTE_EXEC',
    isPinned: true,
    isDeletable: false,
    agentConfig: {
      systemPrompt:
        'You are Coding Bot, a remote code execution assistant. ' +
        'Help the user execute commands on their desktop devices.',
      llmProvider: 'deepseek',
      tools: ['system.run', 'system.which'],
    },
    welcomeMessage:
      '你好！我是 Coding Bot。请先在桌面端登录以连接你的设备，然后你就可以通过我远程执行命令了。',
  },
];
```

**要点**：

- `BotType` 来自 Prisma schema（Phase 5 定义），当前默认均为 `REMOTE_EXEC`
- `isDeletable: false` 确保用户不能删除系统默认 Bot
- `isPinned: true` 使 Bot 在聊天列表中始终置顶
- `agentConfig` 为 JSON 字段，存储 LLM 调度所需的配置
- 未来新增系统 Bot 只需在 `DEFAULT_BOT_TEMPLATES` 数组中追加条目

---

## 6.2 注册钩子 — AuthService 调用 BotInitService

在 `AuthService.register()` 中，用户创建成功后调用 `BotInitService.createDefaultBots()`。Bot 创建失败不阻塞注册流程。

### AuthService 修改

```typescript
// apps/server/src/auth/auth.service.ts — register 方法修改

import { Logger } from '@nestjs/common';
import { BotInitService } from '../bots/bot-init.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly botInitService: BotInitService, // ← 新增注入
  ) {
    // ... 原有密钥初始化逻辑不变
  }

  async register(dto: RegisterDto) {
    // 1. 检查用户是否已存在（原有逻辑不变）
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { username: dto.username }],
      },
    });

    if (existing) {
      throw new ConflictException(
        existing.email === dto.email
          ? 'Email already registered'
          : 'Username already taken',
      );
    }

    // 2. argon2 哈希密码（原有逻辑不变）
    const hashedPassword = await argon2.hash(dto.password);

    // 3. 创建用户（原有逻辑不变）
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        password: hashedPassword,
        displayName: dto.displayName,
      },
    });

    // 4. ★ 新增：创建默认 Bot
    try {
      await this.botInitService.createDefaultBots(user.id);
      this.logger.log(`Default bots created for user ${user.id}`);
    } catch (error) {
      // Bot 创建失败不阻塞注册流程，记录错误日志
      this.logger.error(
        `Failed to create default bots for user ${user.id}: ${error.message}`,
        error.stack,
      );
    }

    // 5. 生成 token pair（原有逻辑不变）
    const tokens = await this.generateTokenPair(user.id, user.username);

    // 6. 存储 refresh token（原有逻辑不变）
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
      },
      ...tokens,
    };
  }

  // ... 其余方法（login, refresh, generateTokenPair, storeRefreshToken）不变
}
```

### AuthModule 修改

```typescript
// apps/server/src/auth/auth.module.ts

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { BotsModule } from '../bots/bots.module'; // ← 新增

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
    BotsModule, // ← 新增：导入 BotsModule 以获取 BotInitService
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

**要点**：

- `BotInitService` 通过 `BotsModule` 导出，`AuthModule` 导入 `BotsModule` 即可注入
- `try-catch` 包裹 Bot 创建逻辑，确保即使 Bot 创建失败，用户仍能正常注册并获得 token
- 使用 NestJS `Logger` 记录成功/失败信息，便于排查问题
- 注册 API 的请求/响应格式完全不变，对前端透明

---

## 6.3 自动创建 DM Converse + 6.4 插入欢迎消息

6.3 和 6.4 在 `BotInitService` 中同一事务内完成。每个 Bot 的完整创建流程（Bot + DM + Welcome Message）使用 `$transaction` 保证原子性。

### BotInitService

```typescript
// apps/server/src/bots/bot-init.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BotsService } from './bots.service';
import {
  DEFAULT_BOT_TEMPLATES,
  type BotTemplate,
} from './bot-templates';

@Injectable()
export class BotInitService {
  private readonly logger = new Logger(BotInitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly botsService: BotsService,
  ) {}

  /**
   * 为新注册用户创建所有默认 Bot
   *
   * 每个 Bot 独立事务：
   *   1. 创建 Bot（含 Bot 专用 User 记录）
   *   2. 创建 DM Converse
   *   3. 创建 ConverseMember（用户 + Bot 双方）
   *   4. 插入欢迎消息
   *
   * @param userId - 新注册用户的 ID
   */
  async createDefaultBots(userId: string): Promise<void> {
    for (const template of DEFAULT_BOT_TEMPLATES) {
      await this.createBotWithDm(userId, template);
    }

    this.logger.log(
      `Created ${DEFAULT_BOT_TEMPLATES.length} default bots for user ${userId}`,
    );
  }

  /**
   * 创建单个 Bot 及其 DM 会话（事务）
   */
  private async createBotWithDm(
    userId: string,
    template: BotTemplate,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // ──────────────────────────────────────────
      // Step 1: 创建 Bot（含 Bot 专用 User 记录）
      // ──────────────────────────────────────────
      //
      // BotsService.createWithTx() 内部会：
      //   a. 创建一个不可登录的 User 记录（随机密码、bot 邮箱）
      //   b. 创建 Bot 记录，关联到该 User 和 ownerId
      //
      const bot = await this.botsService.createWithTx(tx, userId, {
        name: template.name,
        description: template.description,
        type: template.type,
        agentConfig: template.agentConfig,
        isPinned: template.isPinned,
        isDeletable: template.isDeletable,
      });

      this.logger.debug(
        `Bot "${template.name}" created: botId=${bot.id}, botUserId=${bot.userId}`,
      );

      // ──────────────────────────────────────────
      // Step 2: 创建 DM Converse
      // ──────────────────────────────────────────
      //
      // 复用 Phase 1 好友接受流程的 DM 创建模式：
      //   - type: 'DM'
      //   - name: null（DM 不需要名称，客户端根据对方用户名显示）
      //
      const converse = await tx.converse.create({
        data: {
          type: 'DM',
        },
      });

      this.logger.debug(
        `DM Converse created: converseId=${converse.id} for bot "${template.name}"`,
      );

      // ──────────────────────────────────────────
      // Step 3: 创建 ConverseMember（用户 + Bot 双方）
      // ──────────────────────────────────────────
      //
      // 两条记录：
      //   - 用户自己作为成员
      //   - Bot 的 User 作为成员
      //
      await tx.converseMember.createMany({
        data: [
          {
            converseId: converse.id,
            userId: userId,
          },
          {
            converseId: converse.id,
            userId: bot.userId,
          },
        ],
      });

      // ──────────────────────────────────────────
      // Step 4: 插入欢迎消息
      // ──────────────────────────────────────────
      //
      // 消息的 authorId 是 Bot 的 User ID，
      // 这样在聊天界面中会显示为 Bot 发送的消息。
      //
      await tx.message.create({
        data: {
          content: template.welcomeMessage,
          type: 'TEXT',
          converseId: converse.id,
          authorId: bot.userId,
        },
      });

      this.logger.debug(
        `Welcome message inserted for bot "${template.name}" in converse ${converse.id}`,
      );
    });
  }
}
```

### BotsModule 导出 BotInitService

```typescript
// apps/server/src/bots/bots.module.ts

import { Module } from '@nestjs/common';
import { BotsController } from './bots.controller';
import { BotsService } from './bots.service';
import { BotInitService } from './bot-init.service';

@Module({
  controllers: [BotsController],
  providers: [BotsService, BotInitService],
  exports: [BotsService, BotInitService], // ← BotInitService 导出给 AuthModule
})
export class BotsModule {}
```

**要点**：

- 每个 Bot 使用独立的 `$transaction`，一个 Bot 创建失败不影响另一个
- `createWithTx()` 是 Phase 5 中 `BotsService` 需要新增的方法，接受 Prisma 事务客户端 `tx` 而非使用 `this.prisma`，以确保在同一事务中操作
- DM Converse 的创建模式与 Phase 1 好友接受流程完全一致（`type: DM` + `ConverseMember.createMany`）
- 欢迎消息的 `authorId` 是 Bot 的 `userId`（而非 Bot 的 `id`），因为 Message.authorId 关联的是 User 表
- `Logger.debug()` 用于详细的创建过程日志，生产环境可通过日志级别控制输出

### BotsService.createWithTx() 补充说明

Phase 5 的 `BotsService.create()` 使用 `this.prisma` 直接操作。Phase 6 需要在事务中调用，因此需要新增一个接受 `tx` 参数的版本：

```typescript
// apps/server/src/bots/bots.service.ts — 新增方法

import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

type PrismaTx = Prisma.TransactionClient;

/**
 * 在给定事务中创建 Bot 及其关联 User
 *
 * 与 create() 逻辑一致，但使用 tx 而非 this.prisma，
 * 以支持在外部事务中调用（如 BotInitService）。
 */
async createWithTx(
  tx: PrismaTx,
  ownerId: string,
  data: {
    name: string;
    description: string;
    type: BotType;
    agentConfig: Record<string, unknown>;
    isPinned?: boolean;
    isDeletable?: boolean;
  },
) {
  // 1. 创建不可登录的 Bot User
  //    - 邮箱使用不可达域名
  //    - 密码使用随机 32 字节，确保无法被猜测
  const botEmail = `bot-${randomBytes(8).toString('hex')}@bot.linkingchat.internal`;
  const botPassword = await argon2.hash(randomBytes(32).toString('hex'));

  const botUser = await tx.user.create({
    data: {
      email: botEmail,
      username: `bot_${data.name.toLowerCase().replace(/\s+/g, '_')}_${randomBytes(4).toString('hex')}`,
      password: botPassword,
      displayName: data.name,
    },
  });

  // 2. 创建 Bot 记录
  const bot = await tx.bot.create({
    data: {
      name: data.name,
      description: data.description,
      type: data.type,
      ownerId: ownerId,
      userId: botUser.id,
      agentConfig: data.agentConfig,
      isPinned: data.isPinned ?? false,
      isDeletable: data.isDeletable ?? true,
    },
  });

  return bot;
}
```

**Bot User 安全设计**：

| 属性 | 值 | 说明 |
|------|-----|------|
| email | `bot-{random}@bot.linkingchat.internal` | 不可达域名，不可能通过邮箱登录 |
| password | `argon2(random 32 bytes)` | 随机密码，不可能被猜测 |
| username | `bot_{name}_{random}` | 包含随机后缀，避免冲突 |
| displayName | Bot 模板的 `name` | 在聊天界面中显示 |

---

## 6.5 E2E 测试

验证完整流程：注册新用户 → 检查 2 个 Bot 存在 → 检查 2 个 DM 会话存在 → 检查欢迎消息存在。

```typescript
// apps/server/test/bot-init.e2e-spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Bot Auto-creation on Registration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // 注册返回的数据
  let userId: string;
  let accessToken: string;

  const testUser = {
    email: 'bottest@linkingchat.com',
    username: 'bottest_user',
    password: 'Test1234!',
    displayName: 'Bot Test User',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // 清理测试数据（按外键依赖顺序）
    if (userId) {
      await prisma.message.deleteMany({
        where: {
          converse: {
            members: { some: { userId } },
          },
        },
      });
      await prisma.converseMember.deleteMany({
        where: { userId },
      });
      // 删除 bot user 的 converseMember
      const bots = await prisma.bot.findMany({
        where: { ownerId: userId },
      });
      for (const bot of bots) {
        await prisma.converseMember.deleteMany({
          where: { userId: bot.userId },
        });
      }
      await prisma.converse.deleteMany({
        where: {
          members: { none: {} }, // 删除已无成员的 converse
        },
      });
      await prisma.bot.deleteMany({ where: { ownerId: userId } });
      // 删除 bot user 记录
      for (const bot of bots) {
        await prisma.user.delete({ where: { id: bot.userId } });
      }
      await prisma.refreshToken.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await app.close();
  });

  // ─────────────────────────────────────────────
  // Step 1: 注册用户
  // ─────────────────────────────────────────────

  it('POST /api/v1/auth/register → 201, registration succeeds', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(testUser)
      .expect(201);

    userId = res.body.user.id;
    accessToken = res.body.accessToken;

    expect(userId).toBeDefined();
    expect(accessToken).toBeDefined();
    expect(res.body.user.email).toBe(testUser.email);
    expect(res.body.user.username).toBe(testUser.username);
  });

  // ─────────────────────────────────────────────
  // Step 2: 验证 Bot 创建
  // ─────────────────────────────────────────────

  it('should have created 2 bots for the new user', async () => {
    const bots = await prisma.bot.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'asc' },
    });

    expect(bots).toHaveLength(2);

    // Supervisor
    const supervisor = bots.find((b) => b.name === 'Supervisor');
    expect(supervisor).toBeDefined();
    expect(supervisor!.type).toBe('REMOTE_EXEC');
    expect(supervisor!.isPinned).toBe(true);
    expect(supervisor!.isDeletable).toBe(false);

    // Coding Bot
    const codingBot = bots.find((b) => b.name === 'Coding Bot');
    expect(codingBot).toBeDefined();
    expect(codingBot!.type).toBe('REMOTE_EXEC');
    expect(codingBot!.isPinned).toBe(true);
    expect(codingBot!.isDeletable).toBe(false);
  });

  // ─────────────────────────────────────────────
  // Step 3: 验证 Bot User 记录
  // ─────────────────────────────────────────────

  it('each bot should have an associated non-loginable User record', async () => {
    const bots = await prisma.bot.findMany({
      where: { ownerId: userId },
      include: { user: true },
    });

    for (const bot of bots) {
      expect(bot.user).toBeDefined();
      expect(bot.userId).toBe(bot.user.id);

      // Bot 邮箱使用不可达域名
      expect(bot.user.email).toContain('@bot.linkingchat.internal');

      // Bot 用户名包含 bot_ 前缀
      expect(bot.user.username).toMatch(/^bot_/);

      // displayName 与 Bot 名称一致
      expect(bot.user.displayName).toBe(bot.name);
    }
  });

  // ─────────────────────────────────────────────
  // Step 4: 验证 DM Converse 创建
  // ─────────────────────────────────────────────

  it('each bot should have a DM Converse with the user', async () => {
    const bots = await prisma.bot.findMany({
      where: { ownerId: userId },
    });

    for (const bot of bots) {
      // 查找包含用户和 bot 的 DM Converse
      const converses = await prisma.converse.findMany({
        where: {
          type: 'DM',
          members: {
            every: {
              userId: { in: [userId, bot.userId] },
            },
          },
        },
        include: {
          members: true,
        },
      });

      // 过滤出恰好包含这两个成员的 converse
      const dmConverse = converses.find(
        (c) =>
          c.members.length === 2 &&
          c.members.some((m) => m.userId === userId) &&
          c.members.some((m) => m.userId === bot.userId),
      );

      expect(dmConverse).toBeDefined();
      expect(dmConverse!.type).toBe('DM');
      expect(dmConverse!.members).toHaveLength(2);
    }
  });

  // ─────────────────────────────────────────────
  // Step 5: 验证欢迎消息
  // ─────────────────────────────────────────────

  it('each bot DM should contain a welcome message from the bot', async () => {
    const bots = await prisma.bot.findMany({
      where: { ownerId: userId },
    });

    const expectedMessages: Record<string, string> = {
      Supervisor:
        '你好！我是 Supervisor，你的智能管家。有任何问题可以问我。',
      'Coding Bot':
        '你好！我是 Coding Bot。请先在桌面端登录以连接你的设备，然后你就可以通过我远程执行命令了。',
    };

    for (const bot of bots) {
      // 找到 bot 和 user 的 DM converse
      const converses = await prisma.converse.findMany({
        where: {
          type: 'DM',
          members: {
            some: { userId: bot.userId },
          },
        },
        include: {
          members: true,
          messages: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      const dmConverse = converses.find(
        (c) =>
          c.members.length === 2 &&
          c.members.some((m) => m.userId === userId),
      );

      expect(dmConverse).toBeDefined();
      expect(dmConverse!.messages).toHaveLength(1);

      const welcomeMsg = dmConverse!.messages[0];
      expect(welcomeMsg.authorId).toBe(bot.userId);
      expect(welcomeMsg.type).toBe('TEXT');
      expect(welcomeMsg.content).toBe(expectedMessages[bot.name]);
    }
  });

  // ─────────────────────────────────────────────
  // Step 6: 验证注册响应格式不变
  // ─────────────────────────────────────────────

  it('registration response format should be unchanged', async () => {
    // 使用另一个用户验证响应格式
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'bottest2@linkingchat.com',
        username: 'bottest_user2',
        password: 'Test1234!',
        displayName: 'Bot Test User 2',
      })
      .expect(201);

    // 响应格式：{ user, accessToken, refreshToken }
    expect(res.body).toHaveProperty('user');
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user).toHaveProperty('email');
    expect(res.body.user).toHaveProperty('username');
    expect(res.body.user).toHaveProperty('displayName');

    // 响应中不应包含 bot 相关信息（保持向后兼容）
    expect(res.body).not.toHaveProperty('bots');

    // 清理第二个测试用户
    const user2Id = res.body.user.id;
    const bots2 = await prisma.bot.findMany({
      where: { ownerId: user2Id },
    });
    for (const bot of bots2) {
      await prisma.message.deleteMany({
        where: { authorId: bot.userId },
      });
      await prisma.converseMember.deleteMany({
        where: { userId: bot.userId },
      });
    }
    await prisma.converseMember.deleteMany({
      where: { userId: user2Id },
    });
    await prisma.bot.deleteMany({ where: { ownerId: user2Id } });
    for (const bot of bots2) {
      await prisma.user.delete({ where: { id: bot.userId } });
    }
    await prisma.refreshToken.deleteMany({ where: { userId: user2Id } });
    await prisma.user.delete({ where: { id: user2Id } });
  });
});
```

**测试要点**：

- 测试按顺序执行：先注册 → 再验证 Bot → 再验证 DM → 再验证消息
- `afterAll` 按外键依赖顺序清理数据：Message → ConverseMember → Converse → Bot → Bot User → RefreshToken → User
- 最后一个测试验证注册 API 的响应格式未被改变（向后兼容）
- Bot User 的不可登录性通过邮箱域名和用户名前缀验证

---

## 文件变更汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/server/src/bots/bot-templates.ts` | **新增** | 默认 Bot 模板定义 |
| `apps/server/src/bots/bot-init.service.ts` | **新增** | Bot 初始化服务（创建 Bot + DM + 消息） |
| `apps/server/src/bots/bots.service.ts` | **修改** | 新增 `createWithTx()` 方法 |
| `apps/server/src/bots/bots.module.ts` | **修改** | 注册并导出 `BotInitService` |
| `apps/server/src/auth/auth.service.ts` | **修改** | `register()` 中调用 `botInitService.createDefaultBots()` |
| `apps/server/src/auth/auth.module.ts` | **修改** | `imports` 中添加 `BotsModule` |
| `apps/server/test/bot-init.e2e-spec.ts` | **新增** | E2E 测试 |

---

## 完成标准

- [ ] 新用户注册 → 2 个 Bot（Supervisor + Coding Bot）自动创建
- [ ] 每个 Bot 的 `isDeletable=false`，`isPinned=true`
- [ ] 每个 Bot 有一个关联的 User 记录（不可登录：随机密码 + bot 邮箱）
- [ ] 每个 Bot 有一个 DM Converse 与注册用户关联
- [ ] 每个 Bot 的 DM 中包含一条欢迎消息（authorId 为 Bot 的 userId）
- [ ] 现有注册流程（token 生成、响应格式）不受影响
- [ ] Bot 创建失败不阻塞注册流程（try-catch 保护）
- [ ] E2E 测试全部通过
