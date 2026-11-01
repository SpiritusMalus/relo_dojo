import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { WalletProvider, useWallet } from "../wallet";
import { CosmeticsProvider, useCosmetics } from "../cosmeticsStore";
import { captureAccountScope } from "../accountScope";
import {
  buyCosmetic, equipCosmetic, getCosmetics, getWallet, setAuthToken, spendItem,
  type Cosmetics, type Wallet,
} from "../../services/api";

let mockToken: string | null = null;
jest.mock("../auth", () => ({ useAuth: () => ({ token: mockToken }) }));
jest.mock("../../services/api", () => ({
  ...jest.requireActual("../../services/api"), getWallet: jest.fn(), spendItem: jest.fn(),
  getCosmetics: jest.fn(), buyCosmetic: jest.fn(), equipCosmetic: jest.fn(),
}));

const token = (sub: string, nonce = "one") => `header.${Buffer.from(JSON.stringify({ sub, nonce })).toString("base64url")}.signature`;
const A: Wallet = { coins: 900, freezes: 7, is_premium: true, left_today: null };
const B: Wallet = { coins: 12, freezes: 1, is_premium: false, left_today: 3 };
const CA: Cosmetics = { owned: ["sensei_sage"], equipped: { sensei: "sensei_sage" } };
const CB: Cosmetics = { owned: ["sensei_ronin"], equipped: { sensei: "sensei_ronin" } };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
let wallet!: ReturnType<typeof useWallet>;
let cosmetics!: ReturnType<typeof useCosmetics>;
let renderer: ReactTestRenderer | undefined;
function Harness() { wallet = useWallet(); cosmetics = useCosmetics(); return null; }
async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(<WalletProvider><CosmeticsProvider><Harness /></CosmeticsProvider></WalletProvider>);
  });
}
async function switchToB() {
  jest.mocked(getWallet).mockResolvedValueOnce(B);
  jest.mocked(getCosmetics).mockResolvedValueOnce(CB);
  await act(async () => { mockToken = token("b"); setAuthToken(mockToken); });
  expect(wallet.coins).toBe(B.coins);
  expect(cosmetics.equipped).toEqual(CB.equipped);
}
beforeEach(() => {
  jest.clearAllMocks();
  mockToken = token("a");
  setAuthToken(mockToken);
  jest.mocked(getWallet).mockResolvedValue(A);
  jest.mocked(getCosmetics).mockResolvedValue(CA);
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  setAuthToken(null);
});

it("hides A's mirrors at scope publication before B fetches resolve", async () => {
  await mount();
  expect(wallet.coins).toBe(A.coins);
  const w = deferred<Wallet>();
  const c = deferred<Cosmetics>();
  jest.mocked(getWallet).mockReturnValueOnce(w.promise);
  jest.mocked(getCosmetics).mockReturnValueOnce(c.promise);
  // Deliberately leave React's auth token at A: the API scope changes before its token effect.
  act(() => { setAuthToken(token("b")); });
  expect(wallet.coins).toBe(0);
  expect(wallet.freezes).toBe(0);
  expect(wallet.isPremium).toBe(false);
  expect(wallet.ready).toBe(false);
  expect(cosmetics.equipped.sensei).toBe("sensei_classic");
  expect(cosmetics.owned).not.toContain("sensei_sage");
  expect(cosmetics.ready).toBe(false);
  await act(async () => { w.resolve(B); c.resolve(CB); });
  expect(wallet.coins).toBe(B.coins);
  expect(cosmetics.equipped).toEqual(CB.equipped);
});

it("discards delayed initial A loads after B has loaded", async () => {
  const w = deferred<Wallet>();
  const c = deferred<Cosmetics>();
  jest.mocked(getWallet).mockReturnValueOnce(w.promise);
  jest.mocked(getCosmetics).mockReturnValueOnce(c.promise);
  await mount();
  await switchToB();
  await act(async () => { w.resolve(A); c.resolve(CA); });
  expect(wallet.coins).toBe(B.coins);
  expect(cosmetics.equipped).toEqual(CB.equipped);
});

it.each(["refresh", "spend"] as const)("ignores a late A wallet %s response", async (action) => {
  await mount();
  const old = deferred<Wallet>();
  if (action === "refresh") jest.mocked(getWallet).mockReturnValueOnce(old.promise);
  else jest.mocked(spendItem).mockReturnValueOnce(old.promise);
  let request!: Promise<void>;
  act(() => { request = action === "refresh" ? wallet.refresh() : wallet.spend("extra_pack"); });
  await switchToB();
  await act(async () => { old.resolve(A); await request; });
  expect(wallet.coins).toBe(B.coins);
  expect(wallet.freezes).toBe(B.freezes);
});

it.each(["refresh", "buy", "equip"] as const)("ignores a late A cosmetics %s response", async (action) => {
  await mount();
  const old = deferred<Cosmetics>();
  if (action === "refresh") jest.mocked(getCosmetics).mockReturnValueOnce(old.promise);
  else if (action === "buy") jest.mocked(buyCosmetic).mockReturnValueOnce(old.promise);
  else jest.mocked(equipCosmetic).mockReturnValueOnce(old.promise);
  let request!: Promise<void>;
  act(() => { request = action === "refresh" ? cosmetics.refresh() : cosmetics[action]("sensei_sage"); });
  await switchToB();
  await act(async () => { old.resolve(CA); await request; });
  expect(cosmetics.owned).toEqual(CB.owned);
  expect(cosmetics.equipped).toEqual(CB.equipped);
});

it("rejects A reward patches but accepts an explicitly captured current B reward", async () => {
  await mount();
  const aScope = captureAccountScope();
  await switchToB();
  act(() => wallet.applyCheckReward(9999, aScope));
  expect(wallet.coins).toBe(B.coins);
  act(() => wallet.applyCheckReward(13, captureAccountScope()));
  expect(wallet.coins).toBe(13);
});

it("invalidates work even when a new token belongs to the same account", async () => {
  await mount();
  const scope = captureAccountScope();
  const next = deferred<Wallet>();
  jest.mocked(getWallet).mockReturnValueOnce(next.promise);
  act(() => setAuthToken(token("a", "refreshed")));
  expect(wallet.coins).toBe(0);
  act(() => wallet.applyCheckReward(9999, scope));
  expect(wallet.coins).toBe(0);
  await act(async () => { next.resolve(B); });
  expect(wallet.coins).toBe(B.coins);
});

it("old A confirmation callbacks cannot borrow B's bearer or patch B after login", async () => {
  await mount();
  const oldWallet = wallet;
  const oldCosmetics = cosmetics;
  await switchToB();
  const walletReads = jest.mocked(getWallet).mock.calls.length;
  const cosmeticsReads = jest.mocked(getCosmetics).mock.calls.length;
  await act(async () => {
    await oldWallet.refresh();
    await oldWallet.spend("extra_pack");
    await oldCosmetics.refresh();
    await oldCosmetics.buy("sensei_sage");
    await oldCosmetics.equip("sensei_sage");
    oldWallet.applyCheckReward(9999);
    oldWallet.applyCheckReward(9999, captureAccountScope());
  });
  expect(getWallet).toHaveBeenCalledTimes(walletReads);
  expect(getCosmetics).toHaveBeenCalledTimes(cosmeticsReads);
  expect(spendItem).not.toHaveBeenCalled();
  expect(buyCosmetic).not.toHaveBeenCalled();
  expect(equipCosmetic).not.toHaveBeenCalled();
  expect(wallet.coins).toBe(B.coins);
  expect(cosmetics.owned).toEqual(CB.owned);
});
