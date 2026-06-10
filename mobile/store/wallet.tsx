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
  type ReactNode,
} from "react";
import { getWallet, spendItem, type SpendItem, type Wallet } from "../services/api";
import { useAuth } from "./auth";

type WalletContextValue = {
  ready: boolean; // false until the first fetch after login resolves (or fails)
  coins: number;
  freezes: number;
  isPremium: boolean;
  /** Re-fetch the wallet from the server (e.g. after a purchase elsewhere). */
  refresh: () => Promise<void>;
  /** Buy/consume a catalog item on the server. Throws ApiError 409 when balance is insufficient. */
  spend: (item: SpendItem, qty?: number) => Promise<void>;
  /** Patch the cached balance from a /check response (no extra round-trip). */
  applyCheckReward: (coins?: number | null) => void;
};

const EMPTY: Wallet = { coins: 0, freezes: 0, is_premium: false };
const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [ready, setReady] = useState(false);
  const [wallet, setWallet] = useState<Wallet>(EMPTY);

  // (Re)load on login; clear on logout.
  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setWallet(EMPTY);
      setReady(false);
      return;
    }
    (async () => {
      try {
        const w = await getWallet();
        if (!cancelled) setWallet(w);
      } catch {
        // offline / old backend — keep the cached zero state; /check patches will still land
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const refresh = useCallback(async () => {
    try {
      setWallet(await getWallet());
    } catch {
      // ignore — next /check patch or refresh will catch up
    }
  }, []);

  const spend = useCallback(async (item: SpendItem, qty = 1) => {
    // Server is the source of truth; it returns the post-spend wallet (409 → throws, no change).
    setWallet(await spendItem(item, qty));
  }, []);

  const applyCheckReward = useCallback((coins?: number | null) => {
    if (typeof coins === "number") setWallet((w) => ({ ...w, coins }));
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      ready,
      coins: wallet.coins,
      freezes: wallet.freezes,
      isPremium: wallet.is_premium,
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
