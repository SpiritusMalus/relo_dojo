import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import Scroll from "../ui/Scroll";
import Button from "../ui/Button";
import { ApiError, openScroll } from "../../services/api";

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

beforeEach(() => jest.clearAllMocks());

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
});
