import { Test, TestingModule } from '@nestjs/testing';
import { BotCommunicationService } from './bot-communication.service';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService } from '../gateway/broadcast.service';
import { LlmRouterService } from '../ai/services/llm-router.service';

// ── 测试数据 ────────────────────────────

const mockUserId = 'user-001';

const mockCodingBot = {
  id: 'bot-coding',
  name: 'Coding Bot',
  description: 'Remote command executor',
  type: 'REMOTE_EXEC',
  userId: 'botuser-coding',
  ownerId: mockUserId,
};

const mockSocialBot = {
  id: 'bot-social',
  name: 'Social Bot',
  description: 'Social media automation',
  type: 'SOCIAL_MEDIA',
  userId: 'botuser-social',
  ownerId: mockUserId,
};

const mockSupervisorBot = {
  id: 'bot-supervisor',
  name: 'Supervisor',
  description: 'Task supervisor and notification aggregator',
  type: 'CUSTOM',
  userId: 'botuser-supervisor',
  ownerId: mockUserId,
};

const mockConverse = {
  id: 'converse-bot-dm',
  type: 'DM',
};

const mockMessage = {
  id: 'msg-cross-001',
  content: '[来自 Coding Bot 的协作]\n\n数据爬取完成，发现 3 条热点',
  type: 'BOT_NOTIFICATION',
  converseId: 'converse-bot-dm',
  authorId: 'botuser-social',
  metadata: {
    triggerSource: {
      botId: 'bot-coding',
      botName: 'Coding Bot',
      reason: '数据爬取完成',
    },
  },
  createdAt: new Date(),
};

// ── Mock Services ────────────────────────────

const mockPrisma: any = {
  bot: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  converse: {
    findFirst: jest.fn(),
  },
  message: {
    create: jest.fn(),
  },
};

const mockBroadcast: any = {
  toRoom: jest.fn(),
};

const mockLlmRouter: any = {
  complete: jest.fn(),
};

// ── 测试套件 ────────────────────────────

