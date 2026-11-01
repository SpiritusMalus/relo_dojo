import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { ApiError } from "../services/api";
import { acknowledgeDojoReceipt, getDojo, isDojoSnapshot, setDojoTarget, type DojoSnapshot } from "../services/dojo";
import { captureAccountScope, isCurrentAccountScope, subscribeAccountScope, type AccountScope } from "./accountScope";
import { useAuth } from "./auth";
import { useCosmetics } from "./cosmeticsStore";
import { useWallet } from "./wallet";

export const DOJO_STARTERS: Record<string, string> = {
  dojo_light: "dojo_light_paper", dojo_display: "dojo_display_blank", dojo_plant: "dojo_plant_seedling",
};
const CACHE_PREFIX = "relo_dojo/dojo-room/v1/owner/";
const storageQueues = new Map<string, Promise<unknown>>();
export function dojoRoomCacheKey(owner: string): string { return CACHE_PREFIX + encodeURIComponent(owner); }
function storageTask<T>(key: string, run: () => Promise<T>): Promise<T> {
  const task = (storageQueues.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
  storageQueues.set(key, task);
  void task.finally(() => { if (storageQueues.get(key) === task) storageQueues.delete(key); }).catch(() => {});
  return task;
}
export async function readDojoRoomCache(scope: AccountScope): Promise<DojoSnapshot | null> {
  if (!scope.owner || scope.owner === "guest" || !isCurrentAccountScope(scope)) return null;
  const key = dojoRoomCacheKey(scope.owner);
  return storageTask(key, async () => {
    if (!isCurrentAccountScope(scope)) return null;
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw || !isCurrentAccountScope(scope)) return null;
      const envelope = JSON.parse(raw);
      return envelope.version === 1 && envelope.owner === scope.owner && isDojoSnapshot(envelope.snapshot) ? envelope.snapshot : null;
    } catch { return null; }
  });
}
export async function writeDojoRoomCache(scope: AccountScope, snapshot: DojoSnapshot): Promise<void> {
  if (!scope.owner || scope.owner === "guest" || !isCurrentAccountScope(scope)) return;
  const key = dojoRoomCacheKey(scope.owner);
  await storageTask(key, async () => {
    if (!isCurrentAccountScope(scope)) return;
    // A native write already dispatched for A finishes only in A's immutable key. A later A read queues behind it.
    await AsyncStorage.setItem(key, JSON.stringify({ version: 1, owner: scope.owner, snapshot })).catch(() => {});
  });
}

type RoomMirror = { scope: AccountScope; snapshot: DojoSnapshot | null; source: "preview" | "cache" | "server"; online: boolean; available: boolean; error: "load" | "save" | null };
type NextMilestone = { itemId: string; days: number; progress: number };
type DojoRoomValue = {
  ready: boolean; source: RoomMirror["source"]; available: boolean; loading: boolean; busy: string | null;
  snapshot: DojoSnapshot | null; owned: string[]; equipped: Record<string, string>; practiceDays: number | null;
  nextMilestone: NextMilestone | null; catalog: DojoSnapshot["catalog"]; error: RoomMirror["error"];
  refresh: () => Promise<void>;
  acceptSnapshot: (snapshot: DojoSnapshot, scope: AccountScope) => void;
  buy: (id: string) => Promise<void>; equip: (id: string) => Promise<void>;
  selectTarget: (id: string | null) => Promise<void>; acknowledge: (id: string) => Promise<void>;
};
const Context = createContext<DojoRoomValue | null>(null);
const empty = (scope: AccountScope): RoomMirror => ({ scope, snapshot: null, source: "preview", online: false, available: true, error: null });

