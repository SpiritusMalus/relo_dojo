// Screen smoke test: the Login route renders end-to-end under ThemeProvider, shows its two fields,
// and a filled-in form submits the typed credentials. Stores that reach for native modules
// (Auth→SecureStore, equipped-cosmetic context, safe-area insets, i18n) are mocked so the test
// exercises the screen's own wiring, not the provider tree.
import { createElement, type ReactElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import LoginScreen from "../login";
import { ThemeProvider } from "../../theme/theme";

const mockLogin = jest.fn(() => Promise.resolve());
const mockRegister = jest.fn(() => Promise.resolve());

jest.mock("../../store/auth", () => ({ useAuth: () => ({ login: mockLogin, register: mockRegister }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
jest.mock("../../store/cosmeticsStore", () => ({
  // Return the real classic default visual so the Sensei mascot has a full spec to render.
  useEquippedSenseiVisual: () => jest.requireActual("../../store/cosmetics").senseiVisual(undefined),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

function render(node: ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(createElement(ThemeProvider, null, node));
  });
  return r;
}

const inputByLabel = (r: ReactTestRenderer, label: string) =>
  r.root.findAll(
    (n) => typeof n.type === "string" && n.props.accessibilityLabel === label && typeof n.props.onChangeText === "function"
  )[0];

const buttons = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function");

describe("Login screen (smoke)", () => {
  beforeEach(() => {
    mockLogin.mockClear();
    mockRegister.mockClear();
  });

  it("renders the brand + both fields without throwing", () => {
    const r = render(<LoginScreen />);
    expect(JSON.stringify(r.toJSON())).toContain("Grammar Dojo");
    expect(inputByLabel(r, "login.email")).toBeTruthy();
    expect(inputByLabel(r, "login.password")).toBeTruthy();
  });

  it("submits the typed credentials (login mode)", async () => {
    const r = render(<LoginScreen />);
    act(() => inputByLabel(r, "login.email").props.onChangeText("a@b.com"));
    act(() => inputByLabel(r, "login.password").props.onChangeText("password123"));

    // The submit Button is the first role=button in JSX order (before the mode-toggle).
    await act(async () => {
      await buttons(r)[0].props.onPress();
    });
    expect(mockLogin).toHaveBeenCalledWith("a@b.com", "password123");
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
