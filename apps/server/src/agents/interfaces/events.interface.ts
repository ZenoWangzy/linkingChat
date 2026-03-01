export type AgentEventType =
  | 'DEVICE_RESULT'
  | 'BOT_MESSAGE'
  | 'USER_MESSAGE'
  | 'CROSS_BOT_NOTIFY';

export interface AgentEvent {
  type: AgentEventType;
  payload: DeviceResultPayload | BotMessagePayload | UserMessagePayload | CrossBotNotifyPayload;
  timestamp: Date;
  source: {
    botId?: string;
    userId?: string;
    deviceId?: string;
  };
}

export interface DeviceResultPayload {
  commandId: string;
  command: string;
  status: 'success' | 'error';
  output?: string;
  error?: string;
  deviceId: string;
}

export interface BotMessagePayload {
  botId: string;
  botName: string;
  content: string;
  converseId: string;
}

export interface UserMessagePayload {
  userId: string;
  content: string;
  converseId: string;
}

export interface CrossBotNotifyPayload {
  fromBotId: string;
  fromBotName: string;
  event: string;
  data: Record<string, unknown>;
}

export interface ConversationContext {
  events?: AgentEvent[];
  userId?: string;
  converseId?: string;
  userMessage?: string;
}
