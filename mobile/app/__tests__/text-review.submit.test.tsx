import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import Button from "../../components/ui/Button";
import { reviewText, type ReviewResult } from "../../services/api";
import { setAccountToken } from "../../store/accountScope";
import { ThemeProvider } from "../../theme/theme";
import TextReviewScreen from "../text-review";

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ lang: "en", t: (key: string) => key }) }));
jest.mock("../../services/api", () => ({ ...jest.requireActual("../../services/api"), reviewText: jest.fn() }));
jest.mock("../../components/ui/Sensei", () => () => null);
jest.mock("../../components/ui/DataGuard", () => () => null);

let screen: ReactTestRenderer;
beforeEach(async () => {
  jest.clearAllMocks();
  setAccountToken("header.eyJzdWIiOiJ0ZXh0LXJldmlldy10ZXN0In0.signature");
  await act(async () => { screen = TestRenderer.create(<ThemeProvider><TextReviewScreen /></ThemeProvider>); });
});
afterEach(() => {
  act(() => screen.unmount());
  setAccountToken(null);
});

function input() {
  return screen.root.findAll((node) => node.props.accessibilityLabel === "trev.title"
    && typeof node.props.onChangeText === "function")[0];
}

function action(label: string) {
  return screen.root.findAll((node) => node.type === Button && node.props.label === label)[0];
}

it("checks one immutable draft, keeps it on failure and can reopen it after success", async () => {
  const draft = "I ran into a problem during the meeting.";
  act(() => input().props.onChangeText(draft));
  const edit = input().props.onChangeText;
  let reject!: (issue: Error) => void;
  jest.mocked(reviewText).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  const submit = action("trev.submit").props.onPress;
  act(() => { submit(); submit(); edit("A later unsent edit."); });
  expect(reviewText).toHaveBeenCalledTimes(1);
  expect(input().props.editable).toBe(false);
  await act(async () => { reject(new Error("network")); });
  expect(input().props.value).toBe(draft);
  expect(input().props.editable).toBe(true);
  expect(JSON.stringify(screen.toJSON())).toContain("trev.error");

  const result: ReviewResult = { summary: "Clear text.", issues: [], topics: [] };
  jest.mocked(reviewText).mockResolvedValueOnce(result);
  await act(async () => { await action("action.tryAgain").props.onPress(); });
  expect(jest.mocked(reviewText).mock.calls.map(([text]) => text)).toEqual([draft, draft]);
  expect(JSON.stringify(screen.toJSON())).toContain("Clear text.");
  act(() => action("trev.edit").props.onPress());
  expect(input().props.value).toBe(draft);
});
