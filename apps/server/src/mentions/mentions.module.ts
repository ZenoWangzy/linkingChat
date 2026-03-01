import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { AgentsModule } from '../agents/agents.module';
import { MentionService } from './mentions.service';

@Module({
  imports: [PrismaModule, AiModule, AgentsModule],
  providers: [MentionService],
  exports: [MentionService],
})
export class MentionsModule {}
