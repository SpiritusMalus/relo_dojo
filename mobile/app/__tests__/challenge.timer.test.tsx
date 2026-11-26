import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import type { ExerciseProps } from "../../components/types";
import Button from "../../components/ui/Button";
import { CHALLENGE_SECONDS, scoreAnswer } from "../../store/challenge";
import { ThemeProvider } from "../../theme/theme";
import ChallengeScreen from "../challenge";

const mockGrade = jest.fn();
const mockNext = jest.fn();
const mockBest = jest.fn();
let mockCard: ExerciseProps;

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../../store/i18n", () => ({
  useI18n: () => ({ lang: "en", t: (key: string, args?: { n?: number }) => args?.n !== undefined ? [key, args.n].join(" ") : key }),
}));
jest.mock("../../store/progress", () => {
  const actual = jest.requireActual("../../store/progress");
  return { ...actual, useProgress: () => ({ progress: actual.DEFAULT_PROGRESS }) };
});
jest.mock("../../store/auth", () => ({ useAuth: () => ({ token: "fixture-token" }) }));
jest.mock("../../store/challenge", () => ({
  ...jest.requireActual("../../store/challenge"),
  CHALLENGE_SECONDS: 4,
  loadBestScore: async () => 0,
  recordBestScore: (...args: unknown[]) => mockBest(...args),
}));
jest.mock("../../store/useExerciseCheck", () => {
  const React = require("react");
  return { useExerciseCheck: () => {
    const [checking, setChecking] = React.useState(false);
    const [result, setResult] = React.useState(null);
    const reset = React.useCallback(() => setResult(null), []);
    const beginAttempt = React.useCallback(() => {}, []);
    return { checking, result, reset, beginAttempt, markHintUsed: jest.fn(),
      check: async () => {
        setChecking(true);
        const grade = await mockGrade();
        setResult(grade);
        setChecking(false);
        return grade;
      },
    };
  } };
});
jest.mock("../../services/exerciseQueue", () => ({
  createExerciseQueue: () => ({ next: mockNext, clear: jest.fn(), dispose: jest.fn() }),
}));
jest.mock("../../components/ExerciseCard", () => (props: ExerciseProps) => { mockCard = props; return null; });
jest.mock("../../components/ResultPanel", () => () => null);
jest.mock("../../components/ui/Sensei", () => () => null);
jest.mock("../../components/ui/Confetti", () => () => null);

it("does not charge the timer during grading and includes the accepted answer in the one final score", async () => {
  jest.useFakeTimers({ doNotFake: ["setImmediate", "clearImmediate", "nextTick", "queueMicrotask"] });
  let screen: ReactTestRenderer | undefined;
  try {
    mockNext.mockResolvedValueOnce({ type: "multiple-blanks", topic: "articles", level: "A2", text: "Two blanks.", token: "fixture" });
    mockBest.mockResolvedValue({ best: 0, isRecord: false });
    await act(async () => { screen = TestRenderer.create(<ThemeProvider><ChallengeScreen /></ThemeProvider>); });
    const button = (label: string) => screen!.root.findAll((node) => node.type === Button && node.props.label === label)[0];
    const start = button("ch.start").props.onPress;
    await act(async () => { start(); start(); });
    expect(mockNext).toHaveBeenCalledTimes(1);
    for (let elapsed = 0; elapsed < CHALLENGE_SECONDS - 1; elapsed++) {
      act(() => jest.advanceTimersByTime(1000));
    }
    act(() => mockCard.onChange(["a", "b"], "a / b"));
    let resolve!: (value: { correct: boolean; score: number }) => void;
    mockGrade.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const check = button("action.check").props.onPress;
    act(() => { check(); check(); });
    expect(mockGrade).toHaveBeenCalledTimes(1);
    expect(mockCard.locked).toBe(true);
    act(() => jest.advanceTimersByTime(30_000));
    expect(mockBest).not.toHaveBeenCalled();

    await act(async () => { resolve({ correct: false, score: 0.5 }); });
    const points = scoreAnswer(0, false, 0.5).points;
    expect(JSON.stringify(screen!.toJSON())).toContain(["challenge.pointsEarned", points].join(" "));
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(mockBest).toHaveBeenCalledTimes(1);
    expect(mockBest.mock.calls[0][0]).toBe(points);
    expect(button("ch.playAgain")).toBeDefined();
    act(() => { check(); jest.advanceTimersByTime(30_000); });
    expect(mockGrade).toHaveBeenCalledTimes(1);
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockBest).toHaveBeenCalledTimes(1);
  } finally {
    if (screen) act(() => screen!.unmount());
    jest.useRealTimers();
  }
});
