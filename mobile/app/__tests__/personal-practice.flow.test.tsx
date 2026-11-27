import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import type { ExerciseProps } from "../../components/types";
import Button from "../../components/ui/Button";
import { ApiError, type Exercise } from "../../services/api";
import type { PersonalPracticeTarget } from "../../services/personalPractice";
import { ThemeProvider } from "../../theme/theme";
import PersonalPracticeScreen from "../personal-practice";

const mockLoad = jest.fn<Promise<Exercise>, [PersonalPracticeTarget, "practice" | "test", readonly Exercise[], AbortSignal]>();
const mockBack = jest.fn();
const mockTargets = jest.fn<PersonalPracticeTarget[], []>();
const mockGrade = jest.fn<Promise<{ correct: boolean; correct_answer: string } | null>, []>();
let mockCard: ExerciseProps & { translationEnabled: boolean };

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ topic: "prepositions" }),
  useRouter: () => ({ back: mockBack, canGoBack: () => true }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../store/i18n", () => ({
  useI18n: () => ({ lang: "ru", t: (key: string) => jest.requireActual("../../i18n/strings").STRINGS.ru[key] }),
}));
jest.mock("../../store/progress", () => ({
  useProgress: () => ({ progress: { skill: {}, topics: {} } }),
}));
jest.mock("../../store/mistakes", () => ({ loadMistakes: async () => [] }));
jest.mock("../../store/useExerciseCheck", () => {
  const React = require("react");
  return { useExerciseCheck: () => {
    const [result, setResult] = React.useState(null);
    return {
      result, checking: false, submissionLocked: !!result, beginAttempt: jest.fn(),
      reset: () => setResult(null),
      check: async () => {
        const grade = await mockGrade();
        setResult(grade);
        return grade;
      },
    };
  } };
});
jest.mock("../../services/personalPracticeEnabled", () => ({ personalPracticeEnabled: () => true }));
jest.mock("../../services/personalPractice", () => ({
  PERSONAL_PRACTICE_COUNT: 3, PERSONAL_TEST_COUNT: 3, PERSONAL_TEST_PASS: 2,
  personalPracticeTargets: () => mockTargets(), getPersonalPracticeExercise: (...args: Parameters<typeof mockLoad>) => mockLoad(...args),
}));
jest.mock("../../components/ExerciseCard", () => (props: typeof mockCard) => { mockCard = props; return null; });
jest.mock("../../components/ResultPanel", () => () => null);

const target: PersonalPracticeTarget = { topic: "prepositions", level: "A2", mistakes: [] };
const card: Exercise = {
  type: "multiple-choice", topic: "prepositions", level: "A2", text: "We take care ___ our dog.",
  prompt: "", tiles: [], options: ["in", "of"], tokens: [], left: [], right: [], blankOptions: [], token: "token",
};

let screen: ReactTestRenderer;

beforeEach(() => {
  jest.clearAllMocks();
  mockTargets.mockReturnValue([target]);
  let id = 0;
  mockLoad.mockImplementation(async () => ({ ...card, token: `test-${++id}`, text: `Example ${id}` }));
});

afterEach(() => act(() => screen.unmount()));

function button(label: string) {
  return screen.root.findAll((node) => node.type === Button && node.props.label === label)[0];
}

async function render() {
  await act(async () => {
    screen = TestRenderer.create(<ThemeProvider><PersonalPracticeScreen /></ThemeProvider>);
  });
}

async function tap(label: string) {
  await act(async () => { await button(label).props.onPress(); });
}

async function answer(correct: boolean) {
  mockGrade.mockResolvedValueOnce({ correct, correct_answer: "of" });
  act(() => mockCard.onChange("of", "of"));
  await tap("Проверить");
}

it("passes only after three test answers, hides hints and answers during the checkpoint", async () => {
  await render();
  await tap("Начать тренировку");
  for (let index = 0; index < 3; index++) {
    expect(mockCard.translationEnabled).toBe(true);
    await answer(false);
    expect(mockCard.feedback?.correct).toBe(false);
    await tap(index < 2 ? "Следующее задание" : "К зачёту");
  }
  await tap("Начать зачёт");
  expect(mockLoad.mock.calls[3][1]).toBe("test");
  expect(mockLoad.mock.calls[3][2].slice(0, 3).map((exercise) => exercise.text)).toEqual(["Example 1", "Example 2", "Example 3"]);
  for (let index = 0; index < 3; index++) {
    expect(mockCard.translationEnabled).toBe(false);
    await answer(index > 0);
    expect(mockCard.feedback).toBeUndefined();
    expect(JSON.stringify(screen.toJSON())).not.toContain("Зачёт пройден");
    await tap(index < 2 ? "Следующее задание" : "Показать результат");
  }
  expect(JSON.stringify(screen.toJSON())).toContain("Зачёт пройден");
  expect(JSON.stringify(screen.toJSON())).toContain("Верно 2 из 3");
  expect(mockLoad).toHaveBeenCalledTimes(6);
});

it("offers one retry for the same round after a load error", async () => {
  mockLoad.mockRejectedValueOnce(new ApiError("offline", 0, "learning_offline"));
  await render();
  await tap("Начать тренировку");
  expect(JSON.stringify(screen.toJSON())).toContain("Нет интернета");
  const retry = button(jest.requireActual("../../i18n/strings").STRINGS.ru["action.tryAgain"]).props.onPress;
  await act(async () => { retry(); retry(); });
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(mockCard.exercise.topic).toBe("prepositions");
  expect(JSON.stringify(screen.toJSON())).toContain("Задание 1 из 3");
});

it("requires an eligible saved mistake or a topic from text review before loading an exercise", async () => {
  mockTargets.mockReturnValue([]);
  await render();
  expect(JSON.stringify(screen.toJSON())).toContain("Пока нет ошибок для тренировки");
  expect(button("Начать тренировку")).toBeUndefined();
  expect(mockLoad).not.toHaveBeenCalled();
});
