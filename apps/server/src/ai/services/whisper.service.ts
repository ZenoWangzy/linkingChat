import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BroadcastService } from '../../gateway/broadcast.service';
import { LlmRouterService } from './llm-router.service';
import type { WhisperSuggestionsPayload } from '@linkingchat/ws-protocol';

/** Whisper 建议结构 */
interface WhisperSuggestions {
  primary: string;
  alternatives: string[];
}

/**
 * Whisper Service
 *
 * 用户发送 @ai → 提取聊天上下文 → LLM 生成建议 → WS 推送。
 * - 1 个主推荐 + 2 个备选
 * - 使用 DeepSeek（低延迟优先）
 * - 超时 2 秒后放弃
 */
@Injectable()
export class WhisperService {
  private readonly logger = new Logger(WhisperService.name);

  /** @ai 建议生成超时（毫秒） */
  private readonly WHISPER_TIMEOUT = 2_000;

  /** 上下文窗口大小（最近 N 条消息） */
  private readonly CONTEXT_WINDOW = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmRouter: LlmRouterService,
    private readonly broadcastService: BroadcastService,
  ) {}

  /**
   * 检测消息是否包含 @ai 触发词
   */
  isWhisperTrigger(content: string | null): boolean {
    if (!content) return false;
    return /(?<!\w)@ai\b/i.test(content);
  }

  /**
   * 处理 @ai 触发：生成建议并推送
   *
   * fire-and-forget，不阻塞消息发送
   */
  async handleWhisperTrigger(
    userId: string,
    converseId: string,
    messageId: string,
  ): Promise<void> {
    try {
      // 1. 提取上下文
      const context = await this.extractContext(converseId);

      // 2. 调用 LLM 生成建议（带超时）
      const suggestions = await this.generateSuggestions(context);
      if (!suggestions) {
        this.logger.warn(
          `Whisper timed out for message ${messageId} in converse ${converseId}`,
        );
        return;
      }

      // 3. 持久化
      const record = await this.prisma.aiSuggestion.create({
        data: {
          type: 'WHISPER',
          userId,
          converseId,
          messageId,
          suggestions: {
            primary: suggestions.primary,
            alternatives: suggestions.alternatives,
          },
        },
      });

      // 4. WS 推送到触发用户
      const payload: WhisperSuggestionsPayload = {
        suggestionId: record.id,
        converseId,
        messageId,
        primary: suggestions.primary,
        alternatives: suggestions.alternatives,
        createdAt: record.createdAt.toISOString(),
      };

      this.broadcastService.toRoom(
        `u-${userId}`,
        'ai:whisper:suggestions',
        payload,
      );

      this.logger.log(
        `Whisper suggestions sent to user ${userId} for message ${messageId}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Whisper failed for message ${messageId}: ${msg}`,
      );
    }
  }

  /**
   * 用户采纳建议
   */
  async acceptSuggestion(
    userId: string,
    suggestionId: string,
    selectedIndex: number,
  ): Promise<void> {
    await this.prisma.aiSuggestion.updateMany({
      where: {
        id: suggestionId,
        userId,
        status: 'PENDING',
      },
      data: {
        status: 'ACCEPTED',
        selectedIndex,
      },
    });

    this.logger.log(
      `Whisper suggestion ${suggestionId} accepted by ${userId} (index=${selectedIndex})`,
    );
  }

  /**
   * 提取聊天上下文（最近 N 条消息）
   */
  async extractContext(converseId: string): Promise<string> {
    const messages = await this.prisma.message.findMany({
      where: {
        converseId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: this.CONTEXT_WINDOW,
      include: {
        author: {
          select: { displayName: true },
        },
      },
    });

    // 按时间正序排列
    messages.reverse();

    return messages
      .map((m) => `${m.author.displayName}: ${m.content ?? ''}`)
      .join('\n');
  }

  /**
   * 调用 LLM 生成 1 主推荐 + 2 备选
   *
   * 返回 null 表示超时或失败
   */
  async generateSuggestions(
    context: string,
  ): Promise<WhisperSuggestions | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.WHISPER_TIMEOUT);

    try {
      const response = await this.llmRouter.complete({
        taskType: 'whisper',
        systemPrompt: WHISPER_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `以下是聊天记录:\n\n${context}\n\n请根据上下文生成 3 条回复建议。`,
          },
        ],
        maxTokens: 512,
        temperature: 0.8,
      });

      return this.parseSuggestions(response.content);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 解析 LLM 输出为结构化建议
   */
  parseSuggestions(content: string): WhisperSuggestions {
    // Try JSON parsing first
    try {
      const parsed = JSON.parse(content);
      if (parsed.primary && Array.isArray(parsed.alternatives)) {
        return {
          primary: String(parsed.primary),
          alternatives: parsed.alternatives.map(String).slice(0, 2),
        };
      }
    } catch {
      // Fall through to line-based parsing
    }

    // Line-based parsing: first non-empty line = primary, next 2 = alternatives
    const lines = content
      .split('\n')
      .map((l) => l.replace(/^[\d.)\-*]+\s*/, '').trim())
      .filter((l) => l.length > 0);

    return {
      primary: lines[0] || content.trim(),
      alternatives: lines.slice(1, 3),
    };
  }
}

const WHISPER_SYSTEM_PROMPT = `你是一个聊天助手。根据聊天上下文，为用户生成 3 条自然、得体的回复建议。

输出格式（严格 JSON）：
{
  "primary": "最推荐的回复",
  "alternatives": ["备选回复1", "备选回复2"]
}

要求：
- 回复要契合当前对话的语境和语气
- 简短有力（一般不超过 50 字）
- 3 条建议风格各异（例如：同意/中性/提问）
- 不要用 emoji
- 直接输出 JSON，不要包裹在 markdown 代码块中`;
