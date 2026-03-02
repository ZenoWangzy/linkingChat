import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService } from '../gateway/broadcast.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AddMembersDto } from './dto/add-members.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { CHAT_EVENTS } from '@linkingchat/ws-protocol';

const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  status: true,
} as const;

@Injectable()
export class ConversesService {
  private readonly logger = new Logger(ConversesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcastService: BroadcastService,
  ) {}

  /**
   * 查询用户的所有打开会话
   * 包含：会话成员信息、最后一条消息预览、未读计数、Bot 识别
   * 过滤 deletedAt IS NOT NULL 的群组
   */
  async findUserConverses(userId: string) {
    const members = await this.prisma.converseMember.findMany({
      where: { userId, isOpen: true },
      include: {
        converse: {
          include: {
            members: {
              include: {
                user: {
                  select: USER_SELECT,
                },
              },
            },
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              where: { deletedAt: null },
              include: {
                author: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                  },
                },
              },
            },
            _count: {
              select: { members: true },
            },
          },
        },
      },
      orderBy: { converse: { updatedAt: 'desc' } },
    });

    // Filter out soft-deleted groups
    const activeMembers = members.filter(
      (m) => m.converse.deletedAt === null,
    );

    // 收集所有"对方成员" userId，批量查询 Bot 表
    const otherUserIds = activeMembers
      .flatMap((m) =>
        m.converse.members
          .filter((cm) => cm.userId !== userId)
          .map((cm) => cm.userId),
      )
      .filter((id, i, arr) => arr.indexOf(id) === i); // dedupe

    const bots = await this.prisma.bot.findMany({
      where: { userId: { in: otherUserIds } },
      select: { id: true, name: true, type: true, isPinned: true, userId: true },
    });
    const botByUserId = new Map(bots.map((b) => [b.userId, b]));

    // 构建响应并附加 Bot 信息
    const converses = await Promise.all(
      activeMembers.map(async (member) => {
        const unreadCount = await this.getUnreadCount(
          member.converseId,
          userId,
          member.lastSeenMessageId,
        );

        // 查找对方成员是否为 Bot
        const otherMember = member.converse.members.find(
          (cm) => cm.userId !== userId,
        );
        const bot = otherMember ? botByUserId.get(otherMember.userId) : null;

        return {
          id: member.converse.id,
          type: member.converse.type,
          name: member.converse.name,
          description: member.converse.description,
          avatarUrl: member.converse.avatarUrl,
          creatorId: member.converse.creatorId,
          memberCount:
            member.converse.type === 'GROUP'
              ? member.converse._count.members
              : undefined,
          members: member.converse.members.map((m) => ({
            userId: m.userId,
            ...m.user,
            role: m.role,
            isOpen: m.isOpen,
            mutedUntil: m.mutedUntil?.toISOString() ?? null,
          })),
          lastMessage: member.converse.messages[0] ?? null,
          unreadCount,
          createdAt: member.converse.createdAt,
          updatedAt: member.converse.updatedAt,
          isBot: !!bot,
          isPinned: bot?.isPinned ?? false,
          botInfo: bot
            ? { id: bot.id, name: bot.name, type: bot.type }
            : null,
        };
      }),
    );

    // 排序：isPinned 的 Bot 会话置顶，其余保持原有排序（按最后消息时间）
    return converses.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return 0;
    });
  }

  /**
   * 校验用户是否为会话成员
   * 多处复用：发消息、加入房间、编辑消息等
   */
  async verifyMembership(converseId: string, userId: string) {
    const member = await this.prisma.converseMember.findUnique({
      where: {
        converseId_userId: { converseId, userId },
      },
    });

    if (!member) {
      throw new ForbiddenException('Not a member of this conversation');
    }

    return member;
  }

  /**
   * 获取会话的所有成员 userId 列表
   */
  async getMemberIds(converseId: string): Promise<string[]> {
    const members = await this.prisma.converseMember.findMany({
      where: { converseId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  /**
   * 计算未读消息数（公开版本 — 自动查找 lastSeenMessageId）
   */
  async getUnreadCount(converseId: string, userId: string): Promise<number>;
  /**
   * 计算未读消息数（内部版本 — 接受已知的 lastSeenMessageId）
   */
  async getUnreadCount(
    converseId: string,
    userId: string,
    lastSeenMessageId: string | null,
  ): Promise<number>;
  async getUnreadCount(
    converseId: string,
    userId: string,
    lastSeenMessageId?: string | null,
  ): Promise<number> {
    // 如果没有传入 lastSeenMessageId，从 DB 中查找
    if (lastSeenMessageId === undefined) {
      const member = await this.prisma.converseMember.findUnique({
        where: { converseId_userId: { converseId, userId } },
        select: { lastSeenMessageId: true },
      });
      if (!member) return 0;
      lastSeenMessageId = member.lastSeenMessageId;
    }

    if (!lastSeenMessageId) {
      return this.prisma.message.count({
        where: {
          converseId,
          authorId: { not: userId },
          deletedAt: null,
        },
      });
    }

    const lastSeenMessage = await this.prisma.message.findUnique({
      where: { id: lastSeenMessageId },
      select: { createdAt: true },
    });

    if (!lastSeenMessage) {
      return this.prisma.message.count({
        where: {
          converseId,
          authorId: { not: userId },
          deletedAt: null,
        },
      });
    }

    return this.prisma.message.count({
      where: {
        converseId,
        authorId: { not: userId },
        deletedAt: null,
        createdAt: { gt: lastSeenMessage.createdAt },
      },
    });
  }

  // ──────────────────────────────────────
  // Group CRUD Methods
  // ──────────────────────────────────────

  /**
   * 创建群组
   */
  async createGroup(userId: string, dto: CreateGroupDto) {
    // Dedupe memberIds and ensure creator is not in the list
    const uniqueMemberIds = [...new Set(dto.memberIds)].filter(
      (id) => id !== userId,
    );

    // Verify all members exist
    const existingUsers = await this.prisma.user.findMany({
      where: { id: { in: uniqueMemberIds }, deletedAt: null },
      select: { id: true },
    });
    if (existingUsers.length !== uniqueMemberIds.length) {
      throw new BadRequestException('One or more member IDs are invalid');
    }

    // Create converse + members in transaction
    const converse = await this.prisma.$transaction(async (tx) => {
      const conv = await tx.converse.create({
        data: {
          type: 'GROUP',
          name: dto.name,
          description: dto.description,
          creatorId: userId,
          members: {
            create: [
              { userId, role: 'OWNER' },
              ...uniqueMemberIds.map((id) => ({
                userId: id,
                role: 'MEMBER' as const,
              })),
            ],
          },
        },
        include: {
          members: {
            include: {
              user: { select: USER_SELECT },
            },
          },
        },
      });
      return conv;
    });

    const payload = {
      id: converse.id,
      name: converse.name,
      description: converse.description,
      creatorId: converse.creatorId,
      members: converse.members.map((m) => ({
        userId: m.userId,
        username: m.user.username,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        role: m.role!,
      })),
      createdAt: converse.createdAt.toISOString(),
    };

    // Broadcast to each member's personal room
    const allMemberIds = [userId, ...uniqueMemberIds];
    this.broadcastService.listcast(
      allMemberIds,
      CHAT_EVENTS.GROUP_CREATED,
      payload,
    );

    this.logger.log(
      `Group created: ${converse.id} by ${userId} with ${uniqueMemberIds.length} members`,
    );

    return converse;
  }

  /**
   * 更新群组信息（OWNER/ADMIN only）
   */
  async updateGroup(userId: string, converseId: string, dto: UpdateGroupDto) {
    await this.requireGroupRole(converseId, userId, ['OWNER', 'ADMIN']);

    const converse = await this.prisma.converse.update({
      where: { id: converseId },
      data: {
        name: dto.name,
        description: dto.description,
        avatarUrl: dto.avatarUrl,
      },
    });

    const payload = {
      id: converse.id,
      name: converse.name,
      description: converse.description,
      avatarUrl: converse.avatarUrl,
      updatedAt: converse.updatedAt.toISOString(),
    };

    this.broadcastService.toRoom(
      converseId,
      CHAT_EVENTS.GROUP_UPDATED,
      payload,
    );

    this.logger.log(`Group updated: ${converseId} by ${userId}`);
    return converse;
  }

  /**
   * 删除群组（OWNER only，软删除）
   */
  async deleteGroup(userId: string, converseId: string) {
    await this.requireGroupRole(converseId, userId, ['OWNER']);

    const now = new Date();
    await this.prisma.converse.update({
      where: { id: converseId },
      data: { deletedAt: now },
    });

    const payload = {
      id: converseId,
      deletedAt: now.toISOString(),
    };

    this.broadcastService.toRoom(
      converseId,
      CHAT_EVENTS.GROUP_DELETED,
      payload,
    );

    this.logger.log(`Group deleted: ${converseId} by ${userId}`);
    return { id: converseId, deleted: true };
  }

  /**
   * 添加成员到群组（OWNER/ADMIN only）
   */
  async addMembers(userId: string, converseId: string, dto: AddMembersDto) {
    await this.requireGroupRole(converseId, userId, ['OWNER', 'ADMIN']);

    const converse = await this.prisma.converse.findUnique({
      where: { id: converseId },
      select: { maxMembers: true, deletedAt: true },
    });
    if (!converse || converse.deletedAt) {
      throw new NotFoundException('Group not found');
    }

    // Check existing members to prevent duplicates
    const existingMembers = await this.prisma.converseMember.findMany({
      where: { converseId },
      select: { userId: true },
    });
    const existingIds = new Set(existingMembers.map((m) => m.userId));

    const newMemberIds = [...new Set(dto.memberIds)].filter(
      (id) => !existingIds.has(id),
    );

    if (newMemberIds.length === 0) {
      throw new BadRequestException('All users are already members');
    }

    // Check max members
    if (existingMembers.length + newMemberIds.length > converse.maxMembers) {
      throw new BadRequestException(
        `Group cannot exceed ${converse.maxMembers} members`,
      );
    }

    // Verify all new members exist
    const existingUsers = await this.prisma.user.findMany({
      where: { id: { in: newMemberIds }, deletedAt: null },
      select: { id: true },
    });
    if (existingUsers.length !== newMemberIds.length) {
      throw new BadRequestException('One or more member IDs are invalid');
    }

    // Phase 9: 检查是否被封禁
    const bannedUsers = await this.prisma.groupBan.findMany({
      where: { converseId, userId: { in: newMemberIds } },
      select: { userId: true },
    });
    if (bannedUsers.length > 0) {
      const bannedIds = bannedUsers.map((b) => b.userId);
      throw new BadRequestException(
        `Users are banned from this group: ${bannedIds.join(', ')}`,
      );
    }

    // Create member records
    await this.prisma.converseMember.createMany({
      data: newMemberIds.map((id) => ({
        converseId,
        userId: id,
        role: 'MEMBER' as const,
      })),
    });

    // Fetch newly added members with user info for broadcast
    const addedMembers = await this.prisma.converseMember.findMany({
      where: { converseId, userId: { in: newMemberIds } },
      include: { user: { select: USER_SELECT } },
    });

    const payload = {
      converseId,
      members: addedMembers.map((m) => ({
        userId: m.userId,
        username: m.user.username,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        role: m.role!,
      })),
    };

    // Broadcast to existing members via converse room
    this.broadcastService.toRoom(
      converseId,
      CHAT_EVENTS.GROUP_MEMBER_ADDED,
      payload,
    );

    // Also notify new members via their personal rooms
    this.broadcastService.listcast(
      newMemberIds,
      CHAT_EVENTS.GROUP_MEMBER_ADDED,
      payload,
    );

    this.logger.log(
      `Members added to group ${converseId}: ${newMemberIds.join(', ')}`,
    );

    return { added: newMemberIds.length };
  }

  /**
   * 移除群组成员
   * 权限矩阵：OWNER 可移除任何人，ADMIN 可移除 MEMBER
   */
  async removeMember(
    userId: string,
    converseId: string,
    memberId: string,
  ) {
    if (userId === memberId) {
      throw new BadRequestException('Use leaveGroup to leave');
    }

    const actor = await this.requireGroupRole(converseId, userId, [
      'OWNER',
      'ADMIN',
    ]);
    const target = await this.prisma.converseMember.findUnique({
      where: { converseId_userId: { converseId, userId: memberId } },
    });

    if (!target) {
      throw new NotFoundException('Member not found');
    }

    // ADMIN cannot remove OWNER or other ADMIN
    if (actor.role === 'ADMIN' && target.role !== 'MEMBER') {
      throw new ForbiddenException('Admin can only remove regular members');
    }

    await this.prisma.converseMember.delete({
      where: { converseId_userId: { converseId, userId: memberId } },
    });

    const payload = {
      converseId,
      userId: memberId,
      removedBy: userId,
    };

    this.broadcastService.toRoom(
      converseId,
      CHAT_EVENTS.GROUP_MEMBER_REMOVED,
      payload,
    );
    // Also notify the removed member directly
    this.broadcastService.unicast(
      memberId,
      CHAT_EVENTS.GROUP_MEMBER_REMOVED,
      payload,
    );

    this.logger.log(
      `Member ${memberId} removed from group ${converseId} by ${userId}`,
    );

    return { removed: true };
  }

  /**
   * 离开群组
   * 如果 OWNER 离开：自动将 OWNER 转移给最早加入的成员
   */
  async leaveGroup(userId: string, converseId: string) {
    const member = await this.prisma.converseMember.findUnique({
      where: { converseId_userId: { converseId, userId } },
    });

    if (!member) {
      throw new ForbiddenException('Not a member of this group');
    }

    const converse = await this.prisma.converse.findUnique({
      where: { id: converseId },
      select: { type: true, deletedAt: true },
    });
    if (!converse || converse.type !== 'GROUP' || converse.deletedAt) {
      throw new NotFoundException('Group not found');
    }

    if (member.role === 'OWNER') {
      // Find next owner: earliest joined member excluding self
      const nextOwner = await this.prisma.converseMember.findFirst({
        where: { converseId, userId: { not: userId } },
        orderBy: { joinedAt: 'asc' },
      });

      if (!nextOwner) {
        // Last member — soft-delete the group
        await this.prisma.$transaction([
          this.prisma.converseMember.delete({
            where: { converseId_userId: { converseId, userId } },
          }),
          this.prisma.converse.update({
            where: { id: converseId },
            data: { deletedAt: new Date() },
          }),
        ]);

        this.broadcastService.unicast(userId, CHAT_EVENTS.GROUP_DELETED, {
          id: converseId,
          deletedAt: new Date().toISOString(),
        });

        this.logger.log(
          `Last member ${userId} left group ${converseId}, group deleted`,
        );
        return { left: true, groupDeleted: true };
      }

      // Transfer ownership in transaction
      await this.prisma.$transaction([
        this.prisma.converseMember.update({
          where: {
            converseId_userId: { converseId, userId: nextOwner.userId },
          },
          data: { role: 'OWNER' },
        }),
        this.prisma.converseMember.delete({
          where: { converseId_userId: { converseId, userId } },
        }),
      ]);

      // Broadcast role change for new owner
      this.broadcastService.toRoom(
        converseId,
        CHAT_EVENTS.GROUP_MEMBER_ROLE_UPDATED,
        {
          converseId,
          userId: nextOwner.userId,
          role: 'OWNER',
          updatedBy: userId,
        },
      );
    } else {
      await this.prisma.converseMember.delete({
        where: { converseId_userId: { converseId, userId } },
      });
    }

    // Broadcast member removal
    this.broadcastService.toRoom(
      converseId,
      CHAT_EVENTS.GROUP_MEMBER_REMOVED,
      {
        converseId,
        userId,
        removedBy: userId,
      },
    );

    this.logger.log(`Member ${userId} left group ${converseId}`);
    return { left: true };
  }

  /**
   * 更新成员角色（OWNER only）
   */
  async updateMemberRole(
    userId: string,
    converseId: string,
    memberId: string,
    dto: UpdateMemberRoleDto,
  ) {
    await this.requireGroupRole(converseId, userId, ['OWNER']);

    if (userId === memberId) {
      throw new BadRequestException('Cannot change your own role');
    }

    const target = await this.prisma.converseMember.findUnique({
      where: { converseId_userId: { converseId, userId: memberId } },
    });

    if (!target) {
      throw new NotFoundException('Member not found');
    }

    await this.prisma.converseMember.update({
      where: { converseId_userId: { converseId, userId: memberId } },
      data: { role: dto.role },
    });

    const payload = {
      converseId,
      userId: memberId,
      role: dto.role,
      updatedBy: userId,
    };

    this.broadcastService.toRoom(
      converseId,
      CHAT_EVENTS.GROUP_MEMBER_ROLE_UPDATED,
      payload,
    );

    this.logger.log(
      `Member ${memberId} role updated to ${dto.role} in group ${converseId}`,
    );

    return { updated: true };
  }

  // ──────────────────────────────────────
  // Phase 9: 禁言与封禁
  // ──────────────────────────────────────

  /**
   * 禁言群成员
   * 权限矩阵：OWNER/ADMIN 可禁言 MEMBER，OWNER 可禁言 ADMIN
   */
  async muteMember(
    userId: string,
    converseId: string,
    memberId: string,
    durationMinutes: number,
  ) {
    if (userId === memberId) {
      throw new BadRequestException('Cannot mute yourself');
    }

    const actor = await this.requireGroupRole(converseId, userId, [
      'OWNER',
      'ADMIN',
    ]);
    const target = await this.prisma.converseMember.findUnique({
      where: { converseId_userId: { converseId, userId: memberId } },
    });

    if (!target) {
      throw new NotFoundException('Member not found');
    }

    // ADMIN 不能禁言 OWNER 或其他 ADMIN
    if (actor.role === 'ADMIN' && target.role !== 'MEMBER') {
      throw new ForbiddenException('Admin can only mute regular members');
    }

    const mutedUntil = new Date(Date.now() + durationMinutes * 60 * 1000);

    await this.prisma.converseMember.update({
      where: { converseId_userId: { converseId, userId: memberId } },
      data: { mutedUntil },
    });

    const payload = {
      converseId,
      userId: memberId,
      mutedBy: userId,
      mutedUntil: mutedUntil.toISOString(),
      durationMinutes,
    };

    // 广播到群房间
    this.broadcastService.toRoom(
      converseId,
      CHAT_EVENTS.GROUP_MEMBER_MUTED,
      payload,
    );

    // 同时通知被禁言的用户
    this.broadcastService.unicast(
      memberId,
      CHAT_EVENTS.GROUP_MEMBER_MUTED,
      payload,
    );

    this.logger.log(
      `Member ${memberId} muted in group ${converseId} by ${userId} for ${durationMinutes} minutes`,
    );

    return { mutedUntil: mutedUntil.toISOString() };
  }

  /**
   * 解除禁言
   */
  async unmuteMember(
    userId: string,
    converseId: string,
    memberId: string,
  ) {
    await this.requireGroupRole(converseId, userId, ['OWNER', 'ADMIN']);

    const target = await this.prisma.converseMember.findUnique({
      where: { converseId_userId: { converseId, userId: memberId } },
    });

    if (!target) {
      throw new NotFoundException('Member not found');
    }

    await this.prisma.converseMember.update({
      where: { converseId_userId: { converseId, userId: memberId } },
      data: { mutedUntil: null },
    });

    const payload = {
      converseId,
      userId: memberId,
      unmutedBy: userId,
    };

    this.broadcastService.toRoom(
      converseId,
      CHAT_EVENTS.GROUP_MEMBER_UNMUTED,
      payload,
    );

    this.broadcastService.unicast(
      memberId,
      CHAT_EVENTS.GROUP_MEMBER_UNMUTED,
      payload,
    );

    this.logger.log(
      `Member ${memberId} unmuted in group ${converseId} by ${userId}`,
    );

    return { success: true };
  }

  /**
   * 封禁群成员（自动踢出 + 黑名单）
   * 权限矩阵：OWNER/ADMIN 可封禁 MEMBER，OWNER 可封禁 ADMIN
   */
  async banMember(
    userId: string,
    converseId: string,
    targetUserId: string,
    reason?: string,
  ) {
    if (userId === targetUserId) {
      throw new BadRequestException('Cannot ban yourself');
    }

    const actor = await this.requireGroupRole(converseId, userId, [
      'OWNER',
      'ADMIN',
    ]);
    const target = await this.prisma.converseMember.findUnique({
      where: { converseId_userId: { converseId, userId: targetUserId } },
    });

    if (!target) {
      throw new NotFoundException('Member not found');
    }

    // ADMIN 不能封禁 OWNER 或其他 ADMIN
    if (actor.role === 'ADMIN' && target.role !== 'MEMBER') {
      throw new ForbiddenException('Admin can only ban regular members');
    }

    // 在事务中执行：创建封禁记录 + 移除成员
    await this.prisma.$transaction([
      this.prisma.groupBan.create({
        data: {
          converseId,
          userId: targetUserId,
          bannedBy: userId,
          reason,
        },
      }),
      this.prisma.converseMember.delete({
        where: { converseId_userId: { converseId, userId: targetUserId } },
      }),
    ]);

    const payload = {
      converseId,
      userId: targetUserId,
      bannedBy: userId,
      reason,
    };

    this.broadcastService.toRoom(
      converseId,
      CHAT_EVENTS.GROUP_MEMBER_BANNED,
      payload,
    );

    this.broadcastService.unicast(
      targetUserId,
      CHAT_EVENTS.GROUP_MEMBER_BANNED,
      payload,
    );

    this.logger.log(
      `Member ${targetUserId} banned from group ${converseId} by ${userId}`,
    );

    return { banned: true, removedFromGroup: true };
  }

  /**
   * 解封用户
   */
  async unbanMember(
    userId: string,
    converseId: string,
    targetUserId: string,
  ) {
    await this.requireGroupRole(converseId, userId, ['OWNER', 'ADMIN']);

    const ban = await this.prisma.groupBan.findUnique({
      where: { converseId_userId: { converseId, userId: targetUserId } },
    });

    if (!ban) {
      throw new NotFoundException('Ban record not found');
    }

    await this.prisma.groupBan.delete({
      where: { converseId_userId: { converseId, userId: targetUserId } },
    });

    const payload = {
      converseId,
      userId: targetUserId,
      unbannedBy: userId,
    };

    this.broadcastService.toRoom(
      converseId,
      CHAT_EVENTS.GROUP_MEMBER_UNBANNED,
      payload,
    );

    this.logger.log(
      `User ${targetUserId} unbanned from group ${converseId} by ${userId}`,
    );

    return { unbanned: true };
  }

  /**
   * 获取群组封禁列表
   */
  async getGroupBans(userId: string, converseId: string) {
    await this.requireGroupRole(converseId, userId, ['OWNER', 'ADMIN']);

    const bans = await this.prisma.groupBan.findMany({
      where: { converseId },
      include: {
        target: { select: USER_SELECT },
        issuer: { select: USER_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      bans: bans.map((ban) => ({
        userId: ban.userId,
        user: ban.target,
        bannedBy: ban.bannedBy,
        banner: ban.issuer,
        reason: ban.reason,
        createdAt: ban.createdAt.toISOString(),
      })),
    };
  }

  /**
   * 检查用户是否被封禁（内部方法）
   */
  async checkBanned(converseId: string, userId: string): Promise<boolean> {
    const ban = await this.prisma.groupBan.findUnique({
      where: { converseId_userId: { converseId, userId } },
    });
    return !!ban;
  }

  /**
   * 检查用户是否被禁言（内部方法）
   * 返回 null 表示未禁言，否则返回到期时间
   */
  async checkMuted(
    converseId: string,
    userId: string,
  ): Promise<Date | null> {
    const member = await this.prisma.converseMember.findUnique({
      where: { converseId_userId: { converseId, userId } },
      select: { mutedUntil: true },
    });

    if (!member?.mutedUntil) {
      return null;
    }

    // 如果禁言时间已过，自动清除
    if (member.mutedUntil <= new Date()) {
      await this.prisma.converseMember.update({
        where: { converseId_userId: { converseId, userId } },
        data: { mutedUntil: null },
      });
      return null;
    }

    return member.mutedUntil;
  }

  // ──────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────

  /**
   * 校验用户在群组中拥有指定角色之一
   */
  private async requireGroupRole(
    converseId: string,
    userId: string,
    allowedRoles: string[],
  ) {
    const converse = await this.prisma.converse.findUnique({
      where: { id: converseId },
      select: { type: true, deletedAt: true },
    });

    if (!converse || converse.type !== 'GROUP' || converse.deletedAt) {
      throw new NotFoundException('Group not found');
    }

    const member = await this.prisma.converseMember.findUnique({
      where: { converseId_userId: { converseId, userId } },
    });

    if (!member) {
      throw new ForbiddenException('Not a member of this group');
    }

    if (!member.role || !allowedRoles.includes(member.role)) {
      throw new ForbiddenException(
        `Requires one of: ${allowedRoles.join(', ')}`,
      );
    }

    return member;
  }
}
