export interface AgentWorkspace {
  state: Record<string, unknown>;
  config: BotConfig;
  sessionId: string;
}

export interface BotConfig {
  language: string;
  timezone: string;
  settings: Record<string, unknown>;
  allowedTools: string[];
}
