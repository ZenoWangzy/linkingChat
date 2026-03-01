import { Test, TestingModule } from '@nestjs/testing';
import { MentionService } from '../mentions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WhisperService } from '../../ai/services/whisper.service';
import { AgentOrchestratorService } from '../../agents/orchestrator/agent-orchestrator.service';

describe('MentionService', () => {
  let service: MentionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MentionService,
        { provide: PrismaService, useValue: {} },
        { provide: WhisperService, useValue: {} },
        { provide: AgentOrchestratorService, useValue: {} },
      ],
    }).compile();

    service = module.get<MentionService>(MentionService);
  });

  describe('parse', () => {
    it('should parse single @mention', () => {
      const result = service.parse('Hello @CodingBot, how are you?');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'CodingBot',
        fullMatch: '@CodingBot',
        startIndex: 6,
      });
    });

    it('should parse multiple @mentions', () => {
      const result = service.parse('@Bot1 and @Bot2 please help');
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Bot1');
      expect(result[1].name).toBe('Bot2');
    });

    it('should parse @ai as special mention', () => {
      const result = service.parse('Hey @ai what do you think?');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('ai');
    });

    it('should handle Chinese characters in bot names', () => {
      const result = service.parse('@小助手 帮我查一下');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('小助手');
    });

    it('should deduplicate repeated mentions', () => {
      const result = service.parse('@Bot1 @Bot1 @Bot1');
      expect(result).toHaveLength(1);
    });

    it('should return empty array for no mentions', () => {
      expect(service.parse('Hello world')).toEqual([]);
      expect(service.parse('')).toEqual([]);
      expect(service.parse(null as any)).toEqual([]);
    });

    it('should not match email addresses', () => {
      const result = service.parse('Contact me at test@example.com');
      expect(result).toEqual([]);
    });
  });

  describe('validate', () => {
    it('should validate @ai as special type', async () => {
      const parsed = service.parse('Hello @ai');
      const result = await service.validate(parsed, 'converse-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'ai',
        name: 'ai',
        fullMatch: '@ai',
      });
    });

    it('should return empty for non-existent bot', async () => {
      const mockPrisma = {
        bot: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MentionService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: WhisperService, useValue: {} },
          { provide: AgentOrchestratorService, useValue: {} },
        ],
      }).compile();

      const serviceWithMock = module.get<MentionService>(MentionService);
      const parsed = serviceWithMock.parse('Hello @NonExistentBot');
      const result = await serviceWithMock.validate(parsed, 'converse-1');

      expect(result).toEqual([]);
    });

    it('should validate existing bot from database', async () => {
      const mockPrisma = {
        bot: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'bot-1', name: 'CodingBot', userId: 'user-1' },
          ]),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MentionService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: WhisperService, useValue: {} },
          { provide: AgentOrchestratorService, useValue: {} },
        ],
      }).compile();

      const serviceWithMock = module.get<MentionService>(MentionService);
      const parsed = serviceWithMock.parse('@CodingBot help');
      const result = await serviceWithMock.validate(parsed, 'converse-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'bot',
        name: 'CodingBot',
        fullMatch: '@CodingBot',
        botId: 'bot-1',
        userId: 'user-1',
      });
    });
  });

  describe('route', () => {
    it('should route @ai to WhisperService', async () => {
      const mockWhisper = {
        handleWhisperTrigger: jest.fn().mockResolvedValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MentionService,
          { provide: PrismaService, useValue: { bot: { findMany: jest.fn() } } },
          { provide: WhisperService, useValue: mockWhisper },
          { provide: AgentOrchestratorService, useValue: { dispatchEvent: jest.fn() } },
        ],
      }).compile();

      const serviceWithMock = module.get<MentionService>(MentionService);

      const mentions = [{
        type: 'ai' as const,
        name: 'ai',
        fullMatch: '@ai',
      }];

      await serviceWithMock.route(mentions, {
        id: 'msg-1',
        content: '@ai hello',
        converseId: 'conv-1',
      } as any, 'user-1', 'conv-1');

      expect(mockWhisper.handleWhisperTrigger).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
        'msg-1',
      );
    });

    it('should route @bot to AgentOrchestrator', async () => {
      const mockOrchestrator = {
        dispatchEvent: jest.fn().mockResolvedValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MentionService,
          { provide: PrismaService, useValue: { bot: { findMany: jest.fn() } } },
          { provide: WhisperService, useValue: { handleWhisperTrigger: jest.fn() } },
          { provide: AgentOrchestratorService, useValue: mockOrchestrator },
        ],
      }).compile();

      const serviceWithMock = module.get<MentionService>(MentionService);

      const mentions = [{
        type: 'bot' as const,
        name: 'CodingBot',
        fullMatch: '@CodingBot',
        botId: 'bot-1',
        userId: 'user-bot-1',
      }];

      await serviceWithMock.route(mentions, {
        id: 'msg-1',
        content: '@CodingBot help',
        converseId: 'conv-1',
      } as any, 'user-1', 'conv-1');

      expect(mockOrchestrator.dispatchEvent).toHaveBeenCalledWith(
        'bot-1',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'USER_MESSAGE',
            payload: expect.objectContaining({
              userId: 'user-1',
              converseId: 'conv-1',
            }),
          }),
        ]),
      );
    });
  });
});
