import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastService } from '../gateway/broadcast.service';
import { ConversesService } from '../converses/converses.service';
import { WhisperService } from '../ai/services/whisper.service';
import {
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

describe('MessagesService', () => {
  let service: MessagesService;

  const mockPrisma: any = {
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    converseMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    converse: {
      update: jest.fn(),
    },
    bot: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((args: any) => Promise.resolve(args)),
  };

  const mockBroadcast = {
    unicast: jest.fn(),
    listcast: jest.fn(),
    emitToRoom: jest.fn(),
    toRoom: jest.fn(),
    toRoomIfNotIn: jest.fn(),
    setNamespace: jest.fn(),
  };

  const mockConverses = {
    verifyMembership: jest.fn(),
    getMemberIds: jest.fn(),
  };

  const mockWhisper = {
    isWhisperTrigger: jest.fn().mockReturnValue(false),
    handleWhisperTrigger: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BroadcastService, useValue: mockBroadcast },
        { provide: ConversesService, useValue: mockConverses },
        { provide: WhisperService, useValue: mockWhisper },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
    jest.clearAllMocks();

    // Default: detectBotRecipient finds no other members (fire-and-forget)
    mockPrisma.converseMember.findMany.mockResolvedValue([]);
  });

  describe('create', () => {
    const baseDto = {
      converseId: 'conv1',
      content: 'Hello!',
    };

    it('should throw ForbiddenException when not a member', async () => {
      mockConverses.verifyMembership.mockRejectedValue(
        new ForbiddenException('Not a member'),
      );

      await expect(service.create('user1', baseDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException when replyTo message not found', async () => {
      mockConverses.verifyMembership.mockResolvedValue({});
      mockPrisma.message.findUnique.mockResolvedValue(null);

      await expect(
        service.create('user1', { ...baseDto, replyToId: 'nonexistent' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when replyTo is from different converse', async () => {
      mockConverses.verifyMembership.mockResolvedValue({});
      mockPrisma.message.findUnique.mockResolvedValue({
        id: 'msg1',
        converseId: 'other-converse',
      });

      await expect(
        service.create('user1', { ...baseDto, replyToId: 'msg1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create message and broadcast to room', async () => {
      mockConverses.verifyMembership.mockResolvedValue({});
      mockPrisma.message.create.mockResolvedValue({
        id: 'msg1',
        content: 'Hello!',
        type: 'TEXT',
        authorId: 'user1',
        converseId: 'conv1',
        replyToId: null,
        metadata: null,
        createdAt: new Date('2026-02-14T12:00:00Z'),
        updatedAt: new Date('2026-02-14T12:00:00Z'),
        author: {
          id: 'user1',
          username: 'alice',
          displayName: 'Alice',
          avatarUrl: null,
        },
      });
      mockConverses.getMemberIds.mockResolvedValue(['user1', 'user2']);

      const result = await service.create('user1', baseDto);

      expect(result.id).toBe('msg1');
      expect(result.content).toBe('Hello!');

      // Should broadcast to converse room
      expect(mockBroadcast.toRoom).toHaveBeenCalledWith(
        'conv1',
        'message:new',
        expect.objectContaining({
          id: 'msg1',
          content: 'Hello!',
        }),
      );

      // Should send notification to non-sender members not in room
      expect(mockBroadcast.toRoomIfNotIn).toHaveBeenCalledWith(
        'u-user2',
        'conv1',
        'notification:new',
        expect.objectContaining({
          converseId: 'conv1',
          messageId: 'msg1',
        }),
      );

      // Should NOT notify sender
      expect(mockBroadcast.toRoomIfNotIn).not.toHaveBeenCalledWith(
        'u-user1',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('findByConverse', () => {
    it('should throw ForbiddenException when not a member', async () => {
      mockConverses.verifyMembership.mockRejectedValue(
        new ForbiddenException('Not a member'),
      );

      await expect(
        service.findByConverse('user1', 'conv1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return paginated messages with hasMore=false', async () => {
      mockConverses.verifyMembership.mockResolvedValue({});
      const messages = [
        {
          id: 'msg2',
          content: 'Second',
          createdAt: new Date('2026-02-14T12:01:00Z'),
          author: { id: 'user1' },
        },
        {
          id: 'msg1',
          content: 'First',
          createdAt: new Date('2026-02-14T12:00:00Z'),
          author: { id: 'user2' },
        },
      ];
      mockPrisma.message.findMany.mockResolvedValue(messages);

      const result = await service.findByConverse('user1', 'conv1');

      expect(result.messages).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('should return hasMore=true when more messages exist', async () => {
      mockConverses.verifyMembership.mockResolvedValue({});
      // Return limit+1 messages (36 when limit=35)
      const messages = Array.from({ length: 36 }, (_, i) => ({
        id: `msg${i}`,
        content: `Message ${i}`,
        createdAt: new Date(Date.now() - i * 1000),
        author: { id: 'user1' },
      }));
      mockPrisma.message.findMany.mockResolvedValue(messages);

      const result = await service.findByConverse('user1', 'conv1');

      expect(result.messages).toHaveLength(35);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
    });

    it('should pass cursor as createdAt filter', async () => {
      mockConverses.verifyMembership.mockResolvedValue({});
      mockPrisma.message.findMany.mockResolvedValue([]);

      const cursor = '2026-02-14T12:00:00.000Z';
      await service.findByConverse('user1', 'conv1', cursor);

      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            converseId: 'conv1',
            deletedAt: null,
            createdAt: { lt: new Date(cursor) },
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('should throw NotFoundException when message not found', async () => {
      mockPrisma.message.findUnique.mockResolvedValue(null);

      await expect(
        service.update('user1', 'msg1', { content: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when message is deleted', async () => {
      mockPrisma.message.findUnique.mockResolvedValue({
        id: 'msg1',
        authorId: 'user1',
        deletedAt: new Date(),
      });

      await expect(
        service.update('user1', 'msg1', { content: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when not author', async () => {
      mockPrisma.message.findUnique.mockResolvedValue({
        id: 'msg1',
        authorId: 'user2',
        deletedAt: null,
      });

      await expect(
        service.update('user1', 'msg1', { content: 'Updated' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should update message and broadcast', async () => {
      mockPrisma.message.findUnique.mockResolvedValue({
        id: 'msg1',
        authorId: 'user1',
        converseId: 'conv1',
        deletedAt: null,
      });
      mockPrisma.message.update.mockResolvedValue({
        id: 'msg1',
        content: 'Updated',
        converseId: 'conv1',
        updatedAt: new Date('2026-02-14T12:05:00Z'),
        author: {
          id: 'user1',
          username: 'alice',
          displayName: 'Alice',
          avatarUrl: null,
        },
      });

      const result = await service.update('user1', 'msg1', {
        content: 'Updated',
      });

      expect(result.content).toBe('Updated');
      expect(mockBroadcast.toRoom).toHaveBeenCalledWith(
        'conv1',
        'message:updated',
        expect.objectContaining({
          id: 'msg1',
          content: 'Updated',
        }),
      );
    });
  });

  describe('softDelete', () => {
    it('should throw NotFoundException when message not found', async () => {
      mockPrisma.message.findUnique.mockResolvedValue(null);

      await expect(service.softDelete('user1', 'msg1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when already deleted', async () => {
      mockPrisma.message.findUnique.mockResolvedValue({
        id: 'msg1',
        authorId: 'user1',
        deletedAt: new Date(),
      });

      await expect(service.softDelete('user1', 'msg1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when not author', async () => {
      mockPrisma.message.findUnique.mockResolvedValue({
        id: 'msg1',
        authorId: 'user2',
        deletedAt: null,
      });

      await expect(service.softDelete('user1', 'msg1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should soft delete and broadcast', async () => {
      const deletedAt = new Date('2026-02-14T12:10:00Z');
      mockPrisma.message.findUnique.mockResolvedValue({
        id: 'msg1',
        authorId: 'user1',
        converseId: 'conv1',
        deletedAt: null,
      });
      mockPrisma.message.update.mockResolvedValue({
        id: 'msg1',
        converseId: 'conv1',
        deletedAt,
      });

      const result = await service.softDelete('user1', 'msg1');

      expect(result.id).toBe('msg1');
      expect(result.deleted).toBe(true);
      expect(mockBroadcast.toRoom).toHaveBeenCalledWith(
        'conv1',
        'message:deleted',
        expect.objectContaining({
          id: 'msg1',
          converseId: 'conv1',
          deletedAt: deletedAt.toISOString(),
        }),
      );
    });
  });
});
