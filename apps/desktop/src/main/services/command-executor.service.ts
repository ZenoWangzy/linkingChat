import { exec } from 'child_process';
import { openClawClientService } from './openclaw-client.service';

export interface CommandResult {
  status: 'success' | 'error';
  data?: {
    output?: string;
    exitCode?: number;
  };
  error?: {
    code: string;
    message: string;
  };
  executionTimeMs: number;
  source?: 'openclaw' | 'child_process';
}

/**
 * Command Executor
 *
 * 执行 shell 命令，支持两种模式：
 * 1. OpenClaw 模式 - 通过 OpenClaw Gateway 执行（推荐）
 * 2. child_process 模式 - 直接执行（降级）
 */
export class CommandExecutor {
  private static readonly DEFAULT_TIMEOUT = 30_000;
  private static readonly MAX_OUTPUT_SIZE = 1024 * 512;

  async execute(
    command: string,
    timeout = CommandExecutor.DEFAULT_TIMEOUT,
  ): Promise<CommandResult> {
    // 优先使用 OpenClaw 模式
    if (openClawClientService.isClientConnected()) {
      try {
        const result = await this.executeViaOpenClaw(command, timeout);
        return { ...result, source: 'openclaw' };
      } catch (error) {
        console.warn(
          '[CommandExecutor] OpenClaw execution failed, falling back to child_process:',
          error,
        );
        // 降级到 child_process
      }
    }

    // 降级到 child_process
    const result = await this.executeWithChildProcess(command, timeout);
    return { ...result, source: 'child_process' };
  }

  /**
   * 通过 OpenClaw Gateway 执行命令
   */
  private async executeViaOpenClaw(
    command: string,
    timeout: number,
  ): Promise<CommandResult> {
    const startTime = Date.now();

    try {
      // 使用 OpenClaw 的 Agent 来执行命令
      // 通过发送消息给 Agent，让它执行 system.run
      const message = `Please execute the following command and return the output: ${command}`;

      const response = await Promise.race([
        openClawClientService.sendMessage(message),
        this.createTimeoutPromise<string>(timeout, 'OpenClaw execution timed out'),
      ]);

      const executionTimeMs = Date.now() - startTime;

      // 解析 Agent 响应
      // TODO: 根据 OpenClaw 的实际响应格式进行解析
      return {
        status: 'success',
        data: {
          output: response,
          exitCode: 0,
        },
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      return {
        status: 'error',
        error: {
          code: 'OPENCLAW_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
        executionTimeMs,
      };
    }
  }

  /**
   * 使用 child_process 执行命令（降级模式）
   */
  private async executeWithChildProcess(
    command: string,
    timeout: number,
  ): Promise<CommandResult> {
    const startTime = Date.now();

    return new Promise<CommandResult>((resolve) => {
      exec(
        command,
        {
          timeout,
          maxBuffer: CommandExecutor.MAX_OUTPUT_SIZE,
          shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        },
        (error, stdout, stderr) => {
          const executionTimeMs = Date.now() - startTime;

          if (error) {
            if ((error as any).killed) {
              resolve({
                status: 'error',
                error: {
                  code: 'COMMAND_TIMEOUT',
                  message: `Command timed out (${timeout}ms)`,
                },
                data: {
                  output: stdout || stderr || undefined,
                  exitCode: (error as any).code ?? 1,
                },
                executionTimeMs,
              });
              return;
            }

            resolve({
              status: 'error',
              data: {
                output: stderr || stdout || error.message,
                exitCode: (error as any).code ?? 1,
              },
              error: {
                code: 'EXEC_ERROR',
                message: error.message,
              },
              executionTimeMs,
            });
            return;
          }

          resolve({
            status: 'success',
            data: {
              output: stdout || '(no output)',
              exitCode: 0,
            },
            executionTimeMs,
          });
        },
      );
    });
  }

  /**
   * 创建超时 Promise
   */
  private createTimeoutPromise<T>(timeout: number, message: string): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeout);
    });
  }
}

// 单例实例
export const commandExecutor = new CommandExecutor();
