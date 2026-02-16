import type { WsResponse, WsEnvelope } from './envelope';
import type {
  DeviceRegisterPayload,
  DeviceHeartbeatPayload,
  DeviceCommandPayload,
  DeviceResultPayload,
  DeviceStatusPayload,
} from './payloads/device.payloads';
import type {
  FriendRequestPayload,
  FriendAcceptedPayload,
  FriendRemovedPayload,
  MessageResponse,
  ConverseNewPayload,
  ConverseResponse,
  TypingPayload,
  MessageReadPayload,
  PresenceUpdatePayload,
  PresencePayload,
  GroupCreatedPayload,
  GroupUpdatedPayload,
  GroupDeletedPayload,
  GroupMemberAddedPayload,
  GroupMemberRemovedPayload,
  GroupMemberRoleUpdatedPayload,
} from './payloads/chat.payloads';
import type {
  WhisperSuggestionsPayload,
  WhisperRequestPayload,
  WhisperAcceptPayload,
  DraftCreatedPayload,
  DraftApprovePayload,
  DraftRejectPayload,
  DraftEditPayload,
  DraftExpiredPayload,
  PredictiveActionPayload,
  PredictiveExecutePayload,
  PredictiveDismissPayload,
} from './payloads/ai.payloads';

export interface SocketData {
  userId: string;
  username: string;
  deviceId?: string;
  deviceType: 'mobile' | 'desktop' | 'web';
}

export interface ClientToServerEvents {
  // Device events (Sprint 1)
  'device:register': (
    data: DeviceRegisterPayload,
    ack: (res: WsResponse) => void,
  ) => void;
  'device:heartbeat': (data: DeviceHeartbeatPayload) => void;
  'device:command:send': (
    data: WsEnvelope<DeviceCommandPayload>,
    ack: (res: WsResponse) => void,
  ) => void;
  'device:command:cancel': (
    data: { commandId: string },
    ack: (res: WsResponse) => void,
  ) => void;
  'device:result:complete': (data: WsEnvelope<DeviceResultPayload>) => void;
  'device:result:progress': (data: {
    commandId: string;
    progress: number;
    output?: string;
  }) => void;

  // Chat events (Sprint 2)
  'converse:join': (
    data: { converseId: string },
    ack: (res: WsResponse) => void,
  ) => void;
  'converse:leave': (data: { converseId: string }) => void;
  'message:typing': (data: TypingPayload) => void;
  'message:read': (
    data: MessageReadPayload,
    ack: (res: WsResponse) => void,
  ) => void;
  'presence:update': (data: PresenceUpdatePayload) => void;

  // AI events (Sprint 3)
  'ai:whisper:request': (
    data: WhisperRequestPayload,
    ack: (res: WsResponse) => void,
  ) => void;
  'ai:whisper:accept': (
    data: WhisperAcceptPayload,
    ack: (res: WsResponse) => void,
  ) => void;
  'ai:draft:approve': (
    data: DraftApprovePayload,
    ack: (res: WsResponse) => void,
  ) => void;
  'ai:draft:reject': (
    data: DraftRejectPayload,
    ack: (res: WsResponse) => void,
  ) => void;
  'ai:draft:edit': (
    data: DraftEditPayload,
    ack: (res: WsResponse) => void,
  ) => void;
  'ai:predictive:execute': (
    data: PredictiveExecutePayload,
    ack: (res: WsResponse) => void,
  ) => void;
  'ai:predictive:dismiss': (
    data: PredictiveDismissPayload,
    ack: (res: WsResponse) => void,
  ) => void;
}

export interface ServerToClientEvents {
  // Device events (Sprint 1)
  'device:command:execute': (data: DeviceCommandPayload) => void;
  'device:command:ack': (data: {
    commandId: string;
    status: string;
  }) => void;
  'device:result:delivered': (data: DeviceResultPayload) => void;
  'device:result:progress': (data: {
    commandId: string;
    progress: number;
    output?: string;
  }) => void;
  'device:status:changed': (data: DeviceStatusPayload) => void;
  'system:error': (data: { code: string; message: string }) => void;

  // Chat events (Sprint 2)
  'message:new': (data: MessageResponse) => void;
  'message:updated': (data: MessageResponse) => void;
  'message:deleted': (data: { messageId: string; converseId: string }) => void;
  'friend:request': (data: FriendRequestPayload) => void;
  'friend:accepted': (data: FriendAcceptedPayload) => void;
  'friend:removed': (data: FriendRemovedPayload) => void;
  'converse:new': (data: ConverseNewPayload) => void;
  'converse:updated': (data: ConverseResponse) => void;
  'presence:changed': (data: PresencePayload) => void;
  'notification:new': (data: Record<string, unknown>) => void;
  'bot:notification': (data: Record<string, unknown>) => void;

  // Group events (Sprint 2 Phase 8)
  'group:created': (data: GroupCreatedPayload) => void;
  'group:updated': (data: GroupUpdatedPayload) => void;
  'group:deleted': (data: GroupDeletedPayload) => void;
  'group:member:added': (data: GroupMemberAddedPayload) => void;
  'group:member:removed': (data: GroupMemberRemovedPayload) => void;
  'group:member:role:updated': (data: GroupMemberRoleUpdatedPayload) => void;

  // AI events (Sprint 3)
  'ai:whisper:suggestions': (data: WhisperSuggestionsPayload) => void;
  'ai:draft:created': (data: DraftCreatedPayload) => void;
  'ai:draft:expired': (data: DraftExpiredPayload) => void;
  'ai:predictive:action': (data: PredictiveActionPayload) => void;
}

// These types require socket.io as a peer dependency.
// They are re-exported as type-only to avoid runtime dependency.
// Consumers must cast their Server/Socket instances.
export type TypedServer = any;
export type TypedSocket = any;
