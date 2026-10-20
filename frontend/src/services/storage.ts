/**
 * Safe local storage service.
 * Enforces quality bar:
 * - NEVER store, log, or display private keys.
 * - Only passkey credential id, public key coordinates (qx, qy), and derived userId are kept.
 * - All access wrapped in try/catch to handle restricted browser environments (private mode, etc.).
 */

export interface StoredPasskey {
  credentialId: string;
  rawId: string;
  userId: string;
  qx: string; // hex
  qy: string; // hex
  createdAt: number;
}

export interface ActiveSessionAccount {
  type: "passkey" | "wallet";
  address: `0x${string}`;
  credentialId?: string;
  rawId?: string;
  qx?: string;
  qy?: string;
}

const PASSKEYS_KEY = "aegis_passkeys_v1";
const ACTIVE_ACCOUNT_KEY = "aegis_active_account_v1";

export const safeStorage = {
  getStoredPasskeys(): StoredPasskey[] {
    try {
      const data = localStorage.getItem(PASSKEYS_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn("safeStorage.getStoredPasskeys failed:", err);
      return [];
    }
  },

  savePasskey(passkey: StoredPasskey): void {
    try {
      const existing = this.getStoredPasskeys();
      const filtered = existing.filter((p) => p.credentialId !== passkey.credentialId);
      filtered.unshift(passkey);
      localStorage.setItem(PASSKEYS_KEY, JSON.stringify(filtered));
    } catch (err) {
      console.warn("safeStorage.savePasskey failed:", err);
    }
  },

  getActiveAccount(): ActiveSessionAccount | null {
    try {
      const data = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
      if (!data) return null;
      return JSON.parse(data);
    } catch (err) {
      console.warn("safeStorage.getActiveAccount failed:", err);
      return null;
    }
  },

  setActiveAccount(account: ActiveSessionAccount | null): void {
    try {
      if (!account) {
        localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
      } else {
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, JSON.stringify(account));
      }
    } catch (err) {
      console.warn("safeStorage.setActiveAccount failed:", err);
    }
  },

  clearAll(): void {
    try {
      localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
      localStorage.removeItem(PASSKEYS_KEY);
    } catch (err) {
      console.warn("safeStorage.clearAll failed:", err);
    }
  },
};
