/// Mirror of packages/ws-protocol/src/events.ts
/// Must be kept in sync manually until code generation is added in Sprint 2.
class WsEvents {
  // Client -> Server
  static const commandSend = 'device:command:send';
  static const commandCancel = 'device:command:cancel';

  // Server -> Client
  static const commandAck = 'device:command:ack';
  static const commandSendError = 'device:command:sendError'; // client-only
  static const resultDelivered = 'device:result:delivered';
  static const resultProgress = 'device:result:progress';
  static const statusChanged = 'device:status:changed';
}
