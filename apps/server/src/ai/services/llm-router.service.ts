import { Injectable, Logger } from '@nestjs/common';
import {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmChunk,
  LlmTaskType,
} from '../providers/llm-provider.interface';
import { DeepSeekProvider } from '../providers/deepseek.provider';
import { KimiProvider } from '../providers/kimi.provider';

/** 每次 LLM 调用的计量记录 */
export interface LlmCallMetrics {
  provider: string;
  model: string;
  taskType: LlmTaskType;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  success: boolean;
  fallback: boolean;
  error?: string;
}

/**
 * LLM Router Service
 *
 * 多供应商路由：根据 taskType 自动选择最佳 provider。
 * - whisper / predictive / chat → DeepSeek（低延迟优先）
 * - draft / complex_analysis → Kimi（质量优先）
 *
 * 降级逻辑：主 provider 超时/失败 → 自动切换备选。
 */
@Injectable()
export class LlmRouterService {
  private readonly logger = new Logger(LlmRouterService.name);
  private readonly providers: Map<string, LlmProvider>;

  /** 主 provider 超时时间（毫秒） */
  private readonly PRIMARY_TIMEOUT = 3_000;

  /** 降级 provider 超时时间（毫秒） */
  private readonly FALLBACK_TIMEOUT = 10_000;

  constructor(
    private readonly deepseek: DeepSeekProvider,
    private readonly kimi: KimiProvider,
  ) {
    this.providers = new Map<string, LlmProvider>([
      ['deepseek', deepseek],
      ['kimi', kimi],
    ]);
  }

  /**
   * 文本补全（自动路由 + 降级）
   */
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const primary = this.selectProvider(request.taskType);
    const startTime = Date.now();

    try {
      const response = await primary.complete(request, {
        timeout: this.PRIMARY_TIMEOUT,
      });

      this.logMetrics({
        provider: primary.name,
        model: response.model,
        taskType: request.taskType,
        durationMs: Date.now() - startTime,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        success: true,
        fallback: false,
      });

      return response;
    } catch (error) {
      const primaryDuration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Primary provider ${primary.name} failed for ${request.taskType} ` +
          `(${primaryDuration}ms): ${errorMessage}. Falling back...`,
      );

      this.logMetrics({
        provider: primary.name,
        model: '',
        taskType: request.taskType,
        durationMs: primaryDuration,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        success: false,
        fallback: false,
        error: errorMessage,
      });

      // 降级到备选 provider
      const fallback = this.getFallbackProvider(primary);
      const fallbackStart = Date.now();

      try {
        const response = await fallback.complete(request, {
          timeout: this.FALLBACK_TIMEOUT,
        });

        this.logMetrics({
          provider: fallback.name,
          model: response.model,
          taskType: request.taskType,
          durationMs: Date.now() - fallbackStart,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          success: true,
          fallback: true,
        });

        return response;
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);

        this.logMetrics({
          provider: fallback.name,
          model: '',
          taskType: request.taskType,
          durationMs: Date.now() - fallbackStart,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          success: false,
          fallback: true,
          error: fallbackMessage,
        });

        throw new Error(
          `All LLM providers failed for ${request.taskType}. ` +
            `Primary (${primary.name}): ${errorMessage}. ` +
            `Fallback (${fallback.name}): ${fallbackMessage}.`,
        );
      }
    }
  }

  /**
   * 流式补全（使用主 provider，无降级）
   *
   * 流式场景难以做自动降级（已发送的 chunk 无法回收），
   * 建议调用方自行 catch 后重试。
   */
  async *stream(request: LlmRequest): AsyncIterable<LlmChunk> {
    const provider = this.selectProvider(request.taskType);

    this.logger.log(
      `Stream: ${request.taskType} → ${provider.name}`,
    );

    yield* provider.stream(request, { timeout: 60_000 });
  }

  /**
   * 根据 taskType 选择主 provider
   */
  selectProvider(taskType: LlmTaskType): LlmProvider {
    switch (taskType) {
      case 'whisper':
        return this.deepseek; // 低延迟优先
      case 'draft':
        return this.kimi; // 质量优先
      case 'predictive':
        return this.deepseek; // 低延迟优先
      case 'chat':
        return this.deepseek; // 日常对话
      case 'complex_analysis':
        return this.kimi; // 复杂分析
      default:
        return this.deepseek;
    }
  }

  /**
   * 获取备选 provider（DeepSeek ↔ Kimi 互为备选）
   */
  getFallbackProvider(primary: LlmProvider): LlmProvider {
    return primary.name === 'deepseek' ? this.kimi : this.deepseek;
  }

  /**
   * 记录 LLM 调用计量日志
   */
  private logMetrics(metrics: LlmCallMetrics): void {
    const status = metrics.success ? 'OK' : 'FAIL';
    const fallbackLabel = metrics.fallback ? ' [FALLBACK]' : '';

    this.logger.log(
      `[LLM ${status}${fallbackLabel}] ` +
        `provider=${metrics.provider} task=${metrics.taskType} ` +
        `duration=${metrics.durationMs}ms ` +
        `tokens=${metrics.totalTokens} ` +
        `(prompt=${metrics.promptTokens} completion=${metrics.completionTokens})` +
        (metrics.error ? ` error="${metrics.error}"` : ''),
    );
  }
}
