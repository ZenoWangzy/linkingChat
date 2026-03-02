// apps/server/src/devices/__tests__/devices.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { DevicesController } from '../devices.controller';
import { DevicesService } from '../devices.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('DevicesController', () => {
  let controller: DevicesController;
  let service: any;

  const mockDevice = {
    id: 'device-1',
    name: 'Test Device',
    platform: 'windows',
    status: 'ONLINE',
    userId: 'user-1',
    lastSeenAt: new Date(),
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DevicesController],
      providers: [
        {
          provide: DevicesService,
          useValue: {
            findAllByUser: jest.fn(),
            findOneById: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(DevicesController);
    service = module.get(DevicesService);
  });

  describe('findAll', () => {
    it('should return all devices for user', async () => {
      service.findAllByUser.mockResolvedValue([mockDevice]);

      const result = await controller.findAll('user-1');

      expect(result).toEqual([mockDevice]);
      expect(service.findAllByUser).toHaveBeenCalledWith('user-1');
    });
  });

  describe('findOne', () => {
    it('should return device if owned by user', async () => {
      service.findOneById.mockResolvedValue(mockDevice);

      const result = await controller.findOne('device-1', 'user-1');

      expect(result).toEqual(mockDevice);
    });

    it('should throw ForbiddenException if device not owned', async () => {
      service.findOneById.mockRejectedValue(new ForbiddenException());

      await expect(controller.findOne('device-1', 'user-2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException if device not found', async () => {
      service.findOneById.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne('invalid', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update device name', async () => {
      const updated = { ...mockDevice, name: 'New Name' };
      service.update.mockResolvedValue(updated);

      const result = await controller.update('device-1', 'user-1', {
        name: 'New Name',
      });

      expect(result.name).toBe('New Name');
    });
  });

  describe('remove', () => {
    it('should delete device owned by current user', async () => {
      service.remove.mockResolvedValue({ deleted: true });

      const result = await controller.remove('device-1', 'user-1');

      expect(result).toEqual({ deleted: true });
      expect(service.remove).toHaveBeenCalledWith('device-1', 'user-1');
    });

    it('should reject deleting device owned by another user', async () => {
      service.remove.mockRejectedValue(new ForbiddenException());

      await expect(controller.remove('device-1', 'user-2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject deleting non-existent device', async () => {
      service.remove.mockRejectedValue(new NotFoundException());

      await expect(controller.remove('invalid', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
