import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhisperService } from '../ai/services/whisper.service';
import { AgentOrchestratorService } from '../agents/orchestrator/agent-orchestrator.service';
import type { ParsedMention, ValidMention } from './interfaces/mention.interface';

/**
 * Mention Service
 *
 * 处理群聊中的 @mention 解析、验证和路由
 * - @BotName → 路由到对应 Bot Agent
 * - @ai → 路由到 Supervisor (WhisperService)
 */
@Injectable()
export class MentionService {
  private readonly logger = new Logger(MentionService.name);

  /**
   * @mention 正则：支持英文、数字、下划线、中文
   * 使用负向回顾断言 (?<![a-zA-Z0-9]) 排除 email 地址
   */
  private readonly MENTION_REGEX = /(?<![a-zA-Z0-9])@([a-zA-Z0-9_\u4e00-\u9fa5]{2,20})/g;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whisperService: WhisperService,
    private readonly agentOrchestrator: AgentOrchestratorService,
  ) {}

  /**
   * 解析消息中的 @mentions
   *
   * @param content - 消息内容
   * @returns 解析后的 mention 列表（已去重）
   */
  parse(content: string | null): ParsedMention[] {
    if (!content) return [];

    const mentions: ParsedMention[] = [];
    let match: RegExpExecArray | null;

    while ((match = this.MENTION_REGEX.exec(content)) !== null) {
      mentions.push({
        name: match[1],
        fullMatch: match[0],
        startIndex: match.index,
      });
    }

    return this.deduplicate(mentions);
  }

  /**
   * 去重：同一名称只保留第一次出现
   */
  private deduplicate(mentions: ParsedMention[]): ParsedMention[] {
    const seen = new Set<string>();
    return mentions.filter((m) => {
      if (seen.has(m.name)) return false;
      seen.add(m.name);
      return true;
    });
  }

  /**
   * 验证 @mentions 并获取对应的 Bot 信息
   *
   * @param mentions - 解析后的 mentions
   * @param _converseId - 会话 ID（用于未来可能的权限检查）
   * @returns 验证后的有效 mentions
   */
  async validate(
    mentions: ParsedMention[],
    _converseId: string,
  ): Promise<ValidMention[]> {
    if (mentions.length === 0) return [];

    const validMentions: ValidMention[] = [];

    // 1. 特殊处理 @ai
    const aiMention = mentions.find((m) => m.name.toLowerCase() === 'ai');
    if (aiMention) {
      validMentions.push({
        type: 'ai',
        name: 'ai',
        fullMatch: aiMention.fullMatch,
      });
    }

    // 2. 查询存在的 Bot
    const botNames = mentions
      .filter((m) => m.name.toLowerCase() !== 'ai')
      .map((m) => m.name);

    if (botNames.length > 0) {
      const bots = await this.prisma.bot.findMany({
        where: {
          name: { in: botNames },
        },
      });

      for (const bot of bots) {
        validMentions.push({
          type: 'bot',
          name: bot.name,
          fullMatch: `@${bot.name}`,
          botId: bot.id,
          userId: bot.userId,
        });
      }
    }

    return validMentions;
  }

  /**
   * 路由 @mentions 到对应的处理器
   *
   * @param mentions - 验证后的 mentions
   * @param message - 原始消息对象
   * @param senderId - 发送者 ID
   * @param converseId - 会话 ID
   */
  async route(
    mentions: ValidMention[],
    message: { id: string; content: string | null; converseId: string },
    senderId: string,
    converseId: string,
  ): Promise<void> {
    for (const mention of mentions) {
      try {
        switch (mention.type) {
          case 'bot':
            await this.routeToBot(mention, message, senderId, converseId);
            break;
          case 'ai':
            await this.routeToSupervisor(senderId, converseId, message.id);
            break;
        }
      } catch (error) {
        this.logger.error(
          `Failed to route mention ${mention.fullMatch}: ${error}`,
        );
      }
    }
  }

  /**
   * 路由到 Bot Agent
   */
  private async routeToBot(
    mention: ValidMention,
    message: { id: string; content: string | null; converseId: string },
    senderId: string,
    converseId: string,
  ): Promise<void> {
    if (!mention.botId) return;

    const event = {
      type: 'USER_MESSAGE' as const,
      payload: {
        userId: senderId,
        content: message.content || '',
        converseId,
      },
      timestamp: new Date(),
      source: {
        userId: senderId,
        botId: mention.botId,
      },
    };

    await this.agentOrchestrator.dispatchEvent(mention.botId, [event]);

    this.logger.log(
      `Routed @${mention.name} to bot ${mention.botId} for message ${message.id}`,
    );
  }

  /**
   * 路由到 Supervisor (@ai)
   */
  private async routeToSupervisor(
    senderId: string,
    converseId: string,
    messageId: string,
  ): Promise<void> {
    await this.whisperService.handleWhisperTrigger(
      senderId,
      converseId,
      messageId,
    );

    this.logger.log(
      `Routed @ai to WhisperService for message ${messageId}`,
    );
  }
}
