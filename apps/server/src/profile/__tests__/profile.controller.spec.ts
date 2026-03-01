// apps/server/src/profile/__tests__/profile.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ProfileController } from '../profile.controller';
import { ProfileService } from '../profile.service';

describe('ProfileController', () => {
  let controller: ProfileController;
  let profileService: any;

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    username: 'testuser',
    displayName: 'Test User',
    avatarUrl: 'https://example.com/avatar.jpg',
    status: 'ONLINE',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        {
          provide: ProfileService,
          useValue: {
            getUserProfile: jest.fn(),
            updateProfile: jest.fn(),
            updateAvatar: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(ProfileController);
    profileService = module.get(ProfileService);
  });

  describe('getCurrentUser', () => {
    it('should return current user profile', async () => {
      profileService.getUserProfile.mockResolvedValue(mockUser);

      const result = await controller.getCurrentUser('user-1');

      expect(result).toEqual(mockUser);
    });
  });

  describe('updateProfile', () => {
    it('should update user profile', async () => {
      const dto = { displayName: 'New Name' };
      const updatedUser = { ...mockUser, displayName: 'New Name' };
      profileService.updateProfile.mockResolvedValue(updatedUser);

      const result = await controller.updateProfile('user-1', dto as any);

      expect(result.displayName).toBe('New Name');
    });
  });

  describe('uploadAvatar', () => {
    it('should upload avatar and return URL', async () => {
      const file = {
        buffer: Buffer.from('test'),
        mimetype: 'image/jpeg',
        size: 1024,
        fieldname: 'file',
        originalname: 'avatar.jpg',
        encoding: '7bit',
        destination: '',
        filename: '',
        path: '',
        stream: process.stdout,
      } as any;

      const result = await controller.uploadAvatar('user-1', file);

      expect(result.avatarUrl).toContain('avatar');
      expect(profileService.updateAvatar).toHaveBeenCalled();
    });
  });
});
