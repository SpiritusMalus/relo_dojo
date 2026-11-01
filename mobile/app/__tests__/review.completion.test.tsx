import AsyncStorage from "@react-native-async-storage/async-storage";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import ReviewScreen from "../review";
import Button from "../../components/ui/Button";
import { ThemeProvider } from "../../theme/theme";
import { captureMistake, loadMistakes } from "../../store/mistakes";
import { setAuthToken, type Exercise } from "../../services/api";
import type { Result } from "../../store/useExerciseCheck";

let mockGrade: Result;
let mockExerciseProps: any;
const mockReplace = jest.fn();
const mockBegin = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), replace: mockReplace }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ lang: "en", t: (key: string, args?: Record<string, unknown>) => args ? `${key}:${JSON.stringify(args)}` : key }) }));
jest.mock("../../store/progress", () => {
  const actual = jest.requireActual("../../store/progress");
  return { ...actual, useProgress: () => ({ progress: actual.DEFAULT_PROGRESS }) };
});
jest.mock("../../store/useExerciseCheck", () => ({ useExerciseCheck: () => {
  const React = require("react");
  const [result, setResult] = React.useState(null);
  return { result, checking: false, beginAttempt: mockBegin, markHintUsed: jest.fn(), doExplain: jest.fn(),
    reset: () => setResult(null), check: async () => { setResult(mockGrade); return mockGrade; } };
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
