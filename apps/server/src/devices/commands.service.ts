import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CommandStatus, Prisma } from '@prisma/client';

@Injectable()
export class CommandsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    type: string;
    payload: Record<string, unknown>;
    deviceId: string;
    issuerId: string;
  }) {
    return this.prisma.command.create({
      data: {
        type: data.type,
        payload: data.payload as Prisma.InputJsonValue,
        deviceId: data.deviceId,
        issuerId: data.issuerId,
        status: 'PENDING',
      },
    });
  }

  async complete(
    commandId: string,
    result: {
      status: CommandStatus;
      data?: Record<string, unknown> | null;
    },
  ) {
    const command = await this.prisma.command.findUnique({
      where: { id: commandId },
    });

    if (!command) {
      throw new NotFoundException(`Command ${commandId} not found`);
    }

    return this.prisma.command.update({
      where: { id: commandId },
      data: {
        status: result.status,
        result: (result.data ?? undefined) as Prisma.InputJsonValue | undefined,
        completedAt: new Date(),
      },
    });
  }

  async findByUser(issuerId: string, cursor?: string, take = 20) {
    const commands = await this.prisma.command.findMany({
      where: { issuerId },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
    });

    const hasMore = commands.length > take;
    if (hasMore) commands.pop();

    return {
      data: commands,
      nextCursor: hasMore ? commands[commands.length - 1].id : null,
    };
  }
}
