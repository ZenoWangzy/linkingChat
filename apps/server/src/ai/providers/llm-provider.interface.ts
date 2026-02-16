/**
 * LLM Provider 接口
 *
 * 所有 LLM 供应商（DeepSeek、Kimi 等）实现此接口，
 * 由 LlmRouterService 统一调度。
 */

export type LlmTaskType =
  | 'whisper'
  | 'draft'
  | 'predictive'
  | 'chat'
  | 'complex_analysis';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  taskType: LlmTaskType;
  systemPrompt: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export interface LlmResponse {
  content: string;
  provider: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LlmChunk {
  content: string;
  done: boolean;
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest, options?: LlmOptions): Promise<LlmResponse>;
  stream(
    request: LlmRequest,
    options?: LlmOptions,
  ): AsyncIterable<LlmChunk>;
}
