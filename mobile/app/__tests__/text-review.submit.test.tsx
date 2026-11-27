import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import Button from "../../components/ui/Button";
import { reviewText, type ReviewResult } from "../../services/api";
import { personalPracticeEnabled } from "../../services/personalPracticeEnabled";
import { setAccountToken } from "../../store/accountScope";
import { ThemeProvider } from "../../theme/theme";
import TextReviewScreen from "../text-review";

const mockNavigate = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), navigate: mockNavigate }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ lang: "en", t: (key: string) => key }) }));
jest.mock("../../services/api", () => ({ ...jest.requireActual("../../services/api"), reviewText: jest.fn() }));
jest.mock("../../services/personalPracticeEnabled", () => ({ personalPracticeEnabled: jest.fn(() => false) }));
jest.mock("../../components/ui/Sensei", () => () => null);
jest.mock("../../components/ui/DataGuard", () => () => null);

let screen: ReactTestRenderer;
beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(personalPracticeEnabled).mockReturnValue(false);
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

it("offers one action per supported issue topic and passes no writing samples to practice", async () => {
  jest.mocked(personalPracticeEnabled).mockReturnValue(true);
  jest.mocked(reviewText).mockResolvedValueOnce({
    summary: "Review complete.",
    topics: ["prepositions"],
    issues: [
      { topic: "prepositions", quote: "private first phrase", better: "corrected first phrase", note: "" },
      { topic: "prepositions", quote: "private second phrase", better: "corrected second phrase", note: "" },
      { topic: "unsupported topic", quote: "private third phrase", better: "corrected third phrase", note: "" },
    ],
  });
  act(() => input().props.onChangeText("A writing sample that must stay on this screen."));
  await act(async () => { await action("trev.submit").props.onPress(); });

  const entries = screen.root.findAll((node) => node.type === Button && node.props.label === "Practise this topic");
  expect(entries).toHaveLength(1);
  const open = entries[0].props.onPress;
  act(() => open());
  expect(mockNavigate).toHaveBeenCalledWith({ pathname: "/personal-practice", params: { topic: "prepositions" } });
  act(() => { setAccountToken(null); open(); });
  expect(mockNavigate).toHaveBeenCalledTimes(1);
});
