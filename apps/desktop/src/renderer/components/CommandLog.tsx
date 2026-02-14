interface CommandLogEntry {
  commandId: string;
  action: string;
  type: string;
  status: string;
  output?: string;
  exitCode?: number;
  executionTimeMs?: number;
  receivedAt: string;
  completedAt?: string;
}

interface CommandLogProps {
  entries: CommandLogEntry[];
}

const STATUS_STYLE: Record<string, { icon: string; className: string }> = {
  pending: { icon: '[ ]', className: 'status-pending' },
  running: { icon: '[~]', className: 'status-running' },
  success: { icon: '[v]', className: 'status-success' },
  error: { icon: '[x]', className: 'status-error' },
  blocked: { icon: '[!]', className: 'status-blocked' },
};

export function CommandLog({ entries }: CommandLogProps) {
  if (entries.length === 0) {
    return (
      <section className="command-log">
        <h2>Command Log</h2>
        <p className="empty-state">
          No commands yet. Waiting for commands from mobile...
        </p>
      </section>
    );
  }

  return (
    <section className="command-log">
      <h2>Command Log ({entries.length})</h2>
      <div className="log-list">
        {entries.map((entry) => {
          const style = STATUS_STYLE[entry.status] || STATUS_STYLE.pending;
          return (
            <div
              key={entry.commandId}
              className={`log-entry ${style.className}`}
            >
              <div className="log-header">
                <span className="log-status">{style.icon}</span>
                <code className="log-action">{entry.action}</code>
                {entry.executionTimeMs != null && (
                  <span className="log-time">{entry.executionTimeMs}ms</span>
                )}
              </div>
              {entry.output && (
                <pre className="log-output">{entry.output}</pre>
              )}
              <div className="log-meta">
                <span>ID: {entry.commandId.slice(0, 8)}...</span>
                <span>
                  {new Date(entry.receivedAt).toLocaleTimeString()}
                </span>
                {entry.exitCode != null && (
                  <span>Exit: {entry.exitCode}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
