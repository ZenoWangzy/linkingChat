import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService } from '../gateway/broadcast.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import type {
  TriggerSource,
  BotNotificationPayload,
  SupervisorRouteResult,
} from '@linkingchat/ws-protocol';

/** Rate limit window entry */
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * Bot Inter-communication Service
 *
 * Handles bot-to-bot message routing with:
 * - Trigger source labeling on Message.metadata
 * - Rate limiting: 5 calls/minute per bot pair
 * - Chain depth limiting: max 3 layers (A → B → C)
 * - Cycle detection: A → B → A blocked
 * - Supervisor coordination: intent-based bot recommendation
 */
@Injectable()
export class BotCommunicationService {
  private readonly logger = new Logger(BotCommunicationService.name);

  /** Rate limit: max calls per minute per bot pair */
  private readonly RATE_LIMIT_MAX = 5;
  private readonly RATE_LIMIT_WINDOW_MS = 60_000;

  /** Max chain depth for bot-to-bot calls */
  private readonly MAX_CHAIN_DEPTH = 3;

  /** In-memory rate limit tracker: "fromBotId->toBotId" → entry */
  private readonly rateLimits = new Map<string, RateLimitEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcastService: BroadcastService,
    private readonly llmRouter: LlmRouterService,
  ) {}

  /**
   * Send a cross-bot notification message.
   *
   * Bot A completes a task → notifies Bot B with a trigger-source-labeled message.
   * The message is persisted to Bot B's DM converse and pushed via WS.
   *
   * @param callChain - Array of botIds in the current call chain (for cycle/depth detection)
   */
  async sendBotMessage(params: {
    fromBotId: string;
    toBotId: string;
    userId: string;
    content: string;
    reason: string;
    callChain?: string[];
  }): Promise<{ messageId: string } | null> {
    const { fromBotId, toBotId, userId, content, reason } = params;
    const callChain = params.callChain ?? [fromBotId];

    // 1. Validate: cannot send to self
    if (fromBotId === toBotId) {
      this.logger.warn(`Bot ${fromBotId} attempted to message itself`);
      return null;
    }

    // 2. Cycle detection
    if (this.detectCycle(toBotId, callChain)) {
      this.logger.warn(
        `Cycle detected: ${[...callChain, toBotId].join(' → ')}`,
      );
      return null;
    }

    // 3. Chain depth check
    if (!this.checkChainDepth(callChain)) {
      this.logger.warn(
        `Chain depth exceeded (max ${this.MAX_CHAIN_DEPTH}): ${callChain.join(' → ')}`,
      );
      return null;
    }

    // 4. Rate limit check
    if (!this.checkRateLimit(fromBotId, toBotId)) {
      this.logger.warn(
        `Rate limit exceeded: ${fromBotId} → ${toBotId}`,
      );
      return null;
    }

    try {
      // 5. Look up both bots
      const [fromBot, toBot] = await Promise.all([
        this.prisma.bot.findFirst({ where: { id: fromBotId, ownerId: userId } }),
        this.prisma.bot.findFirst({ where: { id: toBotId, ownerId: userId } }),
      ]);

      if (!fromBot || !toBot) {
        this.logger.warn(
          `Bot not found: from=${fromBotId} (${!!fromBot}), to=${toBotId} (${!!toBot})`,
        );
        return null;
      }

      // 6. Find the target bot's DM converse with the user
      const targetConverse = await this.findBotDmConverse(toBot.userId, userId);
      if (!targetConverse) {
        this.logger.warn(
          `No DM converse found for bot ${toBotId} with user ${userId}`,
        );
        return null;
      }

      // 7. Build trigger source metadata
      const triggerSource: TriggerSource = {
        botId: fromBot.id,
        botName: fromBot.name,
        reason,
      };

      // 8. Persist the cross-bot notification message
      const message = await this.prisma.message.create({
        data: {
          content: `[来自 ${fromBot.name} 的协作]\n\n${content}`,
          type: 'BOT_NOTIFICATION',
          converseId: targetConverse.id,
          authorId: toBot.userId,
          metadata: { triggerSource } as any,
        },
      });

      // 9. WS push to user
      const payload: BotNotificationPayload = {
        messageId: message.id,
        converseId: targetConverse.id,
        fromBotId: fromBot.id,
        fromBotName: fromBot.name,
        toBotId: toBot.id,
        toBotName: toBot.name,
        content,
        triggerSource,
        createdAt: message.createdAt.toISOString(),
      };

      this.broadcastService.toRoom(
        `u-${userId}`,
        'bot:cross:notify',
        payload,
      );

      this.logger.log(
        `Cross-bot message: ${fromBot.name} → ${toBot.name} for user ${userId}`,
      );

      return { messageId: message.id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Bot communication failed (${fromBotId} → ${toBotId}): ${msg}`,
      );
      return null;
    }
  }

  /**
   * Supervisor coordination: analyze user intent and recommend the right bot.
   *
   * When user is unsure which bot to talk to, Supervisor analyzes the intent
   * and recommends the most suitable bot.
   */
  async routeViaSupervisor(params: {
    userId: string;
    userMessage: string;
  }): Promise<SupervisorRouteResult | null> {
    try {
      // 1. Fetch user's bots
      const bots = await this.prisma.bot.findMany({
        where: { ownerId: params.userId },
        select: { id: true, name: true, description: true, type: true },
      });

      if (bots.length === 0) return null;

      // 2. Build bot catalog for LLM
      const botCatalog = bots
        .map((b) => `- ${b.name} (${b.type}): ${b.description || 'No description'}`)
        .join('\n');

      // 3. Ask LLM to route
      const response = await this.llmRouter.complete({
        taskType: 'chat',
        systemPrompt: SUPERVISOR_ROUTE_PROMPT,
        messages: [
          {
            role: 'user',
            content: `可用的 Bot:\n${botCatalog}\n\n用户消息: ${params.userMessage}`,
          },
        ],
        maxTokens: 256,
        temperature: 0.3,
      });

      return this.parseRouteResult(response.content, bots);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Supervisor routing failed: ${msg}`);
      return null;
    }
  }

  /**
   * Check if a bot-to-bot call would form a cycle.
   */
  detectCycle(toBotId: string, callChain: string[]): boolean {
    return callChain.includes(toBotId);
  }

  /**
   * Check if the call chain depth is within limits.
   */
  checkChainDepth(callChain: string[]): boolean {
    return callChain.length <= this.MAX_CHAIN_DEPTH;
  }

  /**
   * Check and update rate limit for a bot pair.
   * Returns true if within limit, false if exceeded.
   */
  checkRateLimit(fromBotId: string, toBotId: string): boolean {
    const key = `${fromBotId}->${toBotId}`;
    const now = Date.now();

    const entry = this.rateLimits.get(key);

    if (!entry || now - entry.windowStart >= this.RATE_LIMIT_WINDOW_MS) {
      // New window
      this.rateLimits.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= this.RATE_LIMIT_MAX) {
      return false;
    }

    entry.count++;
    return true;
  }

  /**
   * Get current rate limit count for a bot pair (for testing/monitoring).
   */
  getRateLimitCount(fromBotId: string, toBotId: string): number {
    const key = `${fromBotId}->${toBotId}`;
    const entry = this.rateLimits.get(key);
    if (!entry) return 0;

    const now = Date.now();
    if (now - entry.windowStart >= this.RATE_LIMIT_WINDOW_MS) return 0;

    return entry.count;
  }

  /**
   * Reset all rate limits (for testing).
   */
  resetRateLimits(): void {
    this.rateLimits.clear();
  }

  /**
   * Find the DM converse between a bot user and a regular user.
   */
  private async findBotDmConverse(botUserId: string, userId: string) {
    return this.prisma.converse.findFirst({
      where: {
        type: 'DM',
        members: {
          every: {
            userId: { in: [botUserId, userId] },
          },
        },
      },
    });
  }

  /**
   * Parse LLM response for Supervisor routing.
   */
  parseRouteResult(
    content: string,
    bots: Array<{ id: string; name: string; description: string | null; type: string }>,
  ): SupervisorRouteResult | null {
    try {
      // Strip markdown code blocks if present (LLMs often wrap JSON in ```json...```)
      let cleaned = content.trim();
      const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
      }

      const parsed = JSON.parse(cleaned);
      const botName = parsed.botName || parsed.bot || parsed.recommended;

      if (!botName) return null;

      // Find matching bot by name (case-insensitive)
      const matchedBot = bots.find(
        (b) => b.name.toLowerCase() === String(botName).toLowerCase(),
      );

      if (!matchedBot) return null;

      return {
        recommendedBotId: matchedBot.id,
        recommendedBotName: matchedBot.name,
        confidence: Number(parsed.confidence) || 0.5,
        reason: String(parsed.reason || 'Based on intent analysis'),
      };
    } catch {
      // Fallback: try to match bot name from plain text
      const lowerContent = content.toLowerCase();
      for (const bot of bots) {
        if (lowerContent.includes(bot.name.toLowerCase())) {
          return {
            recommendedBotId: bot.id,
            recommendedBotName: bot.name,
            confidence: 0.3,
            reason: 'Matched from text analysis',
          };
        }
      }
      return null;
    }
  }
}

const SUPERVISOR_ROUTE_PROMPT = `你是 Supervisor Bot，负责分析用户意图并推荐最合适的 Bot。

输出格式（严格 JSON）：
{
  "botName": "推荐的 Bot 名称",
  "confidence": 0.8,
  "reason": "推荐原因"
}

要求：
- botName 必须是可用 Bot 列表中的名称
- confidence 范围 0-1
- reason 用中文简要说明
- 直接输出 JSON，不要包裹在 markdown 代码块中`;
