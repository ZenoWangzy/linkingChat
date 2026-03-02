import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConversesService } from './converses.service';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService } from '../gateway/broadcast.service';

// Helpers
const mockUser = (id: string) => ({
  id,
  username: `user_${id}`,
  displayName: `User ${id}`,
  avatarUrl: null,
  status: 'OFFLINE',
});

describe('ConversesService', () => {
  let service: ConversesService;
  let mockPrisma: any;
  let mockBroadcast: any;

  beforeEach(async () => {
    mockPrisma = {
      user: { findMany: jest.fn() },
      converse: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      converseMember: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        createMany: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      message: {
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      bot: { findMany: jest.fn() },
      groupBan: {  // Phase 9: 群封禁
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn((arg: any) => {
        // 支持数组和回调函数两种模式
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        return arg(mockPrisma);
      }),
    };

    mockBroadcast = {
      toRoom: jest.fn(),
      listcast: jest.fn(),
      unicast: jest.fn(),
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

  // ──────────────────────────────────────
  // Existing tests (updated for BroadcastService)
  // ──────────────────────────────────────

  describe('verifyMembership', () => {
    it('should return member when found', async () => {
      const member = { converseId: 'conv1', userId: 'user1', isOpen: true };
      mockPrisma.converseMember.findUnique.mockResolvedValue(member);

      const result = await service.verifyMembership('conv1', 'user1');
      expect(result).toEqual(member);
    });

    it('should throw ForbiddenException when not a member', async () => {
      mockPrisma.converseMember.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyMembership('conv1', 'user1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getMemberIds', () => {
    it('should return userId list', async () => {
      mockPrisma.converseMember.findMany.mockResolvedValue([
        { userId: 'user1' },
        { userId: 'user2' },
      ]);

      const result = await service.getMemberIds('conv1');
      expect(result).toEqual(['user1', 'user2']);
    });
  });

  describe('getUnreadCount', () => {
    it('should return 0 when user is not a member (public overload)', async () => {
      mockPrisma.converseMember.findUnique.mockResolvedValue(null);

      const count = await service.getUnreadCount('conv1', 'user1');
      expect(count).toBe(0);
    });

    it('should count all non-own messages when lastSeenMessageId is null', async () => {
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        lastSeenMessageId: null,
      });
      mockPrisma.message.count.mockResolvedValue(5);

      const count = await service.getUnreadCount('conv1', 'user1');
      expect(count).toBe(5);
    });

    it('should count messages after lastSeenMessage createdAt', async () => {
      const lastSeenAt = new Date('2026-02-14T12:00:00Z');
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        lastSeenMessageId: 'msg1',
      });
      mockPrisma.message.findUnique.mockResolvedValue({
        createdAt: lastSeenAt,
      });
      mockPrisma.message.count.mockResolvedValue(3);

      const count = await service.getUnreadCount('conv1', 'user1');
      expect(count).toBe(3);
    });

    it('should fall back to full count when lastSeenMessage is deleted', async () => {
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        lastSeenMessageId: 'deleted-msg',
      });
      mockPrisma.message.findUnique.mockResolvedValue(null);
      mockPrisma.message.count.mockResolvedValue(7);

      const count = await service.getUnreadCount('conv1', 'user1');
      expect(count).toBe(7);
    });
  });

  describe('findUserConverses', () => {
    const makeMemberData = (overrides: any = {}) => ({
      converseId: 'conv1',
      userId: 'user1',
      lastSeenMessageId: null,
      converse: {
        id: 'conv1',
        type: 'DM',
        name: null,
        description: null,
        avatarUrl: null,
        creatorId: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date('2026-02-14T12:00:00Z'),
        _count: { members: 2 },
        members: [
          {
            userId: 'user1',
            isOpen: true,
            role: null,
            user: mockUser('user1'),
          },
          {
            userId: 'user2',
            isOpen: true,
            role: null,
            user: mockUser('user2'),
          },
        ],
        messages: [],
        ...overrides.converse,
      },
      ...overrides,
    });

    it('should exclude soft-deleted groups', async () => {
      mockPrisma.converseMember.findMany.mockResolvedValue([
        makeMemberData({
          converse: {
            id: 'deleted-group',
            type: 'GROUP',
            deletedAt: new Date(),
            _count: { members: 3 },
            members: [],
            messages: [],
          },
        }),
        makeMemberData(),
      ]);
      mockPrisma.bot.findMany.mockResolvedValue([]);
      mockPrisma.message.count.mockResolvedValue(0);

      const result = await service.findUserConverses('user1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('conv1');
    });

    it('should include memberCount for GROUP type', async () => {
      mockPrisma.converseMember.findMany.mockResolvedValue([
        makeMemberData({
          converse: {
            id: 'group1',
            type: 'GROUP',
            deletedAt: null,
            _count: { members: 5 },
            members: [],
            messages: [],
          },
        }),
      ]);
      mockPrisma.bot.findMany.mockResolvedValue([]);
      mockPrisma.message.count.mockResolvedValue(0);

      const result = await service.findUserConverses('user1');

      expect(result[0].memberCount).toBe(5);
    });
  });

  // ──────────────────────────────────────
  // Group CRUD Tests
  // ──────────────────────────────────────

  describe('createGroup', () => {
    it('should create a group with correct roles', async () => {
      const ownerId = 'owner1';
      const memberIds = ['member1', 'member2'];

      mockPrisma.user.findMany.mockResolvedValue(
        memberIds.map((id) => ({ id })),
      );

      const createdConverse = {
        id: 'conv1',
        type: 'GROUP',
        name: 'Test Group',
        description: null,
        creatorId: ownerId,
        createdAt: new Date(),
        members: [
          { userId: ownerId, role: 'OWNER', user: mockUser(ownerId) },
          { userId: 'member1', role: 'MEMBER', user: mockUser('member1') },
          { userId: 'member2', role: 'MEMBER', user: mockUser('member2') },
        ],
      };
      mockPrisma.$transaction.mockImplementation(async (fn: any) =>
        fn(mockPrisma),
      );
      mockPrisma.converse.create.mockResolvedValue(createdConverse);

      const result = await service.createGroup(ownerId, {
        name: 'Test Group',
        memberIds,
      });

      expect(result.id).toBe('conv1');
      expect(mockPrisma.converse.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'GROUP',
            name: 'Test Group',
            creatorId: ownerId,
          }),
        }),
      );
      expect(mockBroadcast.listcast).toHaveBeenCalledWith(
        [ownerId, 'member1', 'member2'],
        'group:created',
        expect.any(Object),
      );
    });

    it('should deduplicate memberIds and exclude creator', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'member1' }]);
      mockPrisma.$transaction.mockImplementation(async (fn: any) =>
        fn(mockPrisma),
      );
      mockPrisma.converse.create.mockResolvedValue({
        id: 'conv1',
        type: 'GROUP',
        name: 'Test',
        description: null,
        creatorId: 'owner1',
        createdAt: new Date(),
        members: [
          { userId: 'owner1', role: 'OWNER', user: mockUser('owner1') },
          { userId: 'member1', role: 'MEMBER', user: mockUser('member1') },
        ],
      });

      await service.createGroup('owner1', {
        name: 'Test',
        memberIds: ['member1', 'member1', 'owner1'],
      });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['member1'] }, deletedAt: null },
        }),
      );
    });
  });

  describe('updateGroup', () => {
    it('should allow OWNER to update', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        role: 'OWNER',
      });
      mockPrisma.converse.update.mockResolvedValue({
        id: 'conv1',
        name: 'New Name',
        description: null,
        avatarUrl: null,
        updatedAt: new Date(),
      });

      const result = await service.updateGroup('owner1', 'conv1', {
        name: 'New Name',
      });

      expect(result.name).toBe('New Name');
      expect(mockBroadcast.toRoom).toHaveBeenCalledWith(
        'conv1',
        'group:updated',
        expect.any(Object),
      );
    });

    it('should reject MEMBER from updating', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        role: 'MEMBER',
      });

      await expect(
        service.updateGroup('member1', 'conv1', { name: 'Hacked' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteGroup', () => {
    it('should soft-delete group (OWNER only)', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        role: 'OWNER',
      });
      mockPrisma.converse.update.mockResolvedValue({});

      const result = await service.deleteGroup('owner1', 'conv1');

      expect(result.deleted).toBe(true);
      expect(mockPrisma.converse.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
          }),
        }),
      );
      expect(mockBroadcast.toRoom).toHaveBeenCalledWith(
        'conv1',
        'group:deleted',
        expect.any(Object),
      );
    });

    it('should reject non-OWNER from deleting', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        role: 'ADMIN',
      });

      await expect(
        service.deleteGroup('admin1', 'conv1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('addMembers', () => {
    it('should add new members and skip duplicates', async () => {
      // requireGroupRole calls
      mockPrisma.converse.findUnique
        .mockResolvedValueOnce({ type: 'GROUP', deletedAt: null })
        .mockResolvedValueOnce({ maxMembers: 200, deletedAt: null });
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        role: 'OWNER',
      });
      mockPrisma.converseMember.findMany
        .mockResolvedValueOnce([{ userId: 'owner1' }, { userId: 'existing1' }])
        .mockResolvedValueOnce([
          { userId: 'new1', role: 'MEMBER', user: mockUser('new1') },
        ]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'new1' }]);
      mockPrisma.converseMember.createMany.mockResolvedValue({ count: 1 });

      const result = await service.addMembers('owner1', 'conv1', {
        memberIds: ['new1', 'existing1'],
      });

      expect(result.added).toBe(1);
      expect(mockPrisma.converseMember.createMany).toHaveBeenCalledWith({
        data: [{ converseId: 'conv1', userId: 'new1', role: 'MEMBER' }],
      });
    });
  });

  describe('removeMember', () => {
    it('should enforce permission: ADMIN cannot remove ADMIN', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique
        .mockResolvedValueOnce({ role: 'ADMIN' })
        .mockResolvedValueOnce({ role: 'ADMIN' });

      await expect(
        service.removeMember('admin1', 'conv1', 'admin2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow OWNER to remove ADMIN', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique
        .mockResolvedValueOnce({ role: 'OWNER' })
        .mockResolvedValueOnce({ role: 'ADMIN' });
      mockPrisma.converseMember.delete.mockResolvedValue({});

      const result = await service.removeMember('owner1', 'conv1', 'admin1');
      expect(result.removed).toBe(true);
    });
  });

  describe('leaveGroup', () => {
    it('should transfer OWNER to earliest joined member', async () => {
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        converseId: 'conv1',
        userId: 'owner1',
        role: 'OWNER',
      });
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findFirst.mockResolvedValue({
        converseId: 'conv1',
        userId: 'member1',
        role: 'MEMBER',
        joinedAt: new Date('2025-01-01'),
      });
      mockPrisma.$transaction.mockResolvedValue([]);

      const result = await service.leaveGroup('owner1', 'conv1');

      expect(result.left).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockBroadcast.toRoom).toHaveBeenCalledWith(
        'conv1',
        'group:member:role:updated',
        expect.objectContaining({
          userId: 'member1',
          role: 'OWNER',
        }),
      );
    });
  });

  describe('updateMemberRole', () => {
    it('should allow OWNER to change role', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique
        .mockResolvedValueOnce({ role: 'OWNER' })
        .mockResolvedValueOnce({ role: 'MEMBER' });
      mockPrisma.converseMember.update.mockResolvedValue({});

      const result = await service.updateMemberRole(
        'owner1',
        'conv1',
        'member1',
        { role: 'ADMIN' },
      );

      expect(result.updated).toBe(true);
      expect(mockBroadcast.toRoom).toHaveBeenCalledWith(
        'conv1',
        'group:member:role:updated',
        expect.objectContaining({
          userId: 'member1',
          role: 'ADMIN',
        }),
      );
    });

    it('should reject non-OWNER from changing roles', async () => {
      mockPrisma.converse.findUnique.mockResolvedValue({
        type: 'GROUP',
        deletedAt: null,
      });
      mockPrisma.converseMember.findUnique.mockResolvedValue({
        role: 'ADMIN',
      });

      await expect(
        service.updateMemberRole('admin1', 'conv1', 'member1', {
          role: 'ADMIN',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
