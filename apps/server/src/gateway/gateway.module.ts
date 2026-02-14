import { Module } from '@nestjs/common';
import { DeviceGateway } from './device.gateway';
import { DevicesModule } from '../devices/devices.module';

@Module({
  imports: [DevicesModule],
  providers: [DeviceGateway],
})
export class GatewayModule {}
