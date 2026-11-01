import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Share, TextInput } from "react-native";
import SettingsScreen from "../settings";
import TextReviewScreen from "../text-review";
import Button from "../../components/ui/Button";
import { ThemeProvider } from "../../theme/theme";
import { deleteAccount, exportMyData, reviewText, setAuthToken } from "../../services/api";
import { trackReviewSubmitted } from "../../services/analytics";

const mockLogout = jest.fn(async () => {});
const mockUpdate = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ lang: "en", t: (key: string) => key, setLang: jest.fn() }) }));
jest.mock("../../store/auth", () => ({ useAuth: () => ({ user: { email: "a@example.com" }, logout: mockLogout }) }));
jest.mock("../../store/progress", () => ({ useProgress: () => ({ progress: {}, resetOnboarding: jest.fn(), updateProfile: mockUpdate }) }));
jest.mock("../../components/ui/Sensei", () => () => null);
jest.mock("../../services/analytics", () => ({ trackReviewSubmitted: jest.fn() }));
jest.mock("../../services/api", () => ({ ...jest.requireActual("../../services/api"), deleteAccount: jest.fn(), exportMyData: jest.fn(), reviewText: jest.fn() }));

const token = (id: string) => `header.${btoa(JSON.stringify({ sub: id }))}.signature`;
let renderer: ReactTestRenderer | undefined;
function mount(screen: React.ReactElement) {
  act(() => { renderer = TestRenderer.create(<ThemeProvider>{screen}</ThemeProvider>); });
  return renderer!;
}
const button = (r: ReactTestRenderer, label: string) => r.root.findAll((n) => n.type === Button).find((n) => n.props.label === label)!;
beforeEach(() => { jest.clearAllMocks(); setAuthToken(token("A")); });
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; setAuthToken(null); jest.restoreAllMocks(); });

it("does not execute A's native deletion confirmation after a switch to B", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const r = mount(<SettingsScreen />);
  act(() => r.root.findAll((n) => n.props.accessibilityLabel === "settings.deleteAccount" && typeof n.props.onPress === "function")[0].props.onPress());
  const confirm = alert.mock.calls[0][2]!.find((item) => item.style === "destructive")!.onPress!;
  act(() => setAuthToken(token("B")));
  await act(async () => { await confirm(); });
  expect(deleteAccount).not.toHaveBeenCalled();
  expect(mockLogout).not.toHaveBeenCalled();
});

it("a late A deletion success cannot sign B out", async () => {
  let resolve!: () => void;
  jest.mocked(deleteAccount).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const r = mount(<SettingsScreen />);
  act(() => r.root.findAll((n) => n.props.accessibilityLabel === "settings.deleteAccount" && typeof n.props.onPress === "function")[0].props.onPress());
  const confirm = alert.mock.calls[0][2]!.find((item) => item.style === "destructive")!.onPress!;
  let pending: unknown;
  act(() => { pending = confirm(); });
  act(() => setAuthToken(token("B")));
  await act(async () => { resolve(); await pending; });
  expect(mockLogout).not.toHaveBeenCalled();
});

it("does not open a late A export in B's share sheet", async () => {
  let resolve!: (data: Awaited<ReturnType<typeof exportMyData>>) => void;
  jest.mocked(exportMyData).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const share = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.dismissedAction });
  const r = mount(<SettingsScreen />);
  let pending!: Promise<void>;
  act(() => { pending = button(r, "settings.exportData").props.onPress(); });
  act(() => setAuthToken(token("B")));
  await act(async () => { resolve({ private: "A data" } as unknown as Awaited<ReturnType<typeof exportMyData>>); await pending; });
  expect(share).not.toHaveBeenCalled();
});

it.each(["switch", "unmount"])("a late A text review after %s cannot appear or become B analytics", async (action) => {
  let resolve!: (data: any) => void;
  jest.mocked(reviewText).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const r = mount(<TextReviewScreen />);
  act(() => r.root.findAll((n) => typeof n.props.onChangeText === "function")[0].props.onChangeText("A private writing sample."));
  let pending!: Promise<void>;
  act(() => { pending = button(r, "trev.submit").props.onPress(); });
  act(() => { if (action === "switch") setAuthToken(token("B")); else { r.unmount(); renderer = undefined; } });
  await act(async () => { resolve({ summary: "A private review", issues: [] }); await pending; });
  expect(trackReviewSubmitted).not.toHaveBeenCalled();
  if (action === "switch") expect(JSON.stringify(r.toJSON())).not.toContain("A private review");
});
