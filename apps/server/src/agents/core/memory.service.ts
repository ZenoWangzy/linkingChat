import { Injectable, Logger, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  AgentMemory,
  MemoryEntry,
  WorkingMemory,
  CommandResult,
} from '../interfaces';

@Injectable()
export class AgentMemoryService {
  private readonly logger = new Logger(AgentMemoryService.name);
  private readonly SHORT_TERM_LIMIT = 20;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async getShortTermMemory(botId: string): Promise<MemoryEntry[]> {
    const key = this.getShortTermKey(botId);
    const data = await this.redis.lrange(key, 0, this.SHORT_TERM_LIMIT - 1);
    return data.map((d) => this.parseEntry(d)).filter(Boolean) as MemoryEntry[];
  }

  async addShortTermMemory(botId: string, entry: MemoryEntry): Promise<void> {
    const key = this.getShortTermKey(botId);
    await this.redis.lpush(key, JSON.stringify(entry));
    await this.redis.ltrim(key, 0, this.SHORT_TERM_LIMIT - 1);
    await this.redis.expire(key, 86400); // 24 hours
  }

  async getWorkingMemory(botId: string): Promise<WorkingMemory> {
    const key = this.getWorkingKey(botId);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : this.createEmptyWorkingMemory();
  }

  async updateWorkingMemory(botId: string, memory: WorkingMemory): Promise<void> {
    const key = this.getWorkingKey(botId);
    await this.redis.set(key, JSON.stringify(memory), 'EX', 86400);
  }

  async addCommandResult(botId: string, result: CommandResult): Promise<void> {
    const working = await this.getWorkingMemory(botId);
    working.recentResults.push(result);
    if (working.recentResults.length > 10) {
      working.recentResults = working.recentResults.slice(-10);
    }
    await this.updateWorkingMemory(botId, working);
  }

  async clearMemory(botId: string): Promise<void> {
    await this.redis.del(this.getShortTermKey(botId));
    await this.redis.del(this.getWorkingKey(botId));
  }

  private getShortTermKey(botId: string): string {
    return `agent:${botId}:memory:short`;
  }

  private getWorkingKey(botId: string): string {
    return `agent:${botId}:memory:working`;
  }

  private createEmptyWorkingMemory(): WorkingMemory {
    return {
      pendingActions: [],
      recentResults: [],
    };
  }

  private parseEntry(data: string): MemoryEntry | null {
    try {
      const parsed = JSON.parse(data);
      return {
        ...parsed,
        timestamp: new Date(parsed.timestamp),
      };
    } catch {
      return null;
    }
  }
}
