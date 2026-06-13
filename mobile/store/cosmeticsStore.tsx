// Cosmetics state (engagement v2). Server-authoritative mirror — like the wallet, the truth lives
// in Postgres and only the backend grants/equips; this caches owned + equipped, refreshed on login
// and after each buy/equip. Pure catalog + selectors live in ./cosmetics; this is the React glue.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { buyCosmetic, equipCosmetic, getCosmetics } from "../services/api";
import { useAuth } from "./auth";
import { senseiVisual, starterFor, type SenseiVisual } from "./cosmetics";

type CosmeticsContextValue = {
  ready: boolean;
  owned: string[];
  equipped: Record<string, string>;
  refresh: () => Promise<void>;
  /** Buy a cosmetic with koku (server validates). Throws ApiError on 409/400. */
  buy: (id: string) => Promise<void>;
  /** Equip an owned cosmetic. Throws ApiError on 409/400. */
  equip: (id: string) => Promise<void>;
};

type CosmeticsState = { owned: string[]; equipped: Record<string, string> };
const EMPTY: CosmeticsState = {
  owned: [starterFor("sensei")],
  equipped: { sensei: starterFor("sensei") },
};
const CosmeticsContext = createContext<CosmeticsContextValue | null>(null);

export function CosmeticsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<CosmeticsState>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setState(EMPTY);
      setReady(false);
      return;
    }
    (async () => {
      try {
        const c = await getCosmetics();
        if (!cancelled) setState({ owned: c.owned, equipped: c.equipped });
      } catch {
        // offline / old backend — keep the starter default so Sensei still renders
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
      const c = await getCosmetics();
      setState({ owned: c.owned, equipped: c.equipped });
    } catch {
      // ignore — next action refreshes
    }
  }, []);

  const buy = useCallback(async (id: string) => {
    const c = await buyCosmetic(id); // throws on failure → caller surfaces it
    setState({ owned: c.owned, equipped: c.equipped });
  }, []);

  const equip = useCallback(async (id: string) => {
    const c = await equipCosmetic(id);
    setState({ owned: c.owned, equipped: c.equipped });
  }, []);

  const value = useMemo<CosmeticsContextValue>(
    () => ({ ready, owned: state.owned, equipped: state.equipped, refresh, buy, equip }),
    [ready, state, refresh, buy, equip]
  );

  return <CosmeticsContext.Provider value={value}>{children}</CosmeticsContext.Provider>;
}

export function useCosmetics(): CosmeticsContextValue {
  const ctx = useContext(CosmeticsContext);
  if (!ctx) throw new Error("useCosmetics must be used within a CosmeticsProvider");
  return ctx;
}

/** Safe optional read for low-level UI (Sensei): the equipped skin's visual, classic if no provider. */
export function useEquippedSenseiVisual(): SenseiVisual {
  const ctx = useContext(CosmeticsContext);
  return senseiVisual(ctx?.equipped);
}
