import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmOptions,
  LlmChunk,
} from './llm-provider.interface';

/**
 * Kimi (Moonshot) API 客户端
 *
 * 使用 OpenAI 兼容接口（/v1/chat/completions），
 * 适合高质量场景（draft 草稿生成、复杂分析）。
 */
@Injectable()
export class KimiProvider implements LlmProvider {
  readonly name = 'kimi';
  private readonly logger = new Logger(KimiProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('KIMI_API_KEY', '');
    this.baseUrl = this.configService.get<string>(
      'KIMI_BASE_URL',
      'https://api.moonshot.cn',
    );
    this.model = this.configService.get<string>(
      'KIMI_MODEL',
      'moonshot-v1-8k',
    );
  }

  async complete(
    request: LlmRequest,
    options?: LlmOptions,
  ): Promise<LlmResponse> {
    const controller = new AbortController();
    const timeout = options?.timeout ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeout);

    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const body = this.buildRequestBody(request, false);
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown');
        throw new Error(
          `Kimi API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const data = await response.json();
      return this.parseResponse(data);
    } finally {
      clearTimeout(timer);
    }
  }

  async *stream(
    request: LlmRequest,
    options?: LlmOptions,
  ): AsyncIterable<LlmChunk> {
    const controller = new AbortController();
    const timeout = options?.timeout ?? 60_000;
    const timer = setTimeout(() => controller.abort(), timeout);

    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const body = this.buildRequestBody(request, true);
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown');
        throw new Error(
          `Kimi API stream error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      if (!response.body) {
        throw new Error('Kimi API returned no body for stream');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { content: '', done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            const finishReason = parsed.choices?.[0]?.finish_reason;
            if (delta) {
              yield { content: delta, done: false };
            }
            if (finishReason === 'stop') {
              yield { content: '', done: true };
              return;
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private buildRequestBody(request: LlmRequest, stream: boolean) {
    const messages = [
      { role: 'system' as const, content: request.systemPrompt },
      ...request.messages,
    ];

    return {
      model: this.model,
      messages,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.7,
      stream,
    };
  }

  private parseResponse(data: any): LlmResponse {
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || '',
      provider: this.name,
      model: data.model || this.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
    };
  }
}
