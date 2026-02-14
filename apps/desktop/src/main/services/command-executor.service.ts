import { exec } from 'child_process';

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
}

export class CommandExecutor {
  private static readonly DEFAULT_TIMEOUT = 30_000;
  private static readonly MAX_OUTPUT_SIZE = 1024 * 512;

  async execute(
    command: string,
    timeout = CommandExecutor.DEFAULT_TIMEOUT,
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
}
