import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import OfferBanner from "../ui/OfferBanner";
import Button from "../ui/Button";
import { loadOffers, markOffer, type OfferState } from "../../store/offers";
import { captureAccountScope, setAccountToken } from "../../store/accountScope";

const mockSpend = jest.fn(async () => {});
const mockRefresh = jest.fn(async () => {});
jest.mock("../../store/offers", () => ({ ...jest.requireActual("../../store/offers"), loadOffers: jest.fn(), markOffer: jest.fn() }));
jest.mock("../../store/wallet", () => ({ useWallet: () => ({ coins: 100, spend: mockSpend, refresh: mockRefresh }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, lang: "en" }) }));
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]) }));
jest.mock("../../theme/theme", () => ({
  ...jest.requireActual("../../theme/theme"),
  useTheme: () => ({ ...jest.requireActual("../../theme/theme").makeTheme("light"), reduceMotion: true }),
}));

const token = (sub: string) => `header.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.signature`;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
let screen: ReactTestRenderer | undefined;
let live: OfferState;
async function render() { await act(async () => { screen = TestRenderer.create(<OfferBanner />); }); }
function buy() { return screen!.root.findAll((node) => node.type === Button)[0].props.onPress; }
function dismiss() { return screen!.root.findAll((node) => node.props.accessibilityLabel === "Dismiss offer")[0].props.onPress; }
beforeEach(() => {
  jest.clearAllMocks();
  setAccountToken(token("a"));
  live = { starter24: { expiresAt: new Date(Date.now() + 60_000).toISOString() } };
  jest.mocked(loadOffers).mockResolvedValue(live);
  jest.mocked(markOffer).mockResolvedValue({ starter24: { ...live.starter24!, redeemed: true } });
  mockSpend.mockResolvedValue();
  mockRefresh.mockResolvedValue();
});
afterEach(() => {
  if (screen) act(() => screen!.unmount());
  screen = undefined;
  setAccountToken(null);
});

it("a current A redemption marks only after spend and forwards A's captured scope", async () => {
  const a = captureAccountScope();
  await render();
  await act(async () => { await buy()(); });
  expect(mockSpend).toHaveBeenCalledWith("omamori_promo");
  expect(markOffer).toHaveBeenCalledWith("starter24", { redeemed: true }, a);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(screen!.toJSON()).toBeNull();
});

it("A's delayed spend cannot mark the device offer or refresh B", async () => {
  const old = deferred<void>();
  mockSpend.mockReturnValueOnce(old.promise);
  await render();
  let pending!: Promise<void>;
  act(() => { pending = buy()(); });
  setAccountToken(token("b"));
  await act(async () => { old.resolve(); await pending; });
  expect(markOffer).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
});

it("A's delayed offer mark cannot refresh B after spend completed", async () => {
  const old = deferred<OfferState>();
  jest.mocked(markOffer).mockReturnValueOnce(old.promise);
  await render();
  let pending!: Promise<void>;
  act(() => { pending = buy()(); });
  await act(async () => { await Promise.resolve(); });
  expect(markOffer).toHaveBeenCalledTimes(1);
  setAccountToken(token("b"));
  await act(async () => { old.resolve({}); await pending; });
  expect(mockRefresh).not.toHaveBeenCalled();
});

it("unmount before spend resolves prevents every subsequent local effect", async () => {
  const old = deferred<void>();
  mockSpend.mockReturnValueOnce(old.promise);
  await render();
  let pending!: Promise<void>;
  act(() => { pending = buy()(); });
  act(() => screen!.unmount());
  screen = undefined;
  await act(async () => { old.resolve(); await pending; });
  expect(markOffer).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
});

it("old A buy and dismiss callbacks cannot act under B", async () => {
  await render();
  const oldBuy = buy();
  const oldDismiss = dismiss();
  setAccountToken(token("b"));
  await act(async () => { await oldBuy(); await oldDismiss(); });
  expect(mockSpend).not.toHaveBeenCalled();
  expect(markOffer).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
});

it("a delayed A focus read cannot paint the old banner under B", async () => {
  const old = deferred<OfferState>();
  jest.mocked(loadOffers).mockReturnValueOnce(old.promise);
  await render();
  expect(screen!.toJSON()).toBeNull();
  setAccountToken(token("b"));
  await act(async () => { old.resolve(live); });
  expect(screen!.toJSON()).toBeNull();
});
