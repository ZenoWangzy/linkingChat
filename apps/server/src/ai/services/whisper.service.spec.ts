import { Test, TestingModule } from '@nestjs/testing';
import { WhisperService } from './whisper.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BroadcastService } from '../../gateway/broadcast.service';
import { LlmRouterService } from './llm-router.service';

// ── 测试数据 ────────────────────────────

const mockUserId = 'user-001';
const mockConverseId = 'converse-001';
const mockMessageId = 'msg-001';

const mockMessages = [
  {
    id: 'msg-prev-3',
    content: '今天开会讨论什么？',
    author: { displayName: 'Alice' },
    createdAt: new Date('2026-02-16T10:00:00Z'),
  },
  {
    id: 'msg-prev-2',
    content: '讨论下季度的计划',
    author: { displayName: 'Bob' },
    createdAt: new Date('2026-02-16T10:01:00Z'),
  },
  {
    id: 'msg-prev-1',
    content: '方案已经准备好了',
    author: { displayName: 'Alice' },
    createdAt: new Date('2026-02-16T10:02:00Z'),
  },
];

const mockSuggestionRecord = {
  id: 'suggestion-001',
  type: 'WHISPER',
  status: 'PENDING',
  userId: mockUserId,
  converseId: mockConverseId,
  messageId: mockMessageId,
  suggestions: {
    primary: '方案看起来不错',
    alternatives: ['时间上有点紧', '需要再讨论一下'],
  },
  selectedIndex: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Mock Services ────────────────────────────

const mockPrisma: any = {
  message: {
    findMany: jest.fn(),
  },
  aiSuggestion: {
    create: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockBroadcast: any = {
  toRoom: jest.fn(),
};

const mockLlmRouter: any = {
  complete: jest.fn(),
};

// ── 测试套件 ────────────────────────────

describe('WhisperService', () => {
  let service: WhisperService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhisperService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BroadcastService, useValue: mockBroadcast },
        { provide: LlmRouterService, useValue: mockLlmRouter },
      ],
    }).compile();

    service = module.get<WhisperService>(WhisperService);
    jest.clearAllMocks();
  });

  // ── isWhisperTrigger() ────────────────────────────

  describe('isWhisperTrigger', () => {
    it('should return true for "@ai"', () => {
      expect(service.isWhisperTrigger('@ai')).toBe(true);
    });

    it('should return true for "@ai 帮我回复"', () => {
      expect(service.isWhisperTrigger('@ai 帮我回复')).toBe(true);
    });

    it('should return true for "请 @ai 看一下"', () => {
      expect(service.isWhisperTrigger('请 @ai 看一下')).toBe(true);
    });

    it('should return true for "@AI" (case insensitive)', () => {
      expect(service.isWhisperTrigger('@AI')).toBe(true);
    });

    it('should return false for null', () => {
      expect(service.isWhisperTrigger(null)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(service.isWhisperTrigger('')).toBe(false);
    });

    it('should return false for "@aide" (partial match)', () => {
      expect(service.isWhisperTrigger('@aide')).toBe(false);
    });

    it('should return false for "email@ai.com" (embedded in email)', () => {
      expect(service.isWhisperTrigger('email@ai.com')).toBe(false);
    });
  });

  // ── parseSuggestions() ────────────────────────────

  describe('parseSuggestions', () => {
    it('should parse valid JSON output', () => {
      const json = JSON.stringify({
        primary: '好的',
        alternatives: ['没问题', '可以'],
      });

      const result = service.parseSuggestions(json);

      expect(result.primary).toBe('好的');
      expect(result.alternatives).toEqual(['没问题', '可以']);
    });

    it('should parse line-based output when JSON fails', () => {
      const text = '1. 好的\n2. 没问题\n3. 可以';

      const result = service.parseSuggestions(text);

      expect(result.primary).toBe('好的');
      expect(result.alternatives).toEqual(['没问题', '可以']);
    });

    it('should handle single-line output', () => {
      const result = service.parseSuggestions('好的');

      expect(result.primary).toBe('好的');
      expect(result.alternatives).toEqual([]);
    });

    it('should limit alternatives to 2', () => {
      const json = JSON.stringify({
        primary: '好的',
        alternatives: ['没问题', '可以', '多余的'],
      });

      const result = service.parseSuggestions(json);

      expect(result.alternatives).toHaveLength(2);
    });
  });

  // ── extractContext() ────────────────────────────

  describe('extractContext', () => {
    it('should format messages as "displayName: content"', async () => {
      mockPrisma.message.findMany.mockResolvedValue([...mockMessages].reverse());

      const context = await service.extractContext(mockConverseId);

      expect(context).toContain('Alice: 今天开会讨论什么？');
      expect(context).toContain('Bob: 讨论下季度的计划');
      expect(context).toContain('Alice: 方案已经准备好了');
    });

    it('should query messages in desc order and reverse', async () => {
      mockPrisma.message.findMany.mockResolvedValue([]);

      await service.extractContext(mockConverseId);

      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { converseId: mockConverseId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      );
    });
  });

  // ── handleWhisperTrigger() ────────────────────────────

  describe('handleWhisperTrigger', () => {
    it('should generate suggestions and push via WS', async () => {
      mockPrisma.message.findMany.mockResolvedValue(mockMessages);
      mockLlmRouter.complete.mockResolvedValue({
        content: JSON.stringify({
          primary: '方案看起来不错',
          alternatives: ['时间上有点紧', '需要再讨论一下'],
        }),
      });
      mockPrisma.aiSuggestion.create.mockResolvedValue(mockSuggestionRecord);

      await service.handleWhisperTrigger(
        mockUserId,
        mockConverseId,
        mockMessageId,
      );

      // Should save to DB
      expect(mockPrisma.aiSuggestion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'WHISPER',
            userId: mockUserId,
            converseId: mockConverseId,
            messageId: mockMessageId,
          }),
        }),
      );

      // Should push via WS
      expect(mockBroadcast.toRoom).toHaveBeenCalledWith(
        `u-${mockUserId}`,
        'ai:whisper:suggestions',
        expect.objectContaining({
          suggestionId: 'suggestion-001',
          converseId: mockConverseId,
          primary: '方案看起来不错',
          alternatives: ['时间上有点紧', '需要再讨论一下'],
        }),
      );
    });

    it('should not push when LLM returns null (timeout)', async () => {
      mockPrisma.message.findMany.mockResolvedValue(mockMessages);
      mockLlmRouter.complete.mockRejectedValue(new Error('timeout'));

      await service.handleWhisperTrigger(
        mockUserId,
        mockConverseId,
        mockMessageId,
      );

      expect(mockPrisma.aiSuggestion.create).not.toHaveBeenCalled();
      expect(mockBroadcast.toRoom).not.toHaveBeenCalled();
    });
  });

  // ── acceptSuggestion() ────────────────────────────

  describe('acceptSuggestion', () => {
    it('should update status to ACCEPTED with selectedIndex', async () => {
      mockPrisma.aiSuggestion.updateMany.mockResolvedValue({ count: 1 });

      await service.acceptSuggestion(mockUserId, 'suggestion-001', 0);

      expect(mockPrisma.aiSuggestion.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'suggestion-001',
          userId: mockUserId,
          status: 'PENDING',
        },
        data: {
          status: 'ACCEPTED',
          selectedIndex: 0,
        },
      });
    });
  });
});
