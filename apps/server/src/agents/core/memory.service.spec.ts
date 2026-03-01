import { Test, TestingModule } from '@nestjs/testing';
import { AgentMemoryService } from './memory.service';
import { MemoryEntry, CommandResult } from '../interfaces';

describe('AgentMemoryService', () => {
  let service: AgentMemoryService;
  let mockRedis: any;

  beforeEach(async () => {
    mockRedis = {
      lrange: jest.fn().mockResolvedValue([]),
      lpush: jest.fn().mockResolvedValue(1),
      ltrim: jest.fn().mockResolvedValue('OK'),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentMemoryService,
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get<AgentMemoryService>(AgentMemoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getShortTermMemory', () => {
    it('should return empty array when no memory exists', async () => {
      mockRedis.lrange.mockResolvedValueOnce([]);
      const result = await service.getShortTermMemory('bot-123');
      expect(result).toEqual([]);
    });

    it('should return parsed memory entries', async () => {
      const entry = { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' };
      mockRedis.lrange.mockResolvedValueOnce([JSON.stringify(entry)]);
      const result = await service.getShortTermMemory('bot-123');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Hello');
    });
  });

  describe('addShortTermMemory', () => {
    it('should add entry and trim to limit', async () => {
      const entry: MemoryEntry = {
        role: 'user',
        content: 'Test',
        timestamp: new Date(),
      };
      await service.addShortTermMemory('bot-123', entry);
      expect(mockRedis.lpush).toHaveBeenCalled();
      expect(mockRedis.ltrim).toHaveBeenCalledWith(expect.any(String), 0, 19);
    });
  });

  describe('addCommandResult', () => {
    it('should add result to working memory', async () => {
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({
        pendingActions: [],
        recentResults: [],
      }));

      const result: CommandResult = {
        commandId: 'cmd-1',
        command: 'ls -la',
        status: 'success',
        output: 'file1.txt',
        completedAt: new Date(),
      };

      await service.addCommandResult('bot-123', result);
      expect(mockRedis.set).toHaveBeenCalled();
    });
  });
});
