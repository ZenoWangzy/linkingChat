import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LlmRouterService } from './services/llm-router.service';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly llmRouter: LlmRouterService) {}

  /** GET /api/v1/ai/health — AI 模块健康检查 */
  @Get('health')
  health() {
    return {
      status: 'ok',
      providers: ['deepseek', 'kimi'],
    };
  }
}
