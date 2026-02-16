import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { LlmRouterService } from './services/llm-router.service';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { KimiProvider } from './providers/kimi.provider';

@Module({
  controllers: [AiController],
  providers: [LlmRouterService, DeepSeekProvider, KimiProvider],
  exports: [LlmRouterService],
})
export class AiModule {}
