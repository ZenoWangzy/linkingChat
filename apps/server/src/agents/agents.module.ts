import { Module, OnModuleInit } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RedisModule } from '../redis/redis.module';
import { AiModule } from '../ai/ai.module';
import { BotsModule } from '../bots/bots.module';
import { MessagesModule } from '../messages/messages.module';
import { GatewayModule } from '../gateway/gateway.module';

// Core
import { AgentMemoryService } from './core/memory.service';
import { AgentWorkspaceService } from './core/workspace.service';

// Orchestrator
import { AgentOrchestratorService } from './orchestrator/agent-orchestrator.service';

// Events
import { BatchTriggerService } from './events/batch-trigger.service';
import { BotEventListener } from './events/bot-event.listener';

// Agents
import { SupervisorAgent } from './impl/supervisor.agent';

@Module({
  imports: [
    RedisModule,
    AiModule,
    BotsModule,
    MessagesModule,
    GatewayModule,
    EventEmitterModule.forRoot(),
  ],
  providers: [
    // Core
    AgentMemoryService,
    AgentWorkspaceService,

    // Orchestrator
    AgentOrchestratorService,

    // Events
    BatchTriggerService,
    BotEventListener,

    // Agents
    SupervisorAgent,
  ],
  exports: [
    AgentOrchestratorService,
    AgentMemoryService,
    AgentWorkspaceService,
  ],
})
export class AgentsModule implements OnModuleInit {
  constructor(
    private readonly orchestrator: AgentOrchestratorService,
    private readonly supervisorAgent: SupervisorAgent,
  ) {}

  onModuleInit() {
    // Register Supervisor Agent
    this.orchestrator.registerAgent(this.supervisorAgent);
  }
}
