import os from 'os';

export function getDeviceId(): string {
  return `device-${os.hostname()}-${os.platform()}`;
}

export function getDeviceName(): string {
  return os.hostname();
}

export function getPlatform(): 'darwin' | 'win32' | 'linux' {
  return os.platform() as 'darwin' | 'win32' | 'linux';
}
