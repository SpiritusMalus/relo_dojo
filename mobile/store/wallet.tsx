// Koku wallet state (economy, branch 1). Server-authoritative: the balance lives in Postgres and
// only the backend can change it (earn via /check, spend via /wallet/spend). This store is a cached
// mirror — refreshed on login and patched from /check responses so the TopBar updates instantly.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { getWallet, spendItem, type SpendItem, type Wallet } from "../services/api";
import { useAuth } from "./auth";
import { captureAccountScope, isCurrentAccountScope, subscribeAccountScope, type AccountScope } from "./accountScope";

// Client-side mirror of backend config (core/config.py) for display; the server enforces the real
// values, so a drift here is cosmetic only.
export const PRICE_EXTRA_PACK = 50;
export const EXTRA_PACK_SIZE = 10;

type WalletContextValue = {
  ready: boolean; // true only after a full authoritative mirror is known for this account
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
  const { token, user } = useAuth();
  const scope = useSyncExternalStore(subscribeAccountScope, captureAccountScope, captureAccountScope);
  const [mirror, setMirror] = useState(() => ({ scope, ready: false, wallet: EMPTY }));
  const mounted = useRef(true);
  const inFlight = useRef<{ scope: AccountScope; promise: Promise<void> } | null>(null);
  const mutationVersion = useRef(0);
  // Scope publication happens synchronously in the API token setter. Hide the old account even
  // before React's token effect runs; a delayed refresh must never briefly expose A's balance to B.
  const ready = mirror.scope === scope && mirror.ready;
  const wallet = mirror.scope === scope ? mirror.wallet : EMPTY;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback((): Promise<void> => {
    const requestScope = scope;
    if (!mounted.current || !token || requestScope.owner === null || !isCurrentAccountScope(requestScope)) return Promise.resolve();
    if (inFlight.current?.scope === requestScope) return inFlight.current.promise;
    const version = mutationVersion.current;
    const pending = { scope: requestScope, promise: Promise.resolve() };
    inFlight.current = pending;
    pending.promise = (async () => {
      try {
        const w = await getWallet();
        if (!mounted.current || !isCurrentAccountScope(requestScope) || mutationVersion.current !== version) return;
        setMirror((current) => mounted.current && isCurrentAccountScope(requestScope) && mutationVersion.current === version
          ? { scope: requestScope, ready: true, wallet: w } : current);
      } catch {
        // Unknown stays unknown after an offline boot. Revalidation preserves a known mirror.
      } finally {
        if (inFlight.current === pending) inFlight.current = null;
      }
    })();
    return pending.promise;
  }, [scope, token]);

  // A new epoch hides the previous mirror immediately. Revalidation within this epoch never
  // resets a successful balance to zero, and all concurrent free GET triggers share one request.
  useEffect(() => {
    setMirror((current) => current.scope === scope ? current : { scope, ready: false, wallet: EMPTY });
    void refresh();
  }, [scope, refresh]);

  useEffect(() => {
    if (!token) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [token, refresh]);

  useEffect(() => {
    // /auth/me can recover in the foreground without changing a JWT's already known scope.
    // Retry only an unknown mirror on this identity edge; mirror changes do not create a poller.
    if (user?.id != null && (mirror.scope !== scope || !mirror.ready)) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, scope, refresh]);

  const spend = useCallback(async (item: SpendItem, qty = 1) => {
    const requestScope = scope;
    if (!mounted.current || !isCurrentAccountScope(requestScope)) return;
    // Server is the source of truth; it returns the post-spend wallet (409 → throws, no change).
    const w = await spendItem(item, qty);
    if (!mounted.current || !isCurrentAccountScope(requestScope)) return;
    mutationVersion.current++;
    setMirror((current) => mounted.current && isCurrentAccountScope(requestScope)
      ? { scope: requestScope, ready: true, wallet: w } : current);
  }, [scope]);

  const applyCheckReward = useCallback((coins?: number | null, requestScope = scope) => {
    if (typeof coins !== "number" || !mounted.current || !isCurrentAccountScope(scope) || !isCurrentAccountScope(requestScope)) return;
    mutationVersion.current++;
    setMirror((current) => mounted.current && isCurrentAccountScope(requestScope)
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
