interface DeviceInfo {
  deviceId: string;
  name: string;
  platform: string;
}

interface ConnectionStatusProps {
  status: string;
  deviceInfo: DeviceInfo | null;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  connected: { label: 'Connected', color: '#4caf50' },
  connecting: { label: 'Connecting...', color: '#ff9800' },
  disconnected: { label: 'Disconnected', color: '#f44336' },
};

export function ConnectionStatus({
  status,
  deviceInfo,
}: ConnectionStatusProps) {
  const { label, color } = STATUS_MAP[status] || STATUS_MAP.disconnected;

  return (
    <section className="connection-status">
      <div className="status-indicator">
        <span className="status-dot" style={{ backgroundColor: color }} />
        <span className="status-label">{label}</span>
      </div>

      {deviceInfo && (
        <div className="device-info">
          <span>
            <strong>Device:</strong> {deviceInfo.name}
          </span>
          <span>
            <strong>Platform:</strong> {deviceInfo.platform}
          </span>
          <span>
            <strong>ID:</strong> <code>{deviceInfo.deviceId}</code>
          </span>
        </div>
      )}
    </section>
  );
}
