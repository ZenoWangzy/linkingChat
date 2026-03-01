import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ConversesModule } from '../converses/converses.module';
import { AiModule } from '../ai/ai.module';
import { MentionsModule } from '../mentions/mentions.module';

@Module({
  imports: [ConversesModule, AiModule, MentionsModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
