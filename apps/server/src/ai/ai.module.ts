import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { LlmRouterService } from './services/llm-router.service';
import { WhisperService } from './services/whisper.service';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { KimiProvider } from './providers/kimi.provider';

@Module({
  controllers: [AiController],
  providers: [LlmRouterService, WhisperService, DeepSeekProvider, KimiProvider],
  exports: [LlmRouterService, WhisperService],
})
export class AiModule {}
