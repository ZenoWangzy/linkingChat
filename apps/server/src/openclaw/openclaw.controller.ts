import { Controller, Get, Post, UseGuards, Req } from '@nestjs/common';
import { GatewayManagerService } from './gateway-manager.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * OpenClaw Gateway 管理 API
 */
@Controller('openclaw')
@UseGuards(JwtAuthGuard)
export class OpenclawController {
  constructor(private readonly gatewayManager: GatewayManagerService) {}

  /**
   * 启动用户的 Gateway 实例
   */
  @Post('gateway/start')
  async startGateway(@Req() req: any) {
    const userId = req.user.sub;
    const result = await this.gatewayManager.startUserGateway(userId);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * 停止用户的 Gateway 实例
   */
  @Post('gateway/stop')
  async stopGateway(@Req() req: any) {
    const userId = req.user.sub;
    await this.gatewayManager.stopUserGateway(userId);
    return {
      success: true,
      message: 'Gateway stopped',
    };
  }

  /**
   * 获取用户 Gateway 状态
   */
  @Get('gateway/status')
  async getGatewayStatus(@Req() req: any) {
    const userId = req.user.sub;
    const gateway = this.gatewayManager.getUserGateway(userId);

    if (!gateway) {
      return {
        success: true,
        data: {
          running: false,
          status: 'not_started',
        },
      };
    }

    return {
      success: true,
      data: {
        running: gateway.status === 'running',
        ...gateway,
      },
    };
  }

  /**
   * 获取所有 Gateway 状态（管理员接口）
   * TODO: 添加管理员权限检查
   */
  @Get('admin/gateways')
  async getAllGateways() {
    const gateways = this.gatewayManager.getAllGateways();
    return {
      success: true,
      data: gateways,
      count: gateways.length,
    };
  }
}
