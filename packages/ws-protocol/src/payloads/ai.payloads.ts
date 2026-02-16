// ========== AI Whisper ==========

/** ai:whisper:suggestions 事件的 payload (S→C) */
export interface WhisperSuggestionsPayload {
  suggestionId: string;
  converseId: string;
  messageId: string;
  primary: string;
  alternatives: string[];
  createdAt: string; // ISO 8601
}

/** ai:whisper:request 事件的 payload (C→S) */
export interface WhisperRequestPayload {
  converseId: string;
  messageId?: string;
}

/** ai:whisper:accept 事件的 payload (C→S) */
export interface WhisperAcceptPayload {
  suggestionId: string;
  selectedIndex: number; // 0 = primary, 1-2 = alternatives
}

// ========== AI Draft & Verify ==========

/** ai:draft:created 事件的 payload (S→C) */
export interface DraftCreatedPayload {
  draftId: string;
  converseId: string;
  botId: string;
  botName: string;
  draftType: 'message' | 'command';
  draftContent: {
    content: string;
    action?: string;
    args?: Record<string, unknown>;
  };
  expiresAt: string; // ISO 8601
  createdAt: string; // ISO 8601
}

/** ai:draft:approve 事件的 payload (C→S) */
export interface DraftApprovePayload {
  draftId: string;
}

/** ai:draft:reject 事件的 payload (C→S) */
export interface DraftRejectPayload {
  draftId: string;
  reason?: string;
}

/** ai:draft:edit 事件的 payload (C→S) */
export interface DraftEditPayload {
  draftId: string;
  editedContent: {
    content: string;
    action?: string;
    args?: Record<string, unknown>;
  };
}

/** ai:draft:expired 事件的 payload (S→C) */
export interface DraftExpiredPayload {
  draftId: string;
  converseId: string;
}

// ========== AI Predictive Actions ==========

export type DangerLevel = 'safe' | 'warning' | 'dangerous';

export interface PredictiveAction {
  type: 'shell' | 'message' | 'file';
  action: string;
  description: string;
  dangerLevel: DangerLevel;
}

/** ai:predictive:action 事件的 payload (S→C) */
export interface PredictiveActionPayload {
  suggestionId: string;
  converseId: string;
  trigger: string;
  actions: PredictiveAction[];
  createdAt: string; // ISO 8601
}

/** ai:predictive:execute 事件的 payload (C→S) */
export interface PredictiveExecutePayload {
  suggestionId: string;
  actionIndex: number;
}

/** ai:predictive:dismiss 事件的 payload (C→S) */
export interface PredictiveDismissPayload {
  suggestionId: string;
}
