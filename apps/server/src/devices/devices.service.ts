import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByUser(userId: string) {
    return this.prisma.device.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneById(id: string, userId: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    if (device.userId !== userId) throw new ForbiddenException();
    return device;
  }

  async update(id: string, userId: string, data: { name?: string }) {
    const device = await this.findOneById(id, userId);
    return this.prisma.device.update({
      where: { id: device.id },
      data,
    });
  }

  async remove(id: string, userId: string) {
    const device = await this.findOneById(id, userId);
    await this.prisma.device.delete({ where: { id: device.id } });
    return { deleted: true };
  }

  async upsertDevice(
    userId: string,
    payload: { deviceId: string; name: string; platform: string },
  ) {
    return this.prisma.device.upsert({
      where: { id: payload.deviceId },
      create: {
        id: payload.deviceId,
        name: payload.name,
        platform: payload.platform,
        status: 'ONLINE',
        lastSeenAt: new Date(),
        userId,
      },
      update: {
        name: payload.name,
        platform: payload.platform,
        status: 'ONLINE',
        lastSeenAt: new Date(),
      },
    });
  }

  async setOffline(deviceId: string) {
    return this.prisma.device.update({
      where: { id: deviceId },
      data: {
        status: 'OFFLINE',
        lastSeenAt: new Date(),
      },
    });
  }

  async updateLastSeen(deviceId: string) {
    return this.prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date() },
    });
  }
}
