import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BatchTriggerService } from './batch-trigger.service';
import { BotsService } from '../../bots/bots.service';
import { AgentEvent } from '../interfaces';

export interface DeviceResultEvent {
  userId: string;
  commandId: string;
  command: string;
  status: 'success' | 'error';
  output?: string;
  error?: string;
  deviceId: string;
}

@Injectable()
export class BotEventListener {
  private readonly logger = new Logger(BotEventListener.name);

  constructor(
    private readonly batchTrigger: BatchTriggerService,
    private readonly botsService: BotsService,
  ) {}

  @OnEvent('device.result.complete')
  async handleDeviceResultComplete(payload: DeviceResultEvent): Promise<void> {
    this.logger.debug(
      `Received device:result:complete for command ${payload.commandId}`,
    );

    // Get Supervisor Bot for this user
    const supervisorBot = await this.botsService.findSupervisorByUserId(
      payload.userId,
    );
    if (!supervisorBot) {
      this.logger.warn(`No Supervisor Bot found for user ${payload.userId}`);
      return;
    }

    // Construct Agent event
    const event: AgentEvent = {
      type: 'DEVICE_RESULT',
      payload: {
        commandId: payload.commandId,
        command: payload.command,
        status: payload.status,
        output: payload.output,
        error: payload.error,
        deviceId: payload.deviceId,
      },
      timestamp: new Date(),
      source: {
        userId: payload.userId,
        deviceId: payload.deviceId,
      },
    };

    // Add to batch trigger
    this.batchTrigger.addEvent(supervisorBot.id, event);
  }
}
