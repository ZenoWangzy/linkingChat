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

  /** @mention 正则：支持英文、数字、下划线、中文 */
  private readonly MENTION_REGEX = /@([a-zA-Z0-9_\u4e00-\u9fa5]{2,20})/g;

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
}
