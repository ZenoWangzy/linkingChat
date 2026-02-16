import { Test, TestingModule } from '@nestjs/testing';
import { LlmRouterService } from './llm-router.service';
import { DeepSeekProvider } from '../providers/deepseek.provider';
import { KimiProvider } from '../providers/kimi.provider';
import { LlmRequest, LlmResponse } from '../providers/llm-provider.interface';

// ── 测试数据 ────────────────────────────

const mockDeepSeekResponse: LlmResponse = {
  content: 'DeepSeek says hello',
  provider: 'deepseek',
  model: 'deepseek-chat',
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
};

const mockKimiResponse: LlmResponse = {
  content: 'Kimi says hello',
  provider: 'kimi',
  model: 'moonshot-v1-8k',
  usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
};

const baseRequest: LlmRequest = {
  taskType: 'chat',
  systemPrompt: 'You are helpful.',
  messages: [{ role: 'user', content: 'Hello' }],
};

// ── Mock Providers ────────────────────────────

const mockDeepSeek = {
  name: 'deepseek',
  complete: jest.fn(),
  stream: jest.fn(),
};

const mockKimi = {
  name: 'kimi',
  complete: jest.fn(),
  stream: jest.fn(),
};

// ── 测试套件 ────────────────────────────

describe('LlmRouterService', () => {
  let service: LlmRouterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmRouterService,
        { provide: DeepSeekProvider, useValue: mockDeepSeek },
        { provide: KimiProvider, useValue: mockKimi },
      ],
    }).compile();

    service = module.get<LlmRouterService>(LlmRouterService);
    jest.clearAllMocks();
  });

  // ── selectProvider() ────────────────────────────

  describe('selectProvider', () => {
    it('should route whisper to DeepSeek (low latency)', () => {
      const provider = service.selectProvider('whisper');
      expect(provider.name).toBe('deepseek');
    });

    it('should route draft to Kimi (quality)', () => {
      const provider = service.selectProvider('draft');
      expect(provider.name).toBe('kimi');
    });

    it('should route predictive to DeepSeek (low latency)', () => {
      const provider = service.selectProvider('predictive');
      expect(provider.name).toBe('deepseek');
    });

    it('should route chat to DeepSeek (daily conversation)', () => {
      const provider = service.selectProvider('chat');
      expect(provider.name).toBe('deepseek');
    });

    it('should route complex_analysis to Kimi (complex)', () => {
      const provider = service.selectProvider('complex_analysis');
      expect(provider.name).toBe('kimi');
    });
  });

  // ── getFallbackProvider() ────────────────────────────

  describe('getFallbackProvider', () => {
    it('should fallback DeepSeek → Kimi', () => {
      const fallback = service.getFallbackProvider(mockDeepSeek as any);
      expect(fallback.name).toBe('kimi');
    });

    it('should fallback Kimi → DeepSeek', () => {
      const fallback = service.getFallbackProvider(mockKimi as any);
      expect(fallback.name).toBe('deepseek');
    });
  });

  // ── complete() ────────────────────────────

  describe('complete', () => {
    it('should complete with primary provider (chat → DeepSeek)', async () => {
      mockDeepSeek.complete.mockResolvedValue(mockDeepSeekResponse);

      const result = await service.complete(baseRequest);

      expect(result).toEqual(mockDeepSeekResponse);
      expect(mockDeepSeek.complete).toHaveBeenCalledTimes(1);
      expect(mockKimi.complete).not.toHaveBeenCalled();
    });

    it('should complete with primary provider (draft → Kimi)', async () => {
      mockKimi.complete.mockResolvedValue(mockKimiResponse);

      const result = await service.complete({
        ...baseRequest,
        taskType: 'draft',
      });

      expect(result).toEqual(mockKimiResponse);
      expect(mockKimi.complete).toHaveBeenCalledTimes(1);
      expect(mockDeepSeek.complete).not.toHaveBeenCalled();
    });

    it('should fallback to Kimi when DeepSeek fails', async () => {
      mockDeepSeek.complete.mockRejectedValue(new Error('DeepSeek timeout'));
      mockKimi.complete.mockResolvedValue(mockKimiResponse);

      const result = await service.complete(baseRequest);

      expect(result).toEqual(mockKimiResponse);
      expect(mockDeepSeek.complete).toHaveBeenCalledTimes(1);
      expect(mockKimi.complete).toHaveBeenCalledTimes(1);
    });

    it('should fallback to DeepSeek when Kimi fails', async () => {
      mockKimi.complete.mockRejectedValue(new Error('Kimi error'));
      mockDeepSeek.complete.mockResolvedValue(mockDeepSeekResponse);

      const result = await service.complete({
        ...baseRequest,
        taskType: 'draft',
      });

      expect(result).toEqual(mockDeepSeekResponse);
      expect(mockKimi.complete).toHaveBeenCalledTimes(1);
      expect(mockDeepSeek.complete).toHaveBeenCalledTimes(1);
    });

    it('should throw when both providers fail', async () => {
      mockDeepSeek.complete.mockRejectedValue(new Error('DeepSeek down'));
      mockKimi.complete.mockRejectedValue(new Error('Kimi down'));

      await expect(service.complete(baseRequest)).rejects.toThrow(
        /All LLM providers failed/,
      );

      expect(mockDeepSeek.complete).toHaveBeenCalledTimes(1);
      expect(mockKimi.complete).toHaveBeenCalledTimes(1);
    });

    it('should pass correct timeout to primary provider', async () => {
      mockDeepSeek.complete.mockResolvedValue(mockDeepSeekResponse);

      await service.complete(baseRequest);

      expect(mockDeepSeek.complete).toHaveBeenCalledWith(
        baseRequest,
        expect.objectContaining({ timeout: 3000 }),
      );
    });

    it('should pass fallback timeout when primary fails', async () => {
      mockDeepSeek.complete.mockRejectedValue(new Error('timeout'));
      mockKimi.complete.mockResolvedValue(mockKimiResponse);

      await service.complete(baseRequest);

      expect(mockKimi.complete).toHaveBeenCalledWith(
        baseRequest,
        expect.objectContaining({ timeout: 10000 }),
      );
    });
  });

  // ── stream() ────────────────────────────

  describe('stream', () => {
    it('should stream from primary provider', async () => {
      const chunks = [
        { content: 'Hello', done: false },
        { content: ' world', done: false },
        { content: '', done: true },
      ];

      mockDeepSeek.stream.mockImplementation(async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      });

      const collected: any[] = [];
      for await (const chunk of service.stream(baseRequest)) {
        collected.push(chunk);
      }

      expect(collected).toEqual(chunks);
      expect(mockDeepSeek.stream).toHaveBeenCalledTimes(1);
    });

    it('should route stream to correct provider based on taskType', async () => {
      mockKimi.stream.mockImplementation(async function* () {
        yield { content: 'Draft', done: false };
        yield { content: '', done: true };
      });

      const collected: any[] = [];
      for await (const chunk of service.stream({
        ...baseRequest,
        taskType: 'draft',
      })) {
        collected.push(chunk);
      }

      expect(collected).toHaveLength(2);
      expect(mockKimi.stream).toHaveBeenCalledTimes(1);
      expect(mockDeepSeek.stream).not.toHaveBeenCalled();
    });
  });
});
