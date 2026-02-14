import Store from 'electron-store';
import { safeStorage } from 'electron';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const store = new Store<{ encryptedTokens?: string }>({
  name: 'linkingchat-auth',
});

export class AuthStore {
  static save(tokens: TokenPair): void {
    const json = JSON.stringify(tokens);
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(json);
      store.set('encryptedTokens', encrypted.toString('base64'));
    } else {
      store.set('encryptedTokens', json);
    }
  }

  static load(): TokenPair | null {
    const raw = store.get('encryptedTokens');
    if (!raw) return null;

    try {
      if (safeStorage.isEncryptionAvailable()) {
        const decrypted = safeStorage.decryptString(
          Buffer.from(raw, 'base64'),
        );
        return JSON.parse(decrypted);
      }
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  static clear(): void {
    store.delete('encryptedTokens');
  }
}
