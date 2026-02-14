import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { CommandsService } from './commands.service';

@Module({
  controllers: [DevicesController],
  providers: [DevicesService, CommandsService],
  exports: [DevicesService, CommandsService],
})
export class DevicesModule {}
