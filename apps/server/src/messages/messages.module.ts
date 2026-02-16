import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ConversesModule } from '../converses/converses.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [ConversesModule, AiModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
