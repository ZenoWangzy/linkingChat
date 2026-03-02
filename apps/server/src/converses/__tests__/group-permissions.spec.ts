import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConversesService } from '../converses.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BroadcastService } from '../../gateway/broadcast.service';
import { CHAT_EVENTS } from '@linkingchat/ws-protocol';

describe('ConversesService - Group Permissions (Phase 9)', () => {
  let service: ConversesService;
  let mockPrisma: any;
  let mockBroadcast: any;

  const mockUserId = 'user-owner';
  const mockAdminId = 'user-admin';
  const mockMemberId = 'user-member';
  const mockConverseId = 'converse-1';

  beforeEach(async () => {
    mockPrisma = {
      converse: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      converseMember: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        createMany: jest.fn(),
      },
      groupBan: {
        create: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
      // 支持 $transaction 两种调用模式：数组和回调函数
      $transaction: jest.fn((arg: any) => {
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        return arg(mockPrisma);
      }),
    };

    mockBroadcast = {
      toRoom: jest.fn(),
      unicast: jest.fn(),
      listcast: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BroadcastService, useValue: mockBroadcast },
      ],
    }).compile();

    service = module.get<ConversesService>(ConversesService);
  });

  // ────────────────────────────────────────────────────────
  // 禁言测试
  // ────────────────────────────────────────────────────────

  describe('muteMember', () => {
    it('OWNER 可以禁言 MEMBER', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique
        .mockResolvedValueOnce({ role: 'OWNER' }) // actor
        .mockResolvedValueOnce({ role: 'MEMBER' }); // target
      mockPrisma.converseMember.update.mockResolvedValue({});

      await service.muteMember(
        mockUserId,
        mockConverseId,
        mockMemberId,
        60,
      );

      expect(mockPrisma.converseMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { mutedUntil: expect.any(Date) },
        }),
      );
      expect(mockBroadcast.toRoom).toHaveBeenCalledWith(
        mockConverseId,
        CHAT_EVENTS.GROUP_MEMBER_MUTED,
        expect.objectContaining({ userId: mockMemberId }),
      );
    });

    it('ADMIN 可以禁言 MEMBER', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique
        .mockResolvedValueOnce({ role: 'ADMIN' }) // actor
        .mockResolvedValueOnce({ role: 'MEMBER' }); // target
      mockPrisma.converseMember.update.mockResolvedValue({});

      await service.muteMember(
        mockAdminId,
        mockConverseId,
        mockMemberId,
        10,
      );

      expect(mockPrisma.converseMember.update).toHaveBeenCalled();
    });

    it('MEMBER 不能禁言其他人', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique.mockResolvedValue({ role: 'MEMBER' });

      await expect(
        service.muteMember(mockMemberId, mockConverseId, mockAdminId, 60),
      ).rejects.toThrow(ForbiddenException);
    });

    it('ADMIN 不能禁言 OWNER', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique
        .mockResolvedValueOnce({ role: 'ADMIN' }) // actor
        .mockResolvedValueOnce({ role: 'OWNER' }); // target

      await expect(
        service.muteMember(mockAdminId, mockConverseId, mockUserId, 60),
      ).rejects.toThrow(ForbiddenException);
    });

    it('ADMIN 不能禁言其他 ADMIN', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      const anotherAdminId = 'user-admin-2';
      mockPrisma.converseMember.findUnique
        .mockResolvedValueOnce({ role: 'ADMIN' }) // actor
        .mockResolvedValueOnce({ role: 'ADMIN' }); // target

      await expect(
        service.muteMember(mockAdminId, mockConverseId, anotherAdminId, 60),
      ).rejects.toThrow(ForbiddenException);
    });

    it('不能禁言自己', async () => {
      await expect(
        service.muteMember(mockUserId, mockConverseId, mockUserId, 60),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ────────────────────────────────────────────────────────
  // 解除禁言测试
  // ────────────────────────────────────────────────────────

  describe('unmuteMember', () => {
    it('OWNER/ADMIN 可以解除禁言', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique
        .mockResolvedValueOnce({ role: 'ADMIN' })
        .mockResolvedValueOnce({ role: 'MEMBER', mutedUntil: new Date() });
      mockPrisma.converseMember.update.mockResolvedValue({});

      await service.unmuteMember(
        mockAdminId,
        mockConverseId,
        mockMemberId,
      );

      expect(mockPrisma.converseMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { mutedUntil: null },
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────
  // 封禁测试
  // ────────────────────────────────────────────────────────

  describe('banMember', () => {
    it('OWNER 可以封禁 MEMBER', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique
        .mockResolvedValueOnce({ role: 'OWNER' }) // actor
        .mockResolvedValueOnce({ role: 'MEMBER' }); // target
      mockPrisma.groupBan.create.mockResolvedValue({});
      mockPrisma.converseMember.delete.mockResolvedValue({});

      const result = await service.banMember(
        mockUserId,
        mockConverseId,
        mockMemberId,
        'Spamming',
      );

      expect(result).toEqual({ banned: true, removedFromGroup: true });
      expect(mockBroadcast.toRoom).toHaveBeenCalledWith(
        mockConverseId,
        CHAT_EVENTS.GROUP_MEMBER_BANNED,
        expect.objectContaining({ reason: 'Spamming' }),
      );
    });

    it('ADMIN 不能封禁 OWNER', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique
        .mockResolvedValueOnce({ role: 'ADMIN' }) // actor
        .mockResolvedValueOnce({ role: 'OWNER' }); // target

      await expect(
        service.banMember(mockAdminId, mockConverseId, mockUserId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('封禁后成员自动被踢出', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique
        .mockResolvedValueOnce({ role: 'OWNER' })
        .mockResolvedValueOnce({ role: 'MEMBER' });
      mockPrisma.groupBan.create.mockResolvedValue({});
      mockPrisma.converseMember.delete.mockResolvedValue({});

      await service.banMember(mockUserId, mockConverseId, mockMemberId);

      expect(mockPrisma.converseMember.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            converseId_userId: {
              converseId: mockConverseId,
              userId: mockMemberId,
            },
          },
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────
  // 解封测试
  // ────────────────────────────────────────────────────────

  describe('unbanMember', () => {
    it('OWNER/ADMIN 可以解封', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.groupBan.findUnique.mockResolvedValue({
        converseId: mockConverseId,
        userId: mockMemberId,
        bannedBy: mockUserId,
        reason: 'Test',
        createdAt: new Date(),
      });
      mockPrisma.groupBan.delete.mockResolvedValue({});

      const result = await service.unbanMember(
        mockUserId,
        mockConverseId,
        mockMemberId,
      );

      expect(result).toEqual({ unbanned: true });
    });

    it('解封后用户可以重新加入', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.groupBan.findUnique.mockResolvedValue({
        converseId: mockConverseId,
        userId: mockMemberId,
      });
      mockPrisma.groupBan.delete.mockResolvedValue({});

      await service.unbanMember(mockUserId, mockConverseId, mockMemberId);

      // 验证封禁记录被删除
      expect(mockPrisma.groupBan.delete).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────
  // checkMuted 测试
  // ────────────────────────────────────────────────────────

  describe('checkMuted', () => {
    it('未禁言用户返回 null', async () => {
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        mutedUntil: null,
      });

      const result = await service.checkMuted(mockConverseId, mockMemberId);

      expect(result).toBeNull();
    });

    it('禁言已过期自动解除', async () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60); // 1小时前
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        mutedUntil: pastDate,
      });
      mockPrisma.converseMember.update.mockResolvedValue({});

      const result = await service.checkMuted(mockConverseId, mockMemberId);

      expect(result).toBeNull();
      expect(mockPrisma.converseMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { mutedUntil: null },
        }),
      );
    });

    it('正在禁言返回到期时间', async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60); // 1小时后
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        mutedUntil: futureDate,
      });

      const result = await service.checkMuted(mockConverseId, mockMemberId);

      expect(result).toEqual(futureDate);
    });
  });

  // ────────────────────────────────────────────────────────
  // addMembers 封禁检查测试
  // ────────────────────────────────────────────────────────

  describe('addMembers - banned user check', () => {
    it('被封禁用户无法加入群组', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
        maxMembers: 200,
      });
      mockPrisma.converseMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.converseMember.findMany.mockResolvedValue([]); // 无现有成员
      mockPrisma.user.findMany.mockResolvedValue([{ id: mockMemberId }]);
      mockPrisma.groupBan.findMany.mockResolvedValue([
        { userId: mockMemberId },
      ]);

      await expect(
        service.addMembers(mockUserId, mockConverseId, {
          memberIds: [mockMemberId],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