describe('BotCommunicationService', () => {
  let service: BotCommunicationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotCommunicationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BroadcastService, useValue: mockBroadcast },
        { provide: LlmRouterService, useValue: mockLlmRouter },
      ],
    }).compile();

    service = module.get<BotCommunicationService>(BotCommunicationService);
    service.resetRateLimits();
    jest.clearAllMocks();
  });

  // ── detectCycle() ────────────────────────────

  describe('detectCycle', () => {
    it('should detect A → B → A cycle', () => {
      expect(service.detectCycle('bot-a', ['bot-a', 'bot-b'])).toBe(true);
    });

    it('should detect A in longer chain', () => {
      expect(
        service.detectCycle('bot-a', ['bot-a', 'bot-b', 'bot-c']),
      ).toBe(true);
    });

    it('should not detect cycle when target is not in chain', () => {
      expect(service.detectCycle('bot-c', ['bot-a', 'bot-b'])).toBe(false);
    });

    it('should not detect cycle for empty chain', () => {
      expect(service.detectCycle('bot-a', [])).toBe(false);
    });
  });

  // ── checkChainDepth() ────────────────────────────

  describe('checkChainDepth', () => {
    it('should allow chain depth of 1', () => {
      expect(service.checkChainDepth(['bot-a'])).toBe(true);
    });

    it('should allow chain depth of 3', () => {
      expect(service.checkChainDepth(['bot-a', 'bot-b', 'bot-c'])).toBe(true);
    });

    it('should reject chain depth of 4', () => {
      expect(
        service.checkChainDepth(['bot-a', 'bot-b', 'bot-c', 'bot-d']),
      ).toBe(false);
    });
  });

  // ── checkRateLimit() ────────────────────────────

  describe('checkRateLimit', () => {
    it('should allow first request', () => {
      expect(service.checkRateLimit('bot-a', 'bot-b')).toBe(true);
    });

    it('should allow up to 5 requests', () => {
      for (let i = 0; i < 5; i++) {
        expect(service.checkRateLimit('bot-a', 'bot-b')).toBe(true);
      }
    });

    it('should reject 6th request within window', () => {
      for (let i = 0; i < 5; i++) {
        service.checkRateLimit('bot-a', 'bot-b');
      }
      expect(service.checkRateLimit('bot-a', 'bot-b')).toBe(false);
    });

    it('should track bot pairs independently', () => {
      for (let i = 0; i < 5; i++) {
        service.checkRateLimit('bot-a', 'bot-b');
      }
      // Different pair should be allowed
      expect(service.checkRateLimit('bot-a', 'bot-c')).toBe(true);
      // Original pair should be rejected
      expect(service.checkRateLimit('bot-a', 'bot-b')).toBe(false);
    });

    it('should report correct count', () => {
      expect(service.getRateLimitCount('bot-a', 'bot-b')).toBe(0);
      service.checkRateLimit('bot-a', 'bot-b');
      service.checkRateLimit('bot-a', 'bot-b');
      expect(service.getRateLimitCount('bot-a', 'bot-b')).toBe(2);
    });
  });

  // ── sendBotMessage() ────────────────────────────

  describe('sendBotMessage', () => {
    it('should send cross-bot message and push via WS', async () => {
      mockPrisma.bot.findFirst
        .mockResolvedValueOnce(mockCodingBot)
        .mockResolvedValueOnce(mockSocialBot);
      mockPrisma.converse.findFirst.mockResolvedValue(mockConverse);
      mockPrisma.message.create.mockResolvedValue(mockMessage);

      const result = await service.sendBotMessage({
        fromBotId: 'bot-coding',
        toBotId: 'bot-social',
        userId: mockUserId,
        content: '数据爬取完成，发现 3 条热点',
        reason: '数据爬取完成',
      });

      expect(result).toEqual({ messageId: 'msg-cross-001' });

      // Should persist message with trigger source
      expect(mockPrisma.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'BOT_NOTIFICATION',
          metadata: expect.objectContaining({
            triggerSource: expect.objectContaining({
              botId: 'bot-coding',
              botName: 'Coding Bot',
            }),
          }),
        }),
      });

      // Should push via WS
      expect(mockBroadcast.toRoom).toHaveBeenCalledWith(
        `u-${mockUserId}`,
        'bot:cross:notify',
        expect.objectContaining({
          fromBotId: 'bot-coding',
          fromBotName: 'Coding Bot',
          toBotId: 'bot-social',
          toBotName: 'Social Bot',
        }),
      );
    });

    it('should reject self-messaging', async () => {
      const result = await service.sendBotMessage({
        fromBotId: 'bot-coding',
        toBotId: 'bot-coding',
        userId: mockUserId,
        content: 'test',
        reason: 'test',
      });

      expect(result).toBeNull();
      expect(mockPrisma.message.create).not.toHaveBeenCalled();
    });

    it('should reject cyclic call chain', async () => {
      const result = await service.sendBotMessage({
        fromBotId: 'bot-coding',
        toBotId: 'bot-social',
        userId: mockUserId,
        content: 'test',
        reason: 'test',
        callChain: ['bot-social', 'bot-coding'],
      });

      expect(result).toBeNull();
    });

    it('should reject chain exceeding depth limit', async () => {
      const result = await service.sendBotMessage({
        fromBotId: 'bot-d',
        toBotId: 'bot-e',
        userId: mockUserId,
        content: 'test',
        reason: 'test',
        callChain: ['bot-a', 'bot-b', 'bot-c', 'bot-d'],
      });

      expect(result).toBeNull();
    });

    it('should reject when rate limited', async () => {
      // Exhaust rate limit
      for (let i = 0; i < 5; i++) {
        service.checkRateLimit('bot-coding', 'bot-social');
      }

      const result = await service.sendBotMessage({
        fromBotId: 'bot-coding',
        toBotId: 'bot-social',
        userId: mockUserId,
        content: 'test',
        reason: 'test',
      });

      expect(result).toBeNull();
    });

    it('should return null when bot not found', async () => {
      mockPrisma.bot.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockSocialBot);

      const result = await service.sendBotMessage({
        fromBotId: 'nonexistent',
        toBotId: 'bot-social',
        userId: mockUserId,
        content: 'test',
        reason: 'test',
      });

      expect(result).toBeNull();
    });

    it('should return null when DM converse not found', async () => {
      mockPrisma.bot.findFirst
        .mockResolvedValueOnce(mockCodingBot)
        .mockResolvedValueOnce(mockSocialBot);
      mockPrisma.converse.findFirst.mockResolvedValue(null);

      const result = await service.sendBotMessage({
        fromBotId: 'bot-coding',
        toBotId: 'bot-social',
        userId: mockUserId,
        content: 'test',
        reason: 'test',
      });

      expect(result).toBeNull();
    });
  });

  // ── routeViaSupervisor() ────────────────────────────

  describe('routeViaSupervisor', () => {
    it('should recommend a bot based on user intent', async () => {
      mockPrisma.bot.findMany.mockResolvedValue([
        mockCodingBot,
        mockSocialBot,
        mockSupervisorBot,
      ]);
      mockLlmRouter.complete.mockResolvedValue({
        content: JSON.stringify({
          botName: 'Coding Bot',
          confidence: 0.9,
          reason: '用户需要执行代码任务',
        }),
      });

      const result = await service.routeViaSupervisor({
        userId: mockUserId,
        userMessage: '帮我拉取最新代码',
      });

      expect(result).toEqual(
        expect.objectContaining({
          recommendedBotId: 'bot-coding',
          recommendedBotName: 'Coding Bot',
          confidence: 0.9,
        }),
      );
    });

    it('should return null when no bots exist', async () => {
      mockPrisma.bot.findMany.mockResolvedValue([]);

      const result = await service.routeViaSupervisor({
        userId: mockUserId,
        userMessage: 'test',
      });

      expect(result).toBeNull();
    });

    it('should return null when LLM returns unmatched bot name', async () => {
      mockPrisma.bot.findMany.mockResolvedValue([mockCodingBot]);
      mockLlmRouter.complete.mockResolvedValue({
        content: JSON.stringify({
          botName: 'Nonexistent Bot',
          confidence: 0.9,
          reason: 'test',
        }),
      });

      const result = await service.routeViaSupervisor({
        userId: mockUserId,
        userMessage: 'test',
      });

      expect(result).toBeNull();
    });
  });

  // ── parseRouteResult() ────────────────────────────

  describe('parseRouteResult', () => {
    const bots = [
      { id: 'bot-1', name: 'Coding Bot', description: 'Code executor', type: 'REMOTE_EXEC' },
      { id: 'bot-2', name: 'Social Bot', description: 'Social media', type: 'SOCIAL_MEDIA' },
    ];

    it('should parse valid JSON response', () => {
      const result = service.parseRouteResult(
        JSON.stringify({
          botName: 'Coding Bot',
          confidence: 0.85,
          reason: '需要执行代码',
        }),
        bots,
      );

      expect(result).toEqual({
        recommendedBotId: 'bot-1',
        recommendedBotName: 'Coding Bot',
        confidence: 0.85,
        reason: '需要执行代码',
      });
    });

    it('should fall back to text matching when JSON fails', () => {
      const result = service.parseRouteResult(
        'I recommend using Coding Bot for this task.',
        bots,
      );

      expect(result).toEqual(
        expect.objectContaining({
          recommendedBotId: 'bot-1',
          recommendedBotName: 'Coding Bot',
          confidence: 0.3,
        }),
      );
    });

    it('should return null for completely unrelated response', () => {
      const result = service.parseRouteResult('no idea', bots);
      expect(result).toBeNull();
    });

    it('should handle case-insensitive bot name matching', () => {
      const result = service.parseRouteResult(
        JSON.stringify({ botName: 'coding bot', confidence: 0.8, reason: 'test' }),
        bots,
      );

      expect(result?.recommendedBotId).toBe('bot-1');
    });

    it('should default confidence to 0.5 when not provided', () => {
      const result = service.parseRouteResult(
        JSON.stringify({ botName: 'Coding Bot', reason: 'test' }),
        bots,
      );

      expect(result?.confidence).toBe(0.5);
    });

    it('should strip markdown code blocks from LLM response', () => {
      const result = service.parseRouteResult(
        '```json\n{"botName": "Coding Bot", "confidence": 0.9, "reason": "执行脚本"}\n```',
        bots,
      );

      expect(result).toEqual({
        recommendedBotId: 'bot-1',
        recommendedBotName: 'Coding Bot',
        confidence: 0.9,
        reason: '执行脚本',
      });
    });
  });
});
