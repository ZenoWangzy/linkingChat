import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ConversesService } from './converses.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AddMembersDto } from './dto/add-members.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { MuteMemberDto } from './dto/mute-member.dto';
import { BanMemberDto } from './dto/ban-member.dto';

@Controller('converses')
@UseGuards(JwtAuthGuard)
export class ConversesController {
  constructor(private readonly conversesService: ConversesService) {}

  /**
   * GET /api/v1/converses
   * 返回当前用户的所有打开会话 + 未读计数 + 最后消息预览
   */
  @Get()
  findAll(@CurrentUser('userId') userId: string) {
    return this.conversesService.findUserConverses(userId);
  }

  // ──────────────────────────────────────
  // Group Endpoints
  // ──────────────────────────────────────

  /**
   * POST /api/v1/converses/groups
   */
  @Post('groups')
  createGroup(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateGroupDto,
  ) {
    return this.conversesService.createGroup(userId, dto);
  }

  /**
   * PATCH /api/v1/converses/groups/:converseId
   */
  @Patch('groups/:converseId')
  updateGroup(
    @CurrentUser('userId') userId: string,
    @Param('converseId') converseId: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.conversesService.updateGroup(userId, converseId, dto);
  }

  /**
   * DELETE /api/v1/converses/groups/:converseId
   */
  @Delete('groups/:converseId')
  deleteGroup(
    @CurrentUser('userId') userId: string,
    @Param('converseId') converseId: string,
  ) {
    return this.conversesService.deleteGroup(userId, converseId);
  }

  /**
   * POST /api/v1/converses/groups/:converseId/members
   */
  @Post('groups/:converseId/members')
  addMembers(
    @CurrentUser('userId') userId: string,
    @Param('converseId') converseId: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.conversesService.addMembers(userId, converseId, dto);
  }

  /**
   * DELETE /api/v1/converses/groups/:converseId/members/:memberId
   */
  @Delete('groups/:converseId/members/:memberId')
  removeMember(
    @CurrentUser('userId') userId: string,
    @Param('converseId') converseId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.conversesService.removeMember(userId, converseId, memberId);
  }

  /**
   * POST /api/v1/converses/groups/:converseId/leave
   */
  @Post('groups/:converseId/leave')
  leaveGroup(
    @CurrentUser('userId') userId: string,
    @Param('converseId') converseId: string,
  ) {
    return this.conversesService.leaveGroup(userId, converseId);
  }

  /**
   * PATCH /api/v1/converses/groups/:converseId/members/:memberId/role
   */
  @Patch('groups/:converseId/members/:memberId/role')
  updateMemberRole(
    @CurrentUser('userId') userId: string,
    @Param('converseId') converseId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.conversesService.updateMemberRole(
      userId,
      converseId,
      memberId,
      dto,
    );
  }

  // ──────────────────────────────────────
  // Phase 9: 禁言与封禁
  // ──────────────────────────────────────

  /**
   * PATCH /api/v1/converses/groups/:converseId/members/:memberId/mute
   * 禁言群成员
   */
  @Patch('groups/:converseId/members/:memberId/mute')
  muteMember(
    @CurrentUser('userId') userId: string,
    @Param('converseId') converseId: string,
    @Param('memberId') memberId: string,
    @Body() dto: MuteMemberDto,
  ) {
    return this.conversesService.muteMember(
      userId,
      converseId,
      memberId,
      dto.durationMinutes,
    );
  }

  /**
   * DELETE /api/v1/converses/groups/:converseId/members/:memberId/mute
   * 解除禁言
   */
  @Delete('groups/:converseId/members/:memberId/mute')
  unmuteMember(
    @CurrentUser('userId') userId: string,
    @Param('converseId') converseId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.conversesService.unmuteMember(userId, converseId, memberId);
  }

  /**
   * POST /api/v1/converses/groups/:converseId/bans/:userId
   * 封禁成员（自动踢出）
   */
  @Post('groups/:converseId/bans/:targetUserId')
  banMember(
    @CurrentUser('userId') userId: string,
    @Param('converseId') converseId: string,
    @Param('targetUserId') targetUserId: string,
    @Body() dto: BanMemberDto,
  ) {
    return this.conversesService.banMember(
      userId,
      converseId,
      targetUserId,
      dto.reason,
    );
  }

  /**
   * DELETE /api/v1/converses/groups/:converseId/bans/:userId
   * 解封用户
   */
  @Delete('groups/:converseId/bans/:targetUserId')
  unbanMember(
    @CurrentUser('userId') userId: string,
    @Param('converseId') converseId: string,
    @Param('targetUserId') targetUserId: string,
  ) {
    return this.conversesService.unbanMember(userId, converseId, targetUserId);
  }

  /**
   * GET /api/v1/converses/groups/:converseId/bans
   * 获取群组封禁列表
   */
  @Get('groups/:converseId/bans')
  getGroupBans(
    @CurrentUser('userId') userId: string,
    @Param('converseId') converseId: string,
  ) {
    return this.conversesService.getGroupBans(userId, converseId);
  }
}
