import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import Scroll from "../ui/Scroll";
import Button from "../ui/Button";
import { ApiError, openScroll } from "../../services/api";
import { trackScrollOpen } from "../../services/analytics";
import { setAccountToken } from "../../store/accountScope";

const mockRefresh = jest.fn();
const mockBoost = jest.fn();
jest.mock("../../services/api", () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, responseStatus: number, errorCode?: string) {
      super(message); this.status = responseStatus; this.code = errorCode;
    }
  }
  return { ApiError, openScroll: jest.fn() };
});
jest.mock("../../services/analytics", () => ({ trackScrollOpen: jest.fn() }));
jest.mock("../../store/wallet", () => ({ useWallet: () => ({ refresh: mockRefresh }) }));
jest.mock("../../store/progress", () => ({ useProgress: () => ({ activateBoost: mockBoost }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, lang: "en" }) }));
jest.mock("../../theme/theme", () => ({
  ...jest.requireActual("../../theme/theme"),
  useTheme: () => ({ ...jest.requireActual("../../theme/theme").makeTheme("light"), reduceMotion: true }),
}));
jest.mock("../ui/Confetti", () => () => null);

function render() {
  let screen!: ReactTestRenderer;
  act(() => { screen = TestRenderer.create(<Scroll onDone={jest.fn()} />); });
  return screen;
}
function button(screen: ReactTestRenderer, label: string) {
  return screen.root.findAll((node) => node.type === Button && node.props.label === label)[0];
}
function hasText(screen: ReactTestRenderer, key: string) {
  return JSON.stringify(screen.toJSON()).includes(key);
}

const token = (sub: string) => `header.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.signature`;
beforeEach(() => { jest.clearAllMocks(); setAccountToken(null); });
afterEach(() => { setAccountToken(null); });

describe("Reward scroll recovery", () => {
  it("offers explicit retry for a network failure without claiming the daily cap", async () => {
    (openScroll as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    const screen = render();
    await act(async () => { await button(screen, "scroll.open").props.onPress(); });
    expect(hasText(screen, "scroll.network")).toBe(true);
    expect(hasText(screen, "scroll.spent")).toBe(false);
    expect(button(screen, "scroll.retry")).toBeTruthy();
    expect(button(screen, "action.finish")).toBeTruthy();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    act(() => screen.unmount());
  });

  it("shows the daily-cap message only for its exact server code", async () => {
    (openScroll as jest.Mock).mockRejectedValueOnce(new ApiError("cap", 403, "scroll_limit"));
    const screen = render();
    await act(async () => { await button(screen, "scroll.open").props.onPress(); });
    expect(hasText(screen, "scroll.spent")).toBe(true);
    expect(button(screen, "scroll.retry")).toBeUndefined();
    act(() => screen.unmount());
  });

  it("never automatically retries an uncertain grant and can reveal an explicit retry", async () => {
    (openScroll as jest.Mock).mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({ kind: "kensei", amount: 0, coins: 0, freezes: 0 });
    const screen = render();
    await act(async () => { await button(screen, "scroll.open").props.onPress(); });
    expect(openScroll).toHaveBeenCalledTimes(1);
    await act(async () => { await button(screen, "scroll.retry").props.onPress(); });
    expect(openScroll).toHaveBeenCalledTimes(2);
    expect(mockBoost).toHaveBeenCalledTimes(1);
    expect(hasText(screen, "scroll.kensei")).toBe(true);
    expect(button(screen, "action.finish")).toBeTruthy();
    act(() => screen.unmount());
  });

  it("latches rapid taps before React commits the loading state", async () => {
    let resolve!: (reward: object) => void;
    (openScroll as jest.Mock).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const screen = render();
    const press = button(screen, "scroll.open").props.onPress;
    let pending!: Promise<void>;
    act(() => { pending = press(); void press(); });
    expect(openScroll).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ kind: "koku", amount: 5, coins: 5, freezes: 0 });
      await pending;
    });
    expect(hasText(screen, "scroll.koku")).toBe(true);
    act(() => screen.unmount());
  });

  it.each(["success", "failure"] as const)("ignores A's late %s after B replaces the session", async (outcome) => {
    setAccountToken(token("a"));
    let resolve!: (reward: object) => void;
    let reject!: (reason: Error) => void;
    (openScroll as jest.Mock).mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const screen = render();
    let pending!: Promise<void>;
    act(() => { pending = button(screen, "scroll.open").props.onPress(); });
    setAccountToken(token("b"));
    await act(async () => {
      if (outcome === "success") resolve({ kind: "kensei", amount: 0, coins: 30, freezes: 0 });
      else reject(new Error("response lost"));
      await pending;
    });
    expect(mockBoost).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(hasText(screen, "scroll.earned")).toBe(false);
    expect(hasText(screen, "scroll.network")).toBe(false);
    act(() => screen.unmount());
  });

  it("cannot apply a late boost or wallet refresh after its screen unmounts", async () => {
    setAccountToken(token("a"));
    let resolve!: (reward: object) => void;
    (openScroll as jest.Mock).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const screen = render();
    let pending!: Promise<void>;
    act(() => { pending = button(screen, "scroll.open").props.onPress(); });
    act(() => screen.unmount());
    await act(async () => { resolve({ kind: "kensei", amount: 0, coins: 30, freezes: 0 }); await pending; });
    expect(mockBoost).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("an old A open callback cannot send a request or analytics with B's identity", async () => {
    setAccountToken(token("a"));
    const screen = render();
    const press = button(screen, "scroll.open").props.onPress;
    setAccountToken(token("b"));
    await act(async () => { await press(); });
    expect(openScroll).not.toHaveBeenCalled();
    expect(trackScrollOpen).not.toHaveBeenCalled();
    act(() => screen.unmount());
  });
});
