import { Module } from '@nestjs/common';
import { GatewayManagerService } from './gateway-manager.service';
import { OpenclawController } from './openclaw.controller';

@Module({
  controllers: [OpenclawController],
  providers: [GatewayManagerService],
  exports: [GatewayManagerService],
})
export class OpenclawModule {}
