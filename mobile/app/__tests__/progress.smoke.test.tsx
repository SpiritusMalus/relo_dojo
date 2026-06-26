// Screen smoke test: the Progress tab renders end-to-end (the read-only belt-journey/stats map) for a
// default progress snapshot without throwing. Stores reaching native modules are mocked; the real
// derivations (dojo/quest/diary) still run on the default progress object.
import { createElement, type ReactElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import ProgressScreen from "../(tabs)/progress";
import { ThemeProvider } from "../../theme/theme";

jest.mock("../../store/i18n", () => ({ useI18n: () => ({ t: (k: string) => k, lang: "en" }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../store/auth", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("../../store/wallet", () => ({
  useWallet: () => ({
    coins: 0,
    freezes: 0,
    isPremium: false,
    leftToday: null,
    refresh: jest.fn(),
    applyCheckReward: jest.fn(),
  }),
}));
jest.mock("../../store/cosmeticsStore", () => {
  const c = jest.requireActual("../../store/cosmetics");
  return {
    useEquippedSenseiVisual: () => c.senseiVisual(undefined),
    useEquippedKnotVisual: () => c.knotVisual(undefined),
  };
});
jest.mock("../../store/progress", () => {
  const actual = jest.requireActual("../../store/progress");
  return { ...actual, useProgress: () => ({ progress: actual.DEFAULT_PROGRESS }) };
});

function render(node: ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(createElement(ThemeProvider, null, node));
  });
  return r;
}

describe("Progress screen (smoke)", () => {
  it("renders the default snapshot without throwing", () => {
    const r = render(<ProgressScreen />);
    expect(r.toJSON()).toBeTruthy();
    // Unmount so the screen's effects/animations clean up — otherwise self-driving timers in the
    // belt-journey/mascot keep firing past teardown ("accessed after the Jest environment was torn
    // down" + a force-exited worker, a CI flake/hang risk).
    act(() => r.unmount());
  });
});
