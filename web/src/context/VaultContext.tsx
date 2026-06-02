import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { VaultClient } from '@kairox/sdk';
import { TauriVaultClient } from '@/tauri/client.ts';

// ── Detect Tauri runtime ──────────────────────────────────────────────────────

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ── Unified client interface ──────────────────────────────────────────────────
// Both VaultClient and TauriVaultClient expose the same public API; we use
// the union type so the context is transparent to all consumers.

type AnyVaultClient = VaultClient | TauriVaultClient;

// ── Types ─────────────────────────────────────────────────────────────────────

interface VaultContextType {
  client: AnyVaultClient;
  isLocked: boolean;
  isLoading: boolean;
  email: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  lock: () => Promise<void>;
}

// ── Singleton client (one per tab / window) ───────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const client: AnyVaultClient = IS_TAURI
  ? new TauriVaultClient(API_BASE)
  : new VaultClient({ baseUrl: API_BASE });

// ── Context ───────────────────────────────────────────────────────────────────

const VaultContext = createContext<VaultContextType | null>(null);

const AUTO_LOCK_MS = 15 * 60 * 1000;

export function VaultProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked]   = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail]         = useState<string | null>(null);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auto-lock on inactivity ────────────────────────────────────────────────

  const scheduleLock = useCallback(() => {
    if (lockTimer.current) clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(async () => {
      await client.lock();
      setIsLocked(true);
      setEmail(null);
    }, AUTO_LOCK_MS);
  }, []);

  useEffect(() => {
    if (isLocked) return;
    const reset = () => scheduleLock();
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const;
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    scheduleLock();
    return () => {
      events.forEach(e => window.removeEventListener(e, reset));
      if (lockTimer.current) clearTimeout(lockTimer.current);
    };
  }, [isLocked, scheduleLock]);

  // ── Tauri tray "Lock" event ────────────────────────────────────────────────

  useEffect(() => {
    if (!IS_TAURI) return;
    const tauriClient = client as TauriVaultClient;
    let unlisten: (() => void) | undefined;

    void tauriClient.onTrayLock(async () => {
      if (lockTimer.current) clearTimeout(lockTimer.current);
      await client.lock();
      setIsLocked(true);
      setEmail(null);
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const login = useCallback(async (e: string, password: string) => {
    setIsLoading(true);
    try {
      await client.login(e, password);
      setEmail(e);
      setIsLocked(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (e: string, password: string) => {
    setIsLoading(true);
    try {
      await client.register(e, password);
      setEmail(e);
      setIsLocked(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const lock = useCallback(async () => {
    if (lockTimer.current) clearTimeout(lockTimer.current);
    await client.lock();
    setIsLocked(true);
    setEmail(null);
  }, []);

  return (
    <VaultContext.Provider value={{ client, isLocked, isLoading, email, login, register, lock }}>
      {children}
    </VaultContext.Provider>
  );
}

export function useVault(): VaultContextType {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used inside <VaultProvider>');
  return ctx;
}
