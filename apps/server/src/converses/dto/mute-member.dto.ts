import { IsNumber, Min, Max } from 'class-validator';

// Telegram 风格的预设时长（分钟）
export const MUTE_PRESETS = {
  ONE_MINUTE: 1,
  TEN_MINUTES: 10,
  ONE_HOUR: 60,
  ONE_DAY: 1440,
  ONE_WEEK: 10080,
  ONE_MONTH: 43200,
} as const;

export class MuteMemberDto {
  @IsNumber()
  @Min(1)
  @Max(43200) // 最长 30 天
  durationMinutes!: number;
}
