import { IsString, IsOptional, IsNumber, IsArray, IsIn, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { LlmTaskType } from '../providers/llm-provider.interface';

export class LlmMessageDto {
  @IsString()
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  content: string;
}

export class LlmRequestDto {
  @IsString()
  @IsIn(['whisper', 'draft', 'predictive', 'chat', 'complex_analysis'])
  taskType: LlmTaskType;

  @IsString()
  systemPrompt: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LlmMessageDto)
  messages: LlmMessageDto[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(8192)
  maxTokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;
}
