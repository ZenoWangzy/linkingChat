import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PresenceService } from '../gateway/presence.service';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly presenceService: PresenceService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * GET /api/v1/users/online?ids=userId1,userId2,userId3
   *
   * 批量查询用户在线状态
   */
  @Get('online')
  async getOnlineStatuses(
    @Query('ids') ids: string,
  ): Promise<Record<string, string>> {
    if (!ids || ids.trim().length === 0) {
      throw new BadRequestException('Query parameter "ids" is required');
    }

    const userIds = ids
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (userIds.length === 0) {
      throw new BadRequestException('At least one user ID is required');
    }

    if (userIds.length > 200) {
      throw new BadRequestException('Maximum 200 user IDs per request');
    }

    const statuses = await this.presenceService.getStatuses(userIds);
    return Object.fromEntries(statuses);
  }

  /**
   * GET /api/v1/users/search?q=keyword&limit=20
   *
   * Search users by username or displayName (partial match)
   */
  @Get('search')
  async searchUsers(
    @CurrentUser('userId') userId: string,
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Query parameter "q" is required');
    }

    if (query.trim().length < 2) {
      throw new BadRequestException('Search query must be at least 2 characters');
    }

    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 20, 50) : 20;
    return this.usersService.searchUsers(userId, query.trim(), parsedLimit);
  }
}
