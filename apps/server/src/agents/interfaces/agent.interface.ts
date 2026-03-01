import { AgentEvent, ConversationContext } from './events.interface';
import { AgentMemory } from './memory.interface';
import { AgentWorkspace } from './workspace.interface';

export type AgentRole = 'supervisor' | 'coding' | 'social' | 'custom';

export interface IAgent {
  // Identity
  readonly id: string;
  readonly botId: string;
  readonly name: string;
  readonly role: AgentRole;

  // Core capabilities
  handleEvent(events: AgentEvent[]): Promise<void>;
  generateResponse(context: ConversationContext): Promise<AgentResponse>;

  // State access
  getMemory(): Promise<AgentMemory>;
  getWorkspace(): Promise<AgentWorkspace>;

  // Tools
  getTools(): AgentTool[];
}

export interface AgentResponse {
  content: string;
  actions?: AgentAction[];
  metadata?: Record<string, unknown>;
}

export interface AgentAction {
  type: 'view' | 'execute' | 'navigate';
  label: string;
  target: string;
  data?: Record<string, unknown>;
}

export interface AgentTool {
  name: string;
  description: string;
  execute: (args: unknown) => Promise<unknown>;
}
