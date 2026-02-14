import { useState, useEffect } from 'react';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { CommandLog } from '../components/CommandLog';

interface DeviceInfo {
  deviceId: string;
  name: string;
  platform: string;
}

export interface CommandLogEntry {
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

interface DashboardProps {
  onLogout: () => void;
}

export function Dashboard({ onLogout }: DashboardProps) {
  const [status, setStatus] = useState<string>('disconnected');
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [commandLog, setCommandLog] = useState<CommandLogEntry[]>([]);

  useEffect(() => {
    window.electronAPI.getConnectionStatus().then(setStatus);
    window.electronAPI.getDeviceInfo().then(setDeviceInfo);
    window.electronAPI.getCommandLog().then(setCommandLog);

    window.electronAPI.onConnectionStatusChanged((newStatus: string) => {
      setStatus(newStatus);
    });

    window.electronAPI.onCommandReceived((entry: unknown) => {
      setCommandLog((prev) => {
        const typedEntry = entry as CommandLogEntry;
        const existingIdx = prev.findIndex(
          (e) => e.commandId === typedEntry.commandId,
        );
        if (existingIdx !== -1) {
          const updated = [...prev];
          updated[existingIdx] = typedEntry;
          return updated;
        }
        return [typedEntry, ...prev];
      });
    });
  }, []);

  const handleLogout = async () => {
    await window.electronAPI.logout();
    onLogout();
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>LinkingChat Desktop</h1>
        <button className="btn-secondary" onClick={handleLogout}>
          Logout
        </button>
      </header>

      <ConnectionStatus status={status} deviceInfo={deviceInfo} />
      <CommandLog entries={commandLog} />
    </div>
  );
}
