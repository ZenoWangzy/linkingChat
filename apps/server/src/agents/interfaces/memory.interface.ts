export interface AgentMemory {
  shortTerm: MemoryEntry[];
  longTerm?: LongTermMemoryStore;
  working: WorkingMemory;
}

export interface MemoryEntry {
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface WorkingMemory {
  currentTask?: TaskContext;
  pendingActions: PendingAction[];
  recentResults: CommandResult[];
}

export interface TaskContext {
  taskId: string;
  type: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt: Date;
  data?: Record<string, unknown>;
}

export interface PendingAction {
  actionId: string;
  type: string;
  description: string;
  createdAt: Date;
}

export interface CommandResult {
  commandId: string;
  command: string;
  status: 'success' | 'error';
  output?: string;
  error?: string;
  completedAt: Date;
}

export interface LongTermMemoryStore {
  // Placeholder for future vector store integration
  search(query: string, limit: number): Promise<MemoryEntry[]>;
  add(entry: MemoryEntry): Promise<void>;
}
