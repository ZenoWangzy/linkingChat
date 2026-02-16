export const DEVICE_EVENTS = {
  // Client → Server
  REGISTER: 'device:register',
  HEARTBEAT: 'device:heartbeat',
  COMMAND_SEND: 'device:command:send',
  COMMAND_CANCEL: 'device:command:cancel',
  RESULT_COMPLETE: 'device:result:complete',
  RESULT_PROGRESS: 'device:result:progress',

  // Server → Client
  COMMAND_EXECUTE: 'device:command:execute',
  COMMAND_ACK: 'device:command:ack',
  RESULT_DELIVERED: 'device:result:delivered',
  RESULT_PROGRESS_FWD: 'device:result:progress', // same event name, Socket.IO distinguishes by direction
  STATUS_CHANGED: 'device:status:changed',
} as const;

export const CHAT_EVENTS = {
  // Client → Server
  CONVERSE_JOIN:   'converse:join',
  CONVERSE_LEAVE:  'converse:leave',
  MESSAGE_TYPING:  'message:typing',
  MESSAGE_READ:    'message:read',
  PRESENCE_UPDATE: 'presence:update',

  // Server → Client
  MESSAGE_NEW:       'message:new',
  MESSAGE_UPDATED:   'message:updated',
  MESSAGE_DELETED:   'message:deleted',
  FRIEND_REQUEST:    'friend:request',
  FRIEND_ACCEPTED:   'friend:accepted',
  FRIEND_REMOVED:    'friend:removed',
  CONVERSE_NEW:      'converse:new',
  CONVERSE_UPDATED:  'converse:updated',
  PRESENCE_CHANGED:  'presence:changed',
  NOTIFICATION_NEW:  'notification:new',
  BOT_NOTIFICATION:  'bot:notification',

  // Group events (Server → Client)
  GROUP_CREATED:              'group:created',
  GROUP_UPDATED:              'group:updated',
  GROUP_DELETED:              'group:deleted',
  GROUP_MEMBER_ADDED:         'group:member:added',
  GROUP_MEMBER_REMOVED:       'group:member:removed',
  GROUP_MEMBER_ROLE_UPDATED:  'group:member:role:updated',
} as const;

export const AI_EVENTS = {
  // Whisper — @ai 建议 (Sprint 3)
  WHISPER_SUGGESTIONS: 'ai:whisper:suggestions',
  WHISPER_REQUEST:     'ai:whisper:request',
  WHISPER_ACCEPT:      'ai:whisper:accept',

  // Draft & Verify — 草稿确认 (Sprint 3)
  DRAFT_CREATED:  'ai:draft:created',
  DRAFT_APPROVE:  'ai:draft:approve',
  DRAFT_REJECT:   'ai:draft:reject',
  DRAFT_EDIT:     'ai:draft:edit',
  DRAFT_EXPIRED:  'ai:draft:expired',

  // Predictive Actions — 预测执行 (Sprint 3)
  PREDICTIVE_ACTION:  'ai:predictive:action',
  PREDICTIVE_EXECUTE: 'ai:predictive:execute',
  PREDICTIVE_DISMISS: 'ai:predictive:dismiss',
} as const;
