// Koku wallet state (economy, branch 1). Server-authoritative: the balance lives in Postgres and
// only the backend can change it (earn via /check, spend via /wallet/spend). This store is a cached
// mirror — refreshed on login and patched from /check responses so the TopBar updates instantly.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getWallet, spendItem, type SpendItem, type Wallet } from "../services/api";
import { useAuth } from "./auth";
import { captureAccountScope, isCurrentAccountScope, subscribeAccountScope, type AccountScope } from "./accountScope";

// Client-side mirror of backend config (core/config.py) for display; the server enforces the real
// values, so a drift here is cosmetic only.
export const PRICE_EXTRA_PACK = 50;
export const EXTRA_PACK_SIZE = 10;

type WalletContextValue = {
  ready: boolean; // false until the first fetch after login resolves (or fails)
  coins: number;
  freezes: number;
  isPremium: boolean;
  /** Exercises remaining today on the free tier; null = unlimited (premium / unknown). */
  leftToday: number | null;
  /** Re-fetch the wallet from the server (e.g. after a purchase elsewhere). */
  refresh: () => Promise<void>;
  /** Buy/consume a catalog item on the server. Throws ApiError 409 when balance is insufficient. */
  spend: (item: SpendItem, qty?: number) => Promise<void>;
  /** Patch the cached balance from a /check response (no extra round-trip). */
  applyCheckReward: (coins?: number | null, scope?: AccountScope) => void;
};

const EMPTY: Wallet = { coins: 0, freezes: 0, is_premium: false, left_today: null };
const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const scope = useSyncExternalStore(subscribeAccountScope, captureAccountScope, captureAccountScope);
  const [mirror, setMirror] = useState(() => ({ scope, ready: false, wallet: EMPTY }));
  // Scope publication happens synchronously in the API token setter. Hide the old account even
  // before React's token effect runs; a delayed refresh must never briefly expose A's balance to B.
  const ready = mirror.scope === scope && mirror.ready;
  const wallet = mirror.scope === scope ? mirror.wallet : EMPTY;

  // (Re)load on login; clear on logout.
  useEffect(() => {
    let cancelled = false;
    setMirror({ scope, ready: false, wallet: EMPTY });
    if (!token || !isCurrentAccountScope(scope)) return;
    (async () => {
      try {
        const w = await getWallet();
        if (!cancelled && isCurrentAccountScope(scope)) setMirror({ scope, ready: true, wallet: w });
      } catch {
        // offline / old backend — keep the cached zero state; /check patches will still land
        if (!cancelled && isCurrentAccountScope(scope)) {
          setMirror((current) => isCurrentAccountScope(scope)
            ? { scope, ready: true, wallet: current.scope === scope ? current.wallet : EMPTY } : current);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, scope]);

  const refresh = useCallback(async () => {
    const requestScope = scope;
    if (!isCurrentAccountScope(requestScope)) return;
    try {
      const w = await getWallet();
      setMirror((current) => isCurrentAccountScope(requestScope)
        ? { scope: requestScope, ready: true, wallet: w } : current);
    } catch {
      // ignore — next /check patch or refresh will catch up
    }
  }, [scope]);

  const spend = useCallback(async (item: SpendItem, qty = 1) => {
    const requestScope = scope;
    if (!isCurrentAccountScope(requestScope)) return;
    // Server is the source of truth; it returns the post-spend wallet (409 → throws, no change).
    const w = await spendItem(item, qty);
    setMirror((current) => isCurrentAccountScope(requestScope)
      ? { scope: requestScope, ready: true, wallet: w } : current);
  }, [scope]);

  const applyCheckReward = useCallback((coins?: number | null, requestScope = scope) => {
    if (typeof coins !== "number" || !isCurrentAccountScope(scope) || !isCurrentAccountScope(requestScope)) return;
    setMirror((current) => isCurrentAccountScope(requestScope)
      ? { scope: requestScope, ready: current.scope === requestScope && current.ready,
          wallet: { ...(current.scope === requestScope ? current.wallet : EMPTY), coins } } : current);
  }, [scope]);

  const value = useMemo<WalletContextValue>(
    () => ({
      ready,
      coins: wallet.coins,
      freezes: wallet.freezes,
      isPremium: wallet.is_premium,
      leftToday: wallet.left_today ?? null,
      refresh,
      spend,
      applyCheckReward,
    }),
    [ready, wallet, refresh, spend, applyCheckReward]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
