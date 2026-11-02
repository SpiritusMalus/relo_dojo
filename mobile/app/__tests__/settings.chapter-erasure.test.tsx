import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Alert } from "react-native";
import SettingsScreen from "../settings";
import { ThemeProvider } from "../../theme/theme";
import { deleteAccount, setAuthToken } from "../../services/api";
import { purgeChapterDrafts } from "../../services/chapters";
import { captureAccountScope } from "../../store/accountScope";

const mockReplace = jest.fn();
const mockRefresh = jest.fn(async () => {});
const mockLogout = jest.fn(async () => { setAuthToken(null); });
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace, back: jest.fn(), push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ lang: "en", setLang: jest.fn(), t: (key: string) => key }) }));
jest.mock("../../store/auth", () => ({ useAuth: () => ({ token: "member", user: { email: "fixture@example.test" }, logout: mockLogout, refreshUser: mockRefresh }) }));
jest.mock("../../store/wallet", () => ({ useWallet: () => ({ ready: true, refresh: mockRefresh }) }));
jest.mock("../../store/cosmeticsStore", () => ({ useCosmetics: () => ({ ready: true, refresh: mockRefresh }) }));
jest.mock("../../store/progress", () => {
  const actual = jest.requireActual("../../store/progress");
  return { ...actual, useProgress: () => ({ progress: actual.DEFAULT_PROGRESS, resetOnboarding: jest.fn(), updateProfile: jest.fn() }) };
});
jest.mock("../../services/api", () => ({ ...jest.requireActual("../../services/api"), deleteAccount: jest.fn() }));
jest.mock("../../services/chapters", () => ({ purgeChapterDrafts: jest.fn() }));
jest.mock("../../components/ui/DataGuard", () => () => null);
const member = (id: string) => `header.${Buffer.from(JSON.stringify({ sub: id })).toString("base64url")}.signature`;
let renderer: ReactTestRenderer | undefined;
let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks(); setAuthToken(member("a"));
  jest.mocked(deleteAccount).mockResolvedValue(undefined);
  jest.mocked(purgeChapterDrafts).mockResolvedValue(undefined);
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; alert.mockRestore(); setAuthToken(null); });
async function confirmDeletion() {
  await act(async () => { renderer = TestRenderer.create(<ThemeProvider><SettingsScreen /></ThemeProvider>); });
  const action = renderer!.root.findAll((node) => node.props.accessibilityLabel === "settings.deleteAccount" && typeof node.props.onPress === "function")[0];
  act(() => action.props.onPress());
  const confirm = alert.mock.calls[0][2].find((button: { style?: string }) => button.style === "destructive");
  await act(async () => { await confirm.onPress(); });
}

it("signs out after server deletion even when local erasure fails, then retries only that local cleanup", async () => {
  jest.mocked(purgeChapterDrafts).mockRejectedValueOnce(new Error("native I/O"));
  const deletedOwner = captureAccountScope(); await confirmDeletion();
  expect(deleteAccount).toHaveBeenCalledTimes(1);
  expect(mockLogout).toHaveBeenCalledTimes(1);
  expect(captureAccountScope().owner).toBe("guest");
  expect(mockReplace).toHaveBeenCalledWith("/");
  expect(alert.mock.calls.at(-1)?.[0]).toBe("Account deleted");
  expect(alert.mock.calls.at(-1)?.[1]).toContain("Access is blocked");
  const retry = alert.mock.calls.at(-1)?.[2].find((button: { text?: string }) => button.text === "Retry erasing drafts");
  act(() => setAuthToken(member("b")));
  await act(async () => { retry.onPress(); });
  expect(deleteAccount).toHaveBeenCalledTimes(1);
  expect(purgeChapterDrafts).toHaveBeenLastCalledWith(deletedOwner);
  expect(captureAccountScope().owner).toBe("user:b");
  expect(alert.mock.calls.at(-1)?.[0]).toBe("Drafts erased");
});

it("does not erase drafts or sign out if server deletion itself fails", async () => {
  jest.mocked(deleteAccount).mockRejectedValueOnce(new Error("offline")); await confirmDeletion();
  expect(purgeChapterDrafts).not.toHaveBeenCalled(); expect(mockLogout).not.toHaveBeenCalled();
  expect(alert.mock.calls.at(-1)?.[1]).toBe("settings.deleteFail");
});
