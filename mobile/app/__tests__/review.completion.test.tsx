import AsyncStorage from "@react-native-async-storage/async-storage";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import ReviewScreen from "../review";
import Button from "../../components/ui/Button";
import { ThemeProvider } from "../../theme/theme";
import { captureMistake, loadMistakes } from "../../store/mistakes";
import { ApiError, renewReviewToken, setAuthToken, type Exercise } from "../../services/api";
import type { Result } from "../../store/useExerciseCheck";

let mockGrade: Result;
let mockExerciseProps: any;
const mockCheck = jest.fn();
const mockReplace = jest.fn();
const mockBegin = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), replace: mockReplace }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("../../services/api", () => ({ ...jest.requireActual("../../services/api"), renewReviewToken: jest.fn() }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ lang: "en", t: (key: string, args?: Record<string, unknown>) => args ? `${key}:${JSON.stringify(args)}` : key }) }));
jest.mock("../../store/progress", () => {
  const actual = jest.requireActual("../../store/progress");
  return { ...actual, useProgress: () => ({ progress: actual.DEFAULT_PROGRESS }) };
});
jest.mock("../../store/useExerciseCheck", () => ({ useExerciseCheck: () => {
  const React = require("react");
  const [result, setResult] = React.useState(null);
  const [expired, setExpired] = React.useState(false);
  return { result, checking: false, beginAttempt: mockBegin, markHintUsed: jest.fn(), doExplain: jest.fn(),
    error: expired ? "This exercise expired." : null, errorCode: expired ? "exercise_expired" : null,
    reset: () => setResult(null), check: async (...args: unknown[]) => {
      if (await mockCheck(...args) === "expired") { setExpired(true); return null; }
      setExpired(false); setResult(mockGrade); return mockGrade;
    },
  };
} }));
jest.mock("../../components/ExerciseCard", () => (props: any) => { mockExerciseProps = props; return null; });
jest.mock("../../components/ResultPanel", () => () => null);
jest.mock("../../components/ui/Sensei", () => () => null);
jest.mock("../../components/ui/Confetti", () => () => null);
jest.mock("../../components/ui/ProgressBar", () => {
  const { View } = require("react-native");
  return (props: any) => <View testID="session-progress" pct={props.pct} />;
});

const exercise: Exercise = { type: "multiple-choice", topic: "articles", level: "A2", text: "I saw ___ owl.", prompt: "",
  options: ["a", "an"], tiles: [], tokens: [], left: [], right: [], blankOptions: [], token: "review-token" };
let screen: ReactTestRenderer;
beforeEach(async () => {
  jest.clearAllMocks();
  setAuthToken(null);
  await AsyncStorage.clear();
  await captureMistake(exercise);
  mockGrade = { correct: true, correct_answer: "an", xpEarned: 30, hintUsed: false };
  await act(async () => { screen = TestRenderer.create(<ThemeProvider><ReviewScreen /></ThemeProvider>); });
});
afterEach(() => act(() => screen.unmount()));
function action(label: string) { return screen.root.findAll((node) => node.type === Button && node.props.label === label)[0]; }
function progressPercent() { return screen.root.findAll((node) => node.props.testID === "session-progress")[0].props.pct; }
async function answerAndFinish() {
  act(() => mockExerciseProps.onChange("an", "an"));
  await act(async () => { await action("action.check").props.onPress(); });
  await act(async () => { action("action.finish").props.onPress(); });
}

test("completion reaches100%, shows the actual XP and routes its Home label to Home", async () => {
  await answerAndFinish();
  expect(progressPercent()).toBe(100);
  const text = JSON.stringify(screen.toJSON());
  expect(text).toContain('review.done');
  expect(text).toContain('result.xp');
  expect(text).toContain('30');
  expect((await loadMistakes())[0].box).toBe(1);
  act(() => action("Back to Home").props.onPress());
  expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
});

test("a hinted correct answer stays due and is not counted as a fixed recall", async () => {
  mockGrade = { ...mockGrade, hintUsed: true };
  await answerAndFinish();
  const stored = await loadMistakes();
  expect(stored[0].box).toBe(0);
  const text = JSON.stringify(screen.toJSON());
  expect(text).toContain('Ready to review: 1');
  expect(text).toContain('\\"c\\":0');
  expect(progressPercent()).toBe(100);
});

test("an expired review card is renewed once, retaining the same display and submitted answer", async () => {
  mockCheck.mockResolvedValueOnce("expired");
  jest.mocked(renewReviewToken).mockResolvedValueOnce({ review_token: "renewed-review-token" });
  act(() => mockExerciseProps.onChange("an", "an"));
  await act(async () => { await action("action.check").props.onPress(); });
  expect(JSON.stringify(screen.toJSON())).toContain("review.expired");
  const reload = action("review.renew").props.onPress;
  await act(async () => { await Promise.all([reload(), reload()]); });
  expect(renewReviewToken).toHaveBeenCalledTimes(1);
  expect(renewReviewToken).toHaveBeenCalledWith("review-token");
  expect(mockCheck).toHaveBeenLastCalledWith(expect.objectContaining({ token: "renewed-review-token" }), "an", expect.any(Function), "an");
  const saved = (await loadMistakes())[0];
  expect(saved.exercise.token).toBe("renewed-review-token");
  expect(saved.box).toBe(1);
});

test("a rollback without a renewal route leaves the expired card stored and allows advancing", async () => {
  mockCheck.mockResolvedValueOnce("expired");
  jest.mocked(renewReviewToken).mockRejectedValueOnce(new ApiError("Not Found", 404));
  act(() => mockExerciseProps.onChange("an", "an"));
  await act(async () => { await action("action.check").props.onPress(); });
  await act(async () => { await action("review.renew").props.onPress(); });
  expect(JSON.stringify(screen.toJSON())).toContain("review.unrecoverable");
  expect(action("review.practiceTopic")).toBeDefined();
  await act(async () => { action("action.continue").props.onPress(); });
  expect((await loadMistakes())[0].exercise.token).toBe("review-token");
  expect(mockCheck).toHaveBeenCalledTimes(1);
});
