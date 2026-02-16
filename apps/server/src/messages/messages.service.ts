import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService } from '../gateway/broadcast.service';
import { ConversesService } from '../converses/converses.service';
import { WhisperService } from '../ai/services/whisper.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';

// 标准 author select，复用于所有消息查询
const AUTHOR_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcastService: BroadcastService,
    private readonly conversesService: ConversesService,
    private readonly whisperService: WhisperService,
  ) {}

  /**
   * 创建消息 — REST handler 调用
   *
   * 流程：
   * 1. 校验用户是 converse 成员
   * 2. 插入消息记录
   * 3. 更新所有成员的 lastMessageId + converse.updatedAt
   * 4. 广播 message:new 到 {converseId} 房间
   * 5. 对不在房间的成员广播 notification:new 到 u-{userId}
   */
  async create(userId: string, dto: CreateMessageDto) {
    // 1. 校验成员身份
    await this.conversesService.verifyMembership(dto.converseId, userId);

    // 2. 如果有 replyToId，校验引用消息存在且属于同一会话
    if (dto.replyToId) {
      const replyTarget = await this.prisma.message.findUnique({
        where: { id: dto.replyToId },
      });
      if (!replyTarget || replyTarget.converseId !== dto.converseId) {
        throw new NotFoundException(
          'Reply target message not found in this conversation',
        );
      }
    }

    // 3. 插入消息
    const message = await this.prisma.message.create({
      data: {
        content: dto.content,
        type: dto.type ?? 'TEXT',
        authorId: userId,
        converseId: dto.converseId,
        replyToId: dto.replyToId ?? null,
      },
      include: {
        author: { select: AUTHOR_SELECT },
      },
    });

    // 4. 更新所有成员的 lastMessageId + 更新 converse.updatedAt
    await this.prisma.$transaction([
      this.prisma.converseMember.updateMany({
        where: { converseId: dto.converseId },
        data: { lastMessageId: message.id },
      }),
      this.prisma.converse.update({
        where: { id: dto.converseId },
        data: { updatedAt: new Date() },
      }),
    ]);

    // 5. 广播 message:new 到 {converseId} 房间
    const messagePayload = {
      id: message.id,
      content: message.content,
      type: message.type,
      author: message.author,
      converseId: message.converseId,
      replyToId: message.replyToId,
      metadata: message.metadata,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    };

    this.broadcastService.toRoom(
      dto.converseId,
      'message:new',
      messagePayload,
    );

    // 6. 对不在 {converseId} 房间的成员发送 notification:new
    const memberIds = await this.conversesService.getMemberIds(dto.converseId);
    for (const memberId of memberIds) {
      if (memberId === userId) continue; // 不通知发送者自己
      this.broadcastService.toRoomIfNotIn(
        `u-${memberId}`, // 目标：个人房间
        dto.converseId, // 条件：不在此会话房间内
        'notification:new',
        {
          converseId: dto.converseId,
          messageId: message.id,
          content: message.content,
          author: message.author,
          createdAt: message.createdAt.toISOString(),
        },
      );
    }

    this.logger.log(
      `Message created: ${message.id} in converse ${dto.converseId} by ${userId}`,
    );

    // 7. 检测收件人是否为 Bot（fire-and-forget，不阻塞消息返回）
    this.detectBotRecipient(userId, dto.converseId, message).catch((err) =>
      this.logger.error(`detectBotRecipient failed: ${err.message}`, err.stack),
    );

    // 8. 检测 @ai 触发词（fire-and-forget）
    if (this.whisperService.isWhisperTrigger(message.content)) {
      this.whisperService
        .handleWhisperTrigger(userId, dto.converseId, message.id)
        .catch((err) =>
          this.logger.error(`whisper trigger failed: ${err.message}`, err.stack),
        );
    }

    return message;
  }

  /**
   * 游标分页查询消息历史
   *
   * @param userId     - 当前用户 ID（用于校验成员身份）
   * @param converseId - 会话 ID
   * @param cursor     - ISO 8601 时间戳游标，获取此时间之前的消息
   * @param limit      - 每页条数，默认 35
   * @returns          - { messages: Message[], hasMore: boolean, nextCursor: string | null }
   */
  async findByConverse(
    userId: string,
    converseId: string,
    cursor?: string,
    limit = 35,
  ) {
    // 1. 校验成员身份
    await this.conversesService.verifyMembership(converseId, userId);

    // 2. 查询 limit + 1 条，多查 1 条判断是否还有更多
    const messages = await this.prisma.message.findMany({
      where: {
        converseId,
        deletedAt: null,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        author: { select: AUTHOR_SELECT },
      },
    });

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop(); // 移除多查的 1 条
    }

    const nextCursor = hasMore
      ? messages[messages.length - 1].createdAt.toISOString()
      : null;

    return {
      messages,
      hasMore,
      nextCursor,
    };
  }

  /**
   * 编辑消息 — 仅作者可操作
   */
  async update(userId: string, messageId: string, dto: UpdateMessageDto) {
    // 1. 查找消息
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.deletedAt) {
      throw new NotFoundException('Message has been deleted');
    }

    // 2. 校验作者身份
    if (message.authorId !== userId) {
      throw new ForbiddenException('Only the author can edit this message');
    }

    // 3. 更新消息
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        content: dto.content,
        updatedAt: new Date(),
      },
      include: {
        author: { select: AUTHOR_SELECT },
      },
    });

    // 4. 广播 message:updated
    this.broadcastService.toRoom(message.converseId, 'message:updated', {
      id: updated.id,
      content: updated.content,
      converseId: updated.converseId,
      updatedAt: updated.updatedAt.toISOString(),
    });

    this.logger.log(
      `Message updated: ${messageId} in converse ${message.converseId}`,
    );

    return updated;
  }

  /**
   * 软删除消息（撤回）
   */
  async softDelete(userId: string, messageId: string) {
    // 1. 查找消息
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.deletedAt) {
      throw new NotFoundException('Message already deleted');
    }

    // 2. 校验作者身份
    if (message.authorId !== userId) {
      throw new ForbiddenException('Only the author can delete this message');
    }

    // 3. 软删除
    const deleted = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    // 4. 广播 message:deleted
    this.broadcastService.toRoom(message.converseId, 'message:deleted', {
      id: deleted.id,
      converseId: deleted.converseId,
      deletedAt: deleted.deletedAt!.toISOString(),
    });

    this.logger.log(
      `Message soft-deleted: ${messageId} in converse ${message.converseId}`,
    );

    return { id: deleted.id, deleted: true };
  }

  /**
   * 检测消息收件人是否为 Bot
   *
   * Sprint 2: 仅记录日志
   * Sprint 3: 路由到 AI pipeline 生成回复
   */
  private async detectBotRecipient(
    senderId: string,
    converseId: string,
    message: { id: string; content: string | null; type: string },
  ): Promise<void> {
    const otherMembers = await this.prisma.converseMember.findMany({
      where: {
        converseId,
        userId: { not: senderId },
      },
    });

    for (const member of otherMembers) {
      const bot = await this.prisma.bot.findUnique({
        where: { userId: member.userId },
      });

      if (bot) {
        this.logger.log(
          `[Bot] Message to ${bot.name} (${bot.id}): ` +
            `type=${message.type}, content="${(message.content ?? '').substring(0, 100)}"`,
        );

        // Sprint 3 TODO: 将消息路由到 AI pipeline
        // await this.botPipelineService.processMessage(bot, message);
      }
    }
  }
}
