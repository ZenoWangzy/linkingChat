import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import { createWsAuthMiddleware } from './middleware/ws-auth.middleware';
import { DevicesService } from '../devices/devices.service';
import { CommandsService } from '../devices/commands.service';
import type {
  DeviceRegisterPayload,
  DeviceCommandPayload,
  DeviceResultPayload,
  WsEnvelope,
  WsResponse,
} from '@linkingchat/ws-protocol';

const DANGEROUS_PATTERNS: RegExp[] = [
  /^rm\s+(-rf?|--recursive)\s+\//,
  /^rm\s+-rf?\s+~/,
  /^format\s/i,
  /^mkfs\./,
  /^dd\s+if=/,
  /^:\(\)\{.*\|.*&\s*\}\s*;/,
  /shutdown|reboot|halt|poweroff/i,
  /^chmod\s+(-R\s+)?777\s+\//,
  /^chown\s+(-R\s+)?.*\s+\//,
  />\s*\/dev\/sd[a-z]/,
  /\|\s*bash\s*$/,
  /curl.*\|\s*sh/i,
];

function isDangerousCommand(action: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(action.trim()));
}

@WebSocketGateway({ namespace: '/device' })
export class DeviceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(DeviceGateway.name);

  @WebSocketServer()
  namespace: Namespace;

  private socketDeviceMap = new Map<string, string>();

  constructor(
    private readonly devicesService: DevicesService,
    private readonly commandsService: CommandsService,
  ) {}

  afterInit(namespace: Namespace) {
    namespace.use(createWsAuthMiddleware());
    this.logger.log('Device Gateway initialized with RS256 auth middleware');
  }

  async handleConnection(client: Socket) {
    const userId = client.data.userId;
    client.join(`u-${userId}`);
    this.logger.log(
      `Client connected: ${client.id} | userId=${userId} | deviceType=${client.data.deviceType}`,
    );
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    const deviceId = this.socketDeviceMap.get(client.id);

    if (deviceId) {
      try {
        const device = await this.devicesService.setOffline(deviceId);
        this.socketDeviceMap.delete(client.id);

        this.namespace.to(`u-${userId}`).emit('device:status:changed', {
          deviceId: device.id,
          name: device.name,
          platform: device.platform as 'darwin' | 'win32' | 'linux',
          online: false,
          lastSeenAt:
            device.lastSeenAt?.toISOString() ?? new Date().toISOString(),
        });
      } catch (error) {
        this.logger.error(
          `Failed to set device offline: ${deviceId}`,
          error,
        );
      }
    }

    this.logger.log(`Client disconnected: ${client.id} | userId=${userId}`);
  }

  @SubscribeMessage('device:register')
  async handleRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: DeviceRegisterPayload,
  ): Promise<WsResponse> {
    const userId = client.data.userId;

    try {
      const device = await this.devicesService.upsertDevice(userId, {
        deviceId: data.deviceId,
        name: data.name,
        platform: data.platform,
      });

      client.join(`d-${data.deviceId}`);
      this.socketDeviceMap.set(client.id, data.deviceId);
      client.data.deviceId = data.deviceId;

      this.namespace.to(`u-${userId}`).emit('device:status:changed', {
        deviceId: device.id,
        name: device.name,
        platform: device.platform as 'darwin' | 'win32' | 'linux',
        online: true,
        lastSeenAt:
          device.lastSeenAt?.toISOString() ?? new Date().toISOString(),
      });

      this.logger.log(
        `Device registered: ${data.deviceId} (${data.platform}) for user ${userId}`,
      );

      return {
        success: true,
        data: { deviceId: device.id },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Device register failed: ${error.message}`);
      return {
        success: false,
        error: { code: 'REGISTER_FAILED', message: error.message },
        timestamp: new Date().toISOString(),
      };
    }
  }

  @SubscribeMessage('device:heartbeat')
  async handleHeartbeat(
    @MessageBody() data: { deviceId: string },
  ): Promise<void> {
    await this.devicesService.updateLastSeen(data.deviceId);
    this.logger.debug(`Heartbeat: device=${data.deviceId}`);
  }

  @SubscribeMessage('device:command:send')
  async handleCommandSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() envelope: WsEnvelope<DeviceCommandPayload>,
  ): Promise<WsResponse> {
    const userId = client.data.userId;
    const payload = envelope.data;

    try {
      if (payload.type === 'shell' && isDangerousCommand(payload.action)) {
        this.logger.warn(
          `Dangerous command blocked: "${payload.action}" from user ${userId}`,
        );
        return {
          requestId: envelope.requestId,
          success: false,
          error: {
            code: 'COMMAND_DANGEROUS',
            message: `Command blocked by safety filter: "${payload.action}"`,
          },
          timestamp: new Date().toISOString(),
        };
      }

      const command = await this.commandsService.create({
        type: payload.type,
        payload: {
          action: payload.action,
          args: payload.args,
          timeout: payload.timeout,
        },
        deviceId: payload.targetDeviceId,
        issuerId: userId,
      });

      const commandToExecute: DeviceCommandPayload = {
        commandId: command.id,
        targetDeviceId: payload.targetDeviceId,
        type: payload.type as 'shell' | 'file' | 'automation',
        action: payload.action,
        args: payload.args,
        timeout: payload.timeout ?? 30000,
      };

      this.namespace
        .to(`d-${payload.targetDeviceId}`)
        .emit('device:command:execute', commandToExecute);

      this.namespace
        .to(`u-${userId}`)
        .emit('device:command:ack', {
          commandId: command.id,
          status: 'dispatched',
        });

      this.logger.log(
        `Command dispatched: ${command.id} → device ${payload.targetDeviceId}`,
      );

      return {
        requestId: envelope.requestId,
        success: true,
        data: { commandId: command.id, status: 'dispatched' },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Command send failed: ${error.message}`);
      return {
        requestId: envelope.requestId,
        success: false,
        error: { code: 'COMMAND_FAILED', message: error.message },
        timestamp: new Date().toISOString(),
      };
    }
  }

  @SubscribeMessage('device:command:cancel')
  async handleCommandCancel(
    @MessageBody() data: { commandId: string },
  ): Promise<WsResponse> {
    try {
      await this.commandsService.complete(data.commandId, {
        status: 'CANCELLED',
        data: null,
      });
      return { success: true, timestamp: new Date().toISOString() };
    } catch (error) {
      return {
        success: false,
        error: { code: 'CANCEL_FAILED', message: error.message },
        timestamp: new Date().toISOString(),
      };
    }
  }

  @SubscribeMessage('device:result:complete')
  async handleResultComplete(
    @MessageBody() envelope: WsEnvelope<DeviceResultPayload>,
  ): Promise<void> {
    const result = envelope.data;

    try {
      const command = await this.commandsService.complete(result.commandId, {
        status: result.status === 'success' ? 'COMPLETED' : 'FAILED',
        data: {
          output: result.data?.output,
          exitCode: result.data?.exitCode,
          executionTimeMs: result.executionTimeMs,
          error: result.error,
        },
      });

      this.namespace
        .to(`u-${command.issuerId}`)
        .emit('device:result:delivered', result);

      this.logger.log(
        `Result delivered: command=${result.commandId} status=${result.status} → user ${command.issuerId}`,
      );
    } catch (error) {
      this.logger.error(
        `Result complete failed: commandId=${result.commandId} error=${error.message}`,
      );
    }
  }
}
