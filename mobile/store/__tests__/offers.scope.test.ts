import AsyncStorage from "@react-native-async-storage/async-storage";
import { captureAccountScope, setAccountToken } from "../accountScope";
import { loadOffers, markOffer } from "../offers";

const token = (sub: string) => `header.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.signature`;
const key = "relo_dojo/offers/v1";
const live = { starter24: { expiresAt: "2026-12-01T12:00:00Z" } };
beforeEach(async () => {
  jest.clearAllMocks();
  setAccountToken(token("a"));
  await AsyncStorage.clear();
  await AsyncStorage.setItem(key, JSON.stringify(live));
});
afterEach(() => { setAccountToken(null); jest.restoreAllMocks(); });

it("a current owner may mark the existing device offer without changing its original window", async () => {
  await markOffer("starter24", { redeemed: true });
  expect(await loadOffers()).toEqual({ starter24: { ...live.starter24, redeemed: true } });
});

it("does not write an old A patch when B replaces it during the native offer read", async () => {
  let resolveA!: (raw: string | null) => void;
  jest.spyOn(AsyncStorage, "getItem").mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
  const pendingA = markOffer("starter24", { redeemed: true }, captureAccountScope());
  setAccountToken(token("b"));
  resolveA(JSON.stringify(live));
  expect(await pendingA).toEqual({});
  expect(await loadOffers()).toEqual(live);
});

it("rejects an old A callback before any native read or write begins", async () => {
  const a = captureAccountScope();
  setAccountToken(token("b"));
  jest.mocked(AsyncStorage.getItem).mockClear();
  jest.mocked(AsyncStorage.setItem).mockClear();
  expect(await markOffer("starter24", { dismissed: true }, a)).toEqual({});
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
