import AsyncStorage from "@react-native-async-storage/async-storage";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { AppState } from "react-native";
import { DojoRoomProvider, dojoRoomCacheKey, readDojoRoomCache, useDojoRoom, writeDojoRoomCache, DOJO_STARTERS } from "../dojoRoom";
import { CosmeticsProvider, useCosmetics } from "../cosmeticsStore";
import { WalletProvider } from "../wallet";
import { captureAccountScope } from "../accountScope";
import { ApiError, buyCosmetic, equipCosmetic, getCosmetics, getWallet, setAuthToken } from "../../services/api";
import { getDojo, setDojoTarget, acknowledgeDojoReceipt, isDojoSnapshot, type DojoSnapshot } from "../../services/dojo";

let mockToken: string | null = null;
jest.mock("../auth", () => ({ useAuth: () => ({ token: mockToken, user: null }) }));
jest.mock("../../services/api", () => ({
  ...jest.requireActual("../../services/api"), getCosmetics: jest.fn(), getWallet: jest.fn(), buyCosmetic: jest.fn(), equipCosmetic: jest.fn(),
}));
jest.mock("../../services/dojo", () => ({
  ...jest.requireActual("../../services/dojo"), getDojo: jest.fn(), setDojoTarget: jest.fn(), acknowledgeDojoReceipt: jest.fn(),
}));
const token = (sub: string, nonce = "one") => `header.${Buffer.from(JSON.stringify({ sub, nonce })).toString("base64url")}.signature`;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const BASE: DojoSnapshot = {
  version: 1, catalog_version: 1, slots: ["dojo_light", "dojo_display", "dojo_plant"],
  catalog: [
    { id: "dojo_light_paper", slot: "dojo_light", gate: "starter", price: 0, practice_days: null },
    { id: "dojo_display_blank", slot: "dojo_display", gate: "starter", price: 0, practice_days: null },
    { id: "dojo_plant_seedling", slot: "dojo_plant", gate: "starter", price: 0, practice_days: null },
    { id: "dojo_display_first_scroll", slot: "dojo_display", gate: "achievement", price: 0, practice_days: 1 },
    { id: "dojo_plant_bamboo", slot: "dojo_plant", gate: "achievement", price: 0, practice_days: 3 },
    { id: "dojo_light_lantern", slot: "dojo_light", gate: "achievement", price: 0, practice_days: 7 },
    { id: "dojo_light_sunset", slot: "dojo_light", gate: "buy", price: 120, practice_days: null },
    { id: "dojo_display_wave", slot: "dojo_display", gate: "buy", price: 180, practice_days: null },
  ],
  owned: ["sensei_classic", "knot_classic", ...Object.values(DOJO_STARTERS)],
  equipped: { sensei: "sensei_classic", knot: "knot_classic", ...DOJO_STARTERS },
  selected_target: null, practice_days: 0, next_milestone: 1, receipts: [],
};
const EARNED: DojoSnapshot = {
  ...BASE, practice_days: 3, next_milestone: 7,
  owned: [...BASE.owned, "dojo_display_first_scroll", "dojo_plant_bamboo"],
  equipped: { ...BASE.equipped, dojo_display: "dojo_display_first_scroll", dojo_plant: "dojo_plant_bamboo" },
};
let room!: ReturnType<typeof useDojoRoom>;
let inventory!: ReturnType<typeof useCosmetics>;
let renderer: ReactTestRenderer | undefined;
function Harness() { room = useDojoRoom(); inventory = useCosmetics(); return null; }
async function mount() {
  await act(async () => { renderer = TestRenderer.create(<WalletProvider><CosmeticsProvider><DojoRoomProvider><Harness /></DojoRoomProvider></CosmeticsProvider></WalletProvider>); });
}
async function switchAccount(sub: string, snapshot = BASE, nonce = "one") {
  jest.mocked(getDojo).mockResolvedValue(snapshot);
  jest.mocked(getCosmetics).mockResolvedValue(snapshot);
  await act(async () => { mockToken = token(sub, nonce); setAuthToken(mockToken); });
}
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: jest.fn() }));
  mockToken = token("a"); setAuthToken(mockToken);
  jest.mocked(getDojo).mockResolvedValue(BASE);
  jest.mocked(getCosmetics).mockResolvedValue(BASE);
  jest.mocked(getWallet).mockResolvedValue({ coins: 200, freezes: 0, is_premium: false });
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined; setAuthToken(null); jest.restoreAllMocks();
});

