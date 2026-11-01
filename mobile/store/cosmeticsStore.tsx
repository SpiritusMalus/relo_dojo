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
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { buyCosmetic, equipCosmetic, getCosmetics } from "../services/api";
import { useAuth } from "./auth";
import { captureAccountScope, isCurrentAccountScope, subscribeAccountScope } from "./accountScope";
import { knotVisual, senseiVisual, starterFor, type KnotVisual, type SenseiVisual } from "./cosmetics";

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
  owned: [starterFor("sensei"), starterFor("knot")],
  equipped: { sensei: starterFor("sensei"), knot: starterFor("knot") },
};
const CosmeticsContext = createContext<CosmeticsContextValue | null>(null);

export function CosmeticsProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const scope = useSyncExternalStore(subscribeAccountScope, captureAccountScope, captureAccountScope);
  const [mirror, setMirror] = useState(() => ({ scope, ready: false, state: EMPTY }));
  const ready = mirror.scope === scope && mirror.ready;
  const state = mirror.scope === scope ? mirror.state : EMPTY;

  useEffect(() => {
    let cancelled = false;
    setMirror({ scope, ready: false, state: EMPTY });
    if (!token || !isCurrentAccountScope(scope)) return;
    (async () => {
      try {
        const c = await getCosmetics();
        if (!cancelled && isCurrentAccountScope(scope)) {
          setMirror({ scope, ready: true, state: { owned: c.owned, equipped: c.equipped } });
        }
      } catch {
        // offline / old backend — keep the starter default so Sensei still renders
        if (!cancelled && isCurrentAccountScope(scope)) {
          setMirror((current) => isCurrentAccountScope(scope)
            ? { scope, ready: true, state: current.scope === scope ? current.state : EMPTY } : current);
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
      const c = await getCosmetics();
      setMirror((current) => isCurrentAccountScope(requestScope)
        ? { scope: requestScope, ready: true, state: { owned: c.owned, equipped: c.equipped } } : current);
    } catch {
      // ignore — next action refreshes
    }
  }, [scope]);

  const buy = useCallback(async (id: string) => {
    const requestScope = scope;
    if (!isCurrentAccountScope(requestScope)) return;
    const c = await buyCosmetic(id); // throws on failure → caller surfaces it
    setMirror((current) => isCurrentAccountScope(requestScope)
      ? { scope: requestScope, ready: true, state: { owned: c.owned, equipped: c.equipped } } : current);
  }, [scope]);

  const equip = useCallback(async (id: string) => {
    const requestScope = scope;
    if (!isCurrentAccountScope(requestScope)) return;
    const c = await equipCosmetic(id);
    setMirror((current) => isCurrentAccountScope(requestScope)
      ? { scope: requestScope, ready: true, state: { owned: c.owned, equipped: c.equipped } } : current);
  }, [scope]);

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

/** Safe optional read for low-level UI (BeltKnot): the equipped knot's visual, classic if none. */
export function useEquippedKnotVisual(): KnotVisual {
  const ctx = useContext(CosmeticsContext);
  return knotVisual(ctx?.equipped);
}
