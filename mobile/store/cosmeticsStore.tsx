// Cosmetics state (engagement v2). Server-authoritative mirror — like the wallet, the truth lives
// in Postgres and only the backend grants/equips; this caches owned + equipped, refreshed on login
// and after each buy/equip. Pure catalog + selectors live in ./cosmetics; this is the React glue.
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
import { buyCosmetic, equipCosmetic, getCosmetics } from "../services/api";
import { useAuth } from "./auth";
import { captureAccountScope, isCurrentAccountScope, subscribeAccountScope, type AccountScope } from "./accountScope";
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
  const { token, user } = useAuth();
  const scope = useSyncExternalStore(subscribeAccountScope, captureAccountScope, captureAccountScope);
  const [mirror, setMirror] = useState(() => ({ scope, ready: false, state: EMPTY }));
  const mounted = useRef(true);
  const inFlight = useRef<{ scope: AccountScope; promise: Promise<void> } | null>(null);
  const mutationVersion = useRef(0);
  const ready = mirror.scope === scope && mirror.ready;
  const state = mirror.scope === scope ? mirror.state : EMPTY;

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
        const c = await getCosmetics();
        if (!mounted.current || !isCurrentAccountScope(requestScope) || mutationVersion.current !== version) return;
        setMirror((current) => mounted.current && isCurrentAccountScope(requestScope) && mutationVersion.current === version
          ? { scope: requestScope, ready: true, state: { owned: c.owned, equipped: c.equipped } } : current);
      } catch {
        // The starter visual is a rendering fallback, not proof of server ownership.
      } finally {
        if (inFlight.current === pending) inFlight.current = null;
      }
    })();
    return pending.promise;
  }, [scope, token]);

  useEffect(() => {
    setMirror((current) => current.scope === scope ? current : { scope, ready: false, state: EMPTY });
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
    if (user?.id != null && (mirror.scope !== scope || !mirror.ready)) void refresh();
    // Identity recovery is an edge trigger, not an automatic loop after a failed GET.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, scope, refresh]);

  const buy = useCallback(async (id: string) => {
    const requestScope = scope;
    if (!mounted.current || !isCurrentAccountScope(requestScope)) return;
    const c = await buyCosmetic(id); // throws on failure → caller surfaces it
    if (!mounted.current || !isCurrentAccountScope(requestScope)) return;
    mutationVersion.current++;
    setMirror((current) => mounted.current && isCurrentAccountScope(requestScope)
      ? { scope: requestScope, ready: true, state: { owned: c.owned, equipped: c.equipped } } : current);
  }, [scope]);

  const equip = useCallback(async (id: string) => {
    const requestScope = scope;
    if (!mounted.current || !isCurrentAccountScope(requestScope)) return;
    const c = await equipCosmetic(id);
    if (!mounted.current || !isCurrentAccountScope(requestScope)) return;
    mutationVersion.current++;
    setMirror((current) => mounted.current && isCurrentAccountScope(requestScope)
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