it("adopts the canonical room into the existing inventory and caches its owner", async () => {
  jest.mocked(getDojo).mockResolvedValue(EARNED);
  await mount();
  expect(room.ready).toBe(true);
  expect(room.practiceDays).toBe(3);
  expect(room.nextMilestone).toEqual({ itemId: "dojo_light_lantern", days: 7, progress: 3 });
  expect(room.equipped.dojo_plant).toBe("dojo_plant_bamboo");
  expect(inventory.equipped.dojo_plant).toBe("dojo_plant_bamboo");
  const cached = JSON.parse((await AsyncStorage.getItem(dojoRoomCacheKey("user:a")))!);
  expect(cached.owner).toBe("user:a"); expect(cached.snapshot.practice_days).toBe(3);
});

it("restores only this owner's cached room offline and disables changes", async () => {
  await writeDojoRoomCache(captureAccountScope(), EARNED);
  jest.mocked(getDojo).mockRejectedValue(new Error("offline"));
  jest.mocked(getCosmetics).mockRejectedValue(new Error("offline"));
  await mount();
  expect(room.source).toBe("cache"); expect(room.ready).toBe(false);
  expect(room.equipped.dojo_plant).toBe("dojo_plant_bamboo");
  await act(async () => { await room.buy("dojo_light_sunset"); await room.equip("dojo_plant_bamboo"); await room.selectTarget("dojo_light_lantern"); });
  expect(buyCosmetic).not.toHaveBeenCalled(); expect(equipCosmetic).not.toHaveBeenCalled(); expect(setDojoTarget).not.toHaveBeenCalled();
});

it("does not restore another owner's envelope or obsolete schema", async () => {
  await AsyncStorage.setItem(dojoRoomCacheKey("user:a"), JSON.stringify({ version: 1, owner: "user:b", snapshot: EARNED }));
  expect(await readDojoRoomCache(captureAccountScope())).toBeNull();
  expect(isDojoSnapshot({ ...BASE, version: 0 })).toBe(false);
  expect(isDojoSnapshot({ ...BASE, practice_days: -1 })).toBe(false);
});

it("uses guest starters without claiming days or fetching an account", async () => {
  mockToken = null; setAuthToken(null);
  await mount();
  expect(room.source).toBe("preview"); expect(room.practiceDays).toBeNull(); expect(room.ready).toBe(false);
  expect(room.equipped.dojo_display).toBe("dojo_display_blank"); expect(room.nextMilestone).toBeNull();
  expect(getDojo).not.toHaveBeenCalled();
});

it("treats a disabled feature as unavailable, never a confirmed starter inventory", async () => {
  jest.mocked(getDojo).mockRejectedValue(new ApiError("not found", 404));
  await mount();
  expect(room.available).toBe(false); expect(room.ready).toBe(false); expect(room.source).toBe("preview");
});

it("fences a late A room load after B has loaded", async () => {
  const old = deferred<DojoSnapshot>();
  jest.mocked(getDojo).mockReturnValueOnce(old.promise);
  await mount();
  await switchAccount("b");
  await act(async () => { old.resolve(EARNED); });
  expect(room.practiceDays).toBe(0); expect(room.equipped.dojo_plant).toBe("dojo_plant_seedling");
  expect(await AsyncStorage.getItem(dojoRoomCacheKey("user:a"))).toBeNull();
});

