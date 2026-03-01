// apps/server/src/profile/__tests__/profile.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ProfileService } from '../profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

describe('ProfileService', () => {
  let service: ProfileService;
  let prisma: jest.Mocked<PrismaService>;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    username: 'testuser',
    displayName: 'Test User',
    avatarUrl: 'https://example.com/avatar.jpg',
    status: UserStatus.ONLINE,
    lastSeenAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get(ProfileService);
    prisma = module.get(PrismaService);
  });

  describe('getUserProfile', () => {
    it('should return user profile when user exists', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUserProfile('user-1');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          status: true,
          lastSeenAt: true,
        },
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserProfile('invalid-id'))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('should update displayName successfully', async () => {
      const updatedUser = { ...mockUser, displayName: 'New Name' };
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateProfile('user-1', { displayName: 'New Name' });

      expect(result.displayName).toBe('New Name');
    });

    it('should reject displayName shorter than 1 character', async () => {
      await expect(service.updateProfile('user-1', { displayName: '' }))
        .rejects.toThrow(BadRequestException);
    });

    it('should reject displayName longer than 64 characters', async () => {
      const longName = 'a'.repeat(65);
      await expect(service.updateProfile('user-1', { displayName: longName }))
        .rejects.toThrow(BadRequestException);
    });

    it('should update status successfully', async () => {
      const updatedUser = { ...mockUser, status: UserStatus.IDLE };
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.updateProfile('user-1', { status: UserStatus.IDLE });

      expect(result.status).toBe(UserStatus.IDLE);
    });

    it('should handle unique constraint violation', async () => {
      const error = { code: 'P2002' };
      prisma.user.update.mockRejectedValue(error);

      await expect(service.updateProfile('user-1', { displayName: 'Duplicate' }))
        .rejects.toThrow(ConflictException);
    });
  });

  describe('updateAvatar', () => {
    it('should update avatarUrl successfully', async () => {
      prisma.user.update.mockResolvedValue(mockUser);

      await service.updateAvatar('user-1', 'https://example.com/new-avatar.jpg');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { avatarUrl: 'https://example.com/new-avatar.jpg' },
      });
    });
  });
});
