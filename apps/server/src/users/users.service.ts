import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Search users by username or displayName (partial match, case-insensitive).
   * Excludes the requesting user from results.
   */
  async searchUsers(
    currentUserId: string,
    query: string,
    limit = 20,
  ): Promise<
    Array<{
      id: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
    }>
  > {
    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          { id: { not: currentUserId } },
          {
            OR: [
              { username: { contains: query, mode: 'insensitive' } },
              { displayName: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
      take: limit,
      orderBy: { username: 'asc' },
    });

    return users;
  }
}