it("old A callbacks cannot borrow B's bearer or adopt A progress", async () => {
  await mount();
  const old = room; const scope = captureAccountScope();
  await switchAccount("b");
  const reads = jest.mocked(getDojo).mock.calls.length;
  await act(async () => {
    await old.refresh(); await old.buy("dojo_light_sunset"); await old.equip("dojo_display_first_scroll");
    await old.selectTarget("dojo_light_lantern"); old.acceptSnapshot(EARNED, scope);
  });
  expect(getDojo).toHaveBeenCalledTimes(reads); expect(buyCosmetic).not.toHaveBeenCalled(); expect(equipCosmetic).not.toHaveBeenCalled();
  expect(room.practiceDays).toBe(0);
});

it("fences old A work across A → B → A", async () => {
  await mount();
  const oldScope = captureAccountScope(); const old = room;
  await switchAccount("b"); await switchAccount("a", BASE, "again");
  act(() => old.acceptSnapshot(EARNED, oldScope));
  expect(room.practiceDays).toBe(0);
});

it("a lost purchase response reconciles ownership with one GET and never retries payment", async () => {
  await mount();
  const purchased = { ...BASE, owned: [...BASE.owned, "dojo_light_sunset"] };
  jest.mocked(buyCosmetic).mockRejectedValueOnce(new Error("lost response"));
  jest.mocked(getDojo).mockResolvedValue(purchased);
  await act(async () => { await room.buy("dojo_light_sunset"); });
  expect(buyCosmetic).toHaveBeenCalledTimes(1); expect(room.owned).toContain("dojo_light_sunset"); expect(room.error).toBeNull();
});

it("an older GET cannot roll back an equip and completion snapshots share inventory", async () => {
  await mount();
  const old = deferred<DojoSnapshot>(); jest.mocked(getDojo).mockReturnValueOnce(old.promise);
  let pending!: Promise<void>;
  act(() => { pending = room.refresh(); });
  jest.mocked(equipCosmetic).mockResolvedValue(EARNED);
  jest.mocked(getDojo).mockResolvedValue(EARNED);
  await act(async () => { await room.equip("dojo_plant_bamboo"); });
  await act(async () => { old.resolve(BASE); await pending; });
  expect(room.practiceDays).toBe(3); expect(room.equipped.dojo_plant).toBe("dojo_plant_bamboo");
  expect(inventory.equipped.dojo_plant).toBe("dojo_plant_bamboo");
});

it("a delayed completion receipt cannot undo a newer outfit", async () => {
  await mount();
  const latest = { ...EARNED, owned: [...EARNED.owned, "dojo_light_sunset"], equipped: { ...EARNED.equipped, dojo_light: "dojo_light_sunset" } };
  jest.mocked(equipCosmetic).mockResolvedValue(latest); jest.mocked(getDojo).mockResolvedValue(latest);
  await act(async () => { await room.equip("dojo_light_sunset"); });
  const canonical = deferred<DojoSnapshot>(); jest.mocked(getDojo).mockReturnValueOnce(canonical.promise);
  act(() => room.acceptSnapshot(EARNED, captureAccountScope()));
  expect(room.equipped.dojo_light).toBe("dojo_light_sunset");
  await act(async () => { canonical.resolve(latest); });
  expect(room.equipped.dojo_light).toBe("dojo_light_sunset");
});

it("serializes an already-dispatched native A write before a later A read", async () => {
  const nativeWrite = deferred<void>();
  const originalSet = AsyncStorage.setItem;
  jest.spyOn(AsyncStorage, "setItem").mockImplementationOnce(async (key, value) => {
    await nativeWrite.promise; return originalSet(key, value);
  });
  const writing = writeDojoRoomCache(captureAccountScope(), EARNED);
  await Promise.resolve(); await Promise.resolve();
  setAuthToken(token("b")); setAuthToken(token("a", "back"));
  let finished = false;
  const reading = readDojoRoomCache(captureAccountScope()).then((value) => { finished = true; return value; });
  await Promise.resolve(); expect(finished).toBe(false);
  nativeWrite.resolve(); await writing;
  expect((await reading)?.practice_days).toBe(3);
  expect(await AsyncStorage.getItem(dojoRoomCacheKey("user:b"))).toBeNull();
});