export function DojoRoomProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const cosmetics = useCosmetics();
  const wallet = useWallet();
  const scope = useSyncExternalStore(subscribeAccountScope, captureAccountScope, captureAccountScope);
  const [mirror, setMirror] = useState<RoomMirror>(() => empty(scope));
  const current = useRef(mirror);
  const [activity, setActivity] = useState<{ scope: AccountScope; busy: string | null; loading: boolean }>({ scope, busy: null, loading: false });
  const mounted = useRef(true);
  const inFlight = useRef<{ scope: AccountScope; promise: Promise<void> } | null>(null);
  const mutation = useRef<{ scope: AccountScope; id: string } | null>(null);
  const revision = useRef(0);
  const previousUser = useRef(user?.id);
  const dependencies = useRef({ cosmetics, wallet });
  dependencies.current = { cosmetics, wallet };
  const publish = useCallback((next: RoomMirror) => {
    if (!mounted.current || !isCurrentAccountScope(next.scope)) return;
    current.current = next;
    setMirror(next);
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const adopt = useCallback((snapshot: DojoSnapshot, requestScope: AccountScope, cosmeticVersion?: number) => {
    if (!mounted.current || requestScope !== scope || !isCurrentAccountScope(requestScope) || !isDojoSnapshot(snapshot)) return;
    revision.current++;
    // A session/target response can predate a wardrobe change. Only a GET with a captured
    // inventory version may replace equipped items; all other receipts trigger a canonical read.
    const acceptedInventory = cosmeticVersion !== undefined
      && dependencies.current.cosmetics.acceptSnapshot(snapshot, requestScope, true, cosmeticVersion);
    publish({ scope: requestScope, snapshot, source: "server", online: true, available: true, error: null });
    if (acceptedInventory) void writeDojoRoomCache(requestScope, snapshot);
  }, [scope, publish]);

  const refresh = useCallback((): Promise<void> => {
    const requestScope = scope;
    if (!mounted.current || !token || !requestScope.owner || requestScope.owner === "guest" || !isCurrentAccountScope(requestScope)) return Promise.resolve();
    if (inFlight.current?.scope === requestScope) return inFlight.current.promise;
    const version = revision.current;
    const cosmeticVersion = dependencies.current.cosmetics.snapshotVersion();
    const pending = { scope: requestScope, promise: Promise.resolve() };
    inFlight.current = pending;
    setActivity((old) => ({ scope: requestScope, busy: old.scope === requestScope ? old.busy : null, loading: true }));
    pending.promise = (async () => {
      try {
        const next = await getDojo();
        if (version === revision.current) adopt(next, requestScope, cosmeticVersion);
      } catch (error) {
        if (!mounted.current || !isCurrentAccountScope(requestScope) || version !== revision.current) return;
        const retained = current.current.scope === requestScope ? current.current : empty(requestScope);
        const disabled = error instanceof ApiError && error.status === 404;
        publish({ ...retained, source: retained.snapshot ? "cache" : "preview", online: false, available: !disabled, error: "load" });
      } finally {
        if (inFlight.current === pending) inFlight.current = null;
        if (mounted.current && isCurrentAccountScope(requestScope)) setActivity((old) => old.scope === requestScope ? { ...old, loading: false } : old);
      }
    })();
    return pending.promise;
  }, [scope, token, adopt, publish]);
  const acceptSnapshot = useCallback((snapshot: DojoSnapshot, requestScope: AccountScope) => {
    if (!mounted.current || requestScope !== scope || !isCurrentAccountScope(requestScope)) return;
    adopt(snapshot, requestScope);
    inFlight.current = null;
    void refresh();
  }, [scope, adopt, refresh]);

  useEffect(() => {
    publish(empty(scope));
    const version = revision.current;
    void (async () => {
      const cached = await readDojoRoomCache(scope);
      if (!mounted.current || !isCurrentAccountScope(scope)) return;
      if (cached && version === revision.current && current.current.source !== "server") {
        dependencies.current.cosmetics.acceptSnapshot(cached, scope, false);
        publish({ scope, snapshot: cached, source: "cache", online: false, available: true, error: null });
      }
      await refresh();
    })();
  }, [scope, refresh, publish]);
  useEffect(() => {
    if (!token) return;
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void refresh(); });
    return () => subscription.remove();
  }, [token, refresh]);
  useEffect(() => {
    const changed = previousUser.current !== user?.id;
    previousUser.current = user?.id;
    if (changed && user?.id != null && (current.current.scope !== scope || !current.current.online)) void refresh();
  }, [user?.id, scope, refresh]);

  const runMutation = useCallback(async (id: string, action: () => Promise<DojoSnapshot | void>, recovered: (snapshot: DojoSnapshot) => boolean) => {
    const requestScope = scope;
    if (!mounted.current || !isCurrentAccountScope(requestScope) || !token || requestScope.owner === "guest"
      || !current.current.online || current.current.scope !== requestScope || mutation.current?.scope === requestScope) return;
    const pending = { scope: requestScope, id };
    mutation.current = pending;
    revision.current++; // Any earlier GET must not undo a committed purchase/equip/target.
    inFlight.current = null;
    setActivity({ scope: requestScope, busy: id, loading: false });
    try {
      const next = await action();
      if (!mounted.current || !isCurrentAccountScope(requestScope)) return;
      if (next) adopt(next, requestScope);
      else revision.current++;
      inFlight.current = null;
      // Reconcile the existing inventory and wallet; never invent an optimistic debit or retry a POST.
      await refresh();
      if (isCurrentAccountScope(requestScope)) await dependencies.current.wallet.refresh();
    } catch (error) {
      if (!mounted.current || !isCurrentAccountScope(requestScope)) return;
      // A lost response may have committed. One canonical read determines the visible state.
      revision.current++;
      inFlight.current = null;
      await refresh();
      if (!isCurrentAccountScope(requestScope)) return;
      await dependencies.current.wallet.refresh();
      const retained = current.current;
      if (retained.online && retained.snapshot && recovered(retained.snapshot)) return;
      publish({ ...retained, error: "save" });
      throw error;
    } finally {
      if (mutation.current === pending) mutation.current = null;
      if (mounted.current && isCurrentAccountScope(requestScope)) setActivity((old) => old.scope === requestScope ? { ...old, busy: null } : old);
    }
  }, [scope, token, adopt, refresh, publish]);
  const buy = useCallback((id: string) => runMutation(id, () => dependencies.current.cosmetics.buy(id), (s) => s.owned.includes(id)), [runMutation]);
  const equip = useCallback((id: string) => runMutation(id, () => dependencies.current.cosmetics.equip(id), (s) => Object.values(s.equipped).includes(id)), [runMutation]);
  const selectTarget = useCallback((id: string | null) => runMutation(id ?? "target", () => setDojoTarget(id), (s) => s.selected_target === id), [runMutation]);
  const acknowledge = useCallback((id: string) => runMutation(id, () => acknowledgeDojoReceipt(id), (s) => !s.receipts.some((r) => r.id === id)), [runMutation]);

  const visible = mirror.scope === scope ? mirror : empty(scope);
  const snapshot = visible.snapshot;
  const next = snapshot?.catalog.find((item) => item.practice_days === snapshot.next_milestone);
  // All rendering uses the existing inventory mirror. The room snapshot only adds catalog/evidence.
  const equipped = { ...DOJO_STARTERS, ...cosmetics.equipped };
  const value = useMemo<DojoRoomValue>(() => ({
    ready: visible.source === "server" && visible.online, source: visible.source, available: visible.available,
    loading: activity.scope === scope && activity.loading, busy: activity.scope === scope ? activity.busy : null,
    snapshot, owned: cosmetics.owned, equipped, practiceDays: snapshot?.practice_days ?? null,
    nextMilestone: next && next.practice_days ? { itemId: next.id, days: next.practice_days, progress: Math.min(snapshot!.practice_days, next.practice_days) } : null,
    catalog: snapshot?.catalog ?? [], error: visible.error, refresh, acceptSnapshot, buy, equip, selectTarget, acknowledge,
  }), [visible, activity, scope, snapshot, cosmetics.owned, cosmetics.equipped, next, refresh, acceptSnapshot, buy, equip, selectTarget, acknowledge]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useDojoRoom(): DojoRoomValue {
  const value = useContext(Context);
  if (!value) throw new Error("useDojoRoom must be used within DojoRoomProvider");
  return value;
}
