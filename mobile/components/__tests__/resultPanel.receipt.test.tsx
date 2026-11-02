import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import ResultPanel from "../ResultPanel";
import Sensei from "../ui/Sensei";
import { ThemeProvider } from "../../theme/theme";
import type { Exercise } from "../../services/api";
import type { Result } from "../../store/useExerciseCheck";

jest.mock("../../store/i18n", () => ({ useI18n: () => ({ lang: "en", t: (key: string, args?: Record<string, unknown>) => key === "result.xp" ? `+${args?.n} XP` : key }) }));
let mockBeltEarned = 0;
jest.mock("../../store/progress", () => {
  const actual = jest.requireActual("../../store/progress");
  return {
    ...actual,
    useProgress: () => ({ progress: { ...actual.DEFAULT_PROGRESS, beltEarned: mockBeltEarned, currentCorrectRun: 5 } }),
  };
});
jest.mock("../ui/Sensei", () => ({ __esModule: true, default: jest.fn(() => null) }));
const exercise = { token: "signed" } as Exercise;
function render(result: Result) {
  let screen!: ReactTestRenderer;
  act(() => { screen = TestRenderer.create(<ThemeProvider><ResultPanel result={result} exercise={exercise} levelUp={null} explained={null} explainLoading={false} onExplain={() => {}} /></ThemeProvider>); });
  const text = JSON.stringify(screen.toJSON());
  act(() => screen.unmount());
  return text;
}

test("the panel displays the committed combo/boost total, not a reconstructed base reward", () => {
  const text = render({ correct: true, correct_answer: "a", xpEarned: 60 });
  expect(text).toContain("+60 XP");
  expect(text).not.toContain("+10 XP");
});
test("a hinted success remains visibly assisted", () => {
  expect(render({ correct: true, correct_answer: "a", xpEarned: 10, hintUsed: true })).toContain("With a hint");
});
test("a missing receipt does not fabricate XP or an Almost message for a correct answer", () => {
  const text = render({ correct: true, correct_answer: "a", score: 1, detail: "full credit" });
  expect(text).not.toContain(" XP");
  expect(text).not.toContain("result.almost");
});

test("the feedback mentor wears the learner’s earned belt", () => {
  mockBeltEarned = 0;
  render({ correct: true, correct_answer: "a" });
  expect(jest.mocked(Sensei).mock.calls.at(-1)?.[0].belt?.id).toBe("white");
  mockBeltEarned = 2;
  render({ correct: false, correct_answer: "a" });
  expect(jest.mocked(Sensei).mock.calls.at(-1)?.[0].belt?.idx).toBe(2);
  mockBeltEarned = 0;
});
