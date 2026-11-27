import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import type { ExerciseProps } from "../../components/types";
import Button from "../../components/ui/Button";
import { RU_TOPIC_LABELS } from "../../i18n/strings";
import { ApiError, type Exercise } from "../../services/api";
import type { PersonalPracticeTarget } from "../../services/personalPractice";
import { loadGuestLimit, resetGuestLimit } from "../../store/guestLimit";
import { ThemeProvider } from "../../theme/theme";
import PersonalPracticeScreen from "../personal-practice";

const mockLoad = jest.fn<Promise<Exercise>, [PersonalPracticeTarget, "practice" | "test", readonly Exercise[], AbortSignal]>();
const mockBack = jest.fn();
const mockTargets = jest.fn<PersonalPracticeTarget[], []>();
const mockGrade = jest.fn<Promise<{ correct: boolean; correct_answer: string } | null>, []>();
let mockCard: ExerciseProps & { translationEnabled: boolean };
let mockTopic: string | undefined;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ topic: mockTopic }),
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
    const [error, setError] = React.useState(null);
    return {
      result, checking: false, submissionLocked: !!result, beginAttempt: jest.fn(),
      error: error?.message, errorCode: error?.code,
      reset: () => { setResult(null); setError(null); },
      check: async () => {
        try {
          const grade = await mockGrade();
          setResult(grade);
          return grade;
        } catch (value) {
          setError(value);
          return null;
        }
      },
    };
  } };
});
jest.mock("../../services/personalPracticeEnabled", () => ({ personalPracticeEnabled: () => true }));
jest.mock("../../services/personalPractice", () => ({
  ...jest.requireActual("../../services/personalPractice"),
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

beforeEach(async () => {
  jest.clearAllMocks();
  mockLoad.mockReset();
  mockGrade.mockReset();
  mockTargets.mockReturnValue([target]);
  mockTopic = undefined;
  await resetGuestLimit();
  let id = 0;
  mockLoad.mockImplementation(async (selection) => ({
    ...card, topic: selection.topic, level: selection.level, token: `test-${++id}`, text: `Example ${id}`,
  }));
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

async function chooseTopic(topic: string) {
  const radio = screen.root.findAll((node) => node.props.accessibilityRole === "radio"
    && node.props.accessibilityLabel === RU_TOPIC_LABELS[topic] && typeof node.props.onPress === "function")[0];
  await act(async () => { radio.props.onPress(); });
}

async function answer(correct: boolean) {
  mockGrade.mockResolvedValueOnce({ correct, correct_answer: "of" });
  act(() => mockCard.onChange("of", "of"));
  await tap("Проверить");
}

function readyCards() {
  return mockLoad.mock.calls.map(([, stage, seen]) => ({ stage, seen: seen.map(({ text }) => text) }));
}

function deferExercise() {
  let resolve!: (exercise: Exercise) => void;
  const promise = new Promise<Exercise>((done) => { resolve = done; });
  return { promise, resolve };
}

it("warms the first checkpoint while the final practice example is open and withholds checkpoint feedback", async () => {
  await render();
  expect(mockLoad).not.toHaveBeenCalled();
  await tap("Начать тренировку");
  expect(readyCards()).toEqual([
    { stage: "practice", seen: [] },
    { stage: "practice", seen: ["Example 1"] },
  ]);
  for (let index = 0; index < 3; index++) {
    expect(mockCard.translationEnabled).toBe(true);
    if (index === 2) {
      expect(mockGrade).toHaveBeenCalledTimes(2);
      expect(mockCard.exercise.text).toBe("Example 3");
      expect(readyCards()[3]).toEqual({ stage: "test", seen: ["Example 1", "Example 2", "Example 3"] });
      expect(button("Начать зачёт")).toBeUndefined();
      expect((await loadGuestLimit()).used).toBe(3);
    }
    await answer(false);
    expect(mockCard.feedback?.correct).toBe(false);
    await tap(index < 2 ? "Следующее задание" : "К зачёту");
  }
  expect(readyCards()).toEqual([
    { stage: "practice", seen: [] },
    { stage: "practice", seen: ["Example 1"] },
    { stage: "practice", seen: ["Example 1", "Example 2"] },
    { stage: "test", seen: ["Example 1", "Example 2", "Example 3"] },
  ]);
  expect((await loadGuestLimit()).used).toBe(3);
  await tap("Начать зачёт");
  expect((await loadGuestLimit()).used).toBe(4);
  expect(readyCards().slice(3)).toEqual([
    { stage: "test", seen: ["Example 1", "Example 2", "Example 3"] },
    { stage: "test", seen: ["Example 1", "Example 2", "Example 3", "Example 4"] },
  ]);
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
  expect(readyCards()[5]).toEqual({ stage: "test", seen: ["Example 1", "Example 2", "Example 3", "Example 4", "Example 5"] });
});

it("aborts the old topic and uses the new in-flight slot when Start is pressed immediately", async () => {
  const articles = { ...target, topic: "articles" };
  const oldRequest = deferExercise();
  const newRequest = deferExercise();
  mockTargets.mockReturnValue([target, articles]);
  mockLoad.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
  await render();
  expect(mockLoad).not.toHaveBeenCalled();

  await chooseTopic("prepositions");
  await chooseTopic("prepositions");
  expect(mockLoad).toHaveBeenCalledTimes(1);
  const oldSignal = mockLoad.mock.calls[0][3];
  const oldStart = button("Начать тренировку").props.onPress;
  await chooseTopic("articles");
  expect(oldSignal.aborted).toBe(true);
  expect(mockLoad.mock.calls.map(([selection]) => selection.topic)).toEqual(["prepositions", "articles"]);

  await act(async () => { oldStart(); oldStart(); oldRequest.resolve({ ...card, token: "late" }); });
  expect(JSON.stringify(screen.toJSON())).toContain("Задание 1 из 3");
  expect(button("Проверить")).toBeUndefined();
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect((await loadGuestLimit()).used).toBe(0);

  const selectedCard = { ...card, topic: "articles", token: "selected", text: "Please close ___ door." };
  await act(async () => { newRequest.resolve(selectedCard); });
  expect(mockCard.exercise).toEqual(selectedCard);
  expect(mockLoad.mock.calls.map(([selection]) => selection.topic)).toEqual(["prepositions", "articles", "articles"]);
  expect(readyCards()[2].seen).toEqual([selectedCard.text]);
  expect((await loadGuestLimit()).used).toBe(1);
});

it("warms the valid topic received from a checked text and waits for Start to spend guest quota", async () => {
  mockTopic = "prepositions";
  await render();
  expect(readyCards()).toEqual([{ stage: "practice", seen: [] }]);
  expect(mockLoad.mock.calls[0][0]).toEqual(target);
  expect((await loadGuestLimit()).used).toBe(0);
  await tap("Начать тренировку");
  expect(mockCard.exercise.text).toBe("Example 1");
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect((await loadGuestLimit()).used).toBe(1);
});

it("offers one retry for the same round after a load error", async () => {
  mockLoad.mockRejectedValueOnce(new ApiError("offline", 0, "learning_offline"));
  await render();
  await tap("Начать тренировку");
  expect(JSON.stringify(screen.toJSON())).toContain("Нет интернета");
  const retry = button(jest.requireActual("../../i18n/strings").STRINGS.ru["action.tryAgain"]).props.onPress;
  await act(async () => { retry(); retry(); });
  expect(readyCards()).toEqual([
    { stage: "practice", seen: [] },
    { stage: "practice", seen: [] },
    { stage: "practice", seen: ["Example 1"] },
  ]);
  expect(mockCard.exercise.topic).toBe("prepositions");
  expect(JSON.stringify(screen.toJSON())).toContain("Задание 1 из 3");
});

it("both Next taps wait for one pending prefetched card and guests spend quota only on visible cards", async () => {
  const first = { ...card, token: "first", text: "First visible example" };
  const second = { ...card, token: "second", text: "Next visible example" };
  const prefetched = deferExercise();
  mockLoad.mockResolvedValueOnce(first).mockReturnValueOnce(prefetched.promise);
  await render();
  await tap("Начать тренировку");
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect((await loadGuestLimit()).used).toBe(1);

  act(() => mockCard.onChange("of", "of"));
  const submit = button("Проверить").props.onPress;
  mockGrade.mockResolvedValueOnce({ correct: true, correct_answer: "of" });
  await act(async () => { await submit(); });
  const advance = button("Следующее задание").props.onPress;
  await act(async () => { advance(); advance(); });
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(screen.toJSON())).toContain("Задание 2 из 3");
  expect(button("Проверить")).toBeUndefined();
  expect((await loadGuestLimit()).used).toBe(1);

  await act(async () => { prefetched.resolve(second); });
  expect(mockCard.exercise).toEqual(second);
  expect(mockLoad).toHaveBeenCalledTimes(3);
  expect(readyCards()[2].seen).toEqual([first.text, second.text]);
  expect((await loadGuestLimit()).used).toBe(2);

  await act(async () => { advance(); await submit(); });
  expect(mockCard.exercise).toEqual(second);
  expect(mockLoad).toHaveBeenCalledTimes(3);
  expect(mockGrade).toHaveBeenCalledTimes(1);
  expect((await loadGuestLimit()).used).toBe(2);
});

it("surfaces a speculative failure on Next and requests the same round once on retry", async () => {
  const first = { ...card, token: "first", text: "First visible example" };
  mockLoad.mockResolvedValueOnce(first).mockRejectedValueOnce(new ApiError("offline", 0, "learning_offline"));
  await render();
  await tap("Начать тренировку");
  expect(JSON.stringify(screen.toJSON())).not.toContain("Нет интернета");

  await answer(true);
  await tap("Следующее задание");
  expect(JSON.stringify(screen.toJSON())).toContain("Нет интернета");
  expect(JSON.stringify(screen.toJSON())).toContain("Задание 2 из 3");
  expect(mockLoad).toHaveBeenCalledTimes(2);

  await tap(jest.requireActual("../../i18n/strings").STRINGS.ru["action.tryAgain"]);
  expect(JSON.stringify(screen.toJSON())).not.toContain("Нет интернета");
  expect(JSON.stringify(screen.toJSON())).toContain("Задание 2 из 3");
  expect(readyCards().slice(2)).toEqual([
    { stage: "practice", seen: [first.text] },
    { stage: "practice", seen: [first.text, mockCard.exercise.text] },
  ]);
});

it("aborts speculative work on close and rejects a retained answer button callback", async () => {
  const first = { ...card, token: "first", text: "First visible example" };
  const prefetched = deferExercise();
  mockLoad.mockResolvedValueOnce(first).mockReturnValueOnce(prefetched.promise);
  await render();
  await tap("Начать тренировку");
  const signal = mockLoad.mock.calls[1][3];
  act(() => mockCard.onChange("of", "of"));
  const submit = button("Проверить").props.onPress;
  const close = screen.root.findAll((node) => node.props.accessibilityLabel === "Закрыть тренировку"
    && typeof node.props.onPress === "function")[0].props.onPress;
  await act(async () => { close(); submit(); });

  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockGrade).not.toHaveBeenCalled();
  expect(signal.aborted).toBe(true);
  await act(async () => { prefetched.resolve({ ...card, token: "late", text: "Late example" }); });
  expect(mockCard.exercise).toEqual(first);
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect((await loadGuestLimit()).used).toBe(1);
});

it("replaces the prefetched card when the displayed exercise expires", async () => {
  const first = { ...card, token: "first", text: "First visible example" };
  const replacement = { ...card, token: "replacement", text: "Replacement example" };
  const fresh = { ...card, token: "fresh", text: "Fresh next example" };
  const stale = deferExercise();
  mockLoad
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValueOnce(replacement)
    .mockResolvedValueOnce(fresh);
  await render();
  await tap("Начать тренировку");
  const obsoleteSignal = mockLoad.mock.calls[1][3];
  act(() => mockCard.onChange("of", "of"));
  mockGrade.mockRejectedValueOnce(new ApiError("expired", 400, "exercise_expired"));
  await tap("Проверить");
  await tap("Новый пример");

  expect(obsoleteSignal.aborted).toBe(true);
  expect(mockCard.exercise).toEqual(replacement);
  expect(readyCards()[3].seen).toEqual([first.text, replacement.text]);
  await act(async () => { stale.resolve({ ...replacement, token: "stale" }); });
  await answer(true);
  await tap("Следующее задание");
  expect(mockCard.exercise).toEqual(fresh);
});

it("rebuilds the first checkpoint request if the last practice example needs replacement", async () => {
  const practiceCards = [1, 2, 3].map((index) => ({ ...card, token: `p${index}`, text: `Practice example ${index}` }));
  const replacement = { ...card, token: "replacement", text: "Replacement example" };
  const replacementQuiz = { ...card, token: "new-quiz", text: "New checkpoint example" };
  const obsoleteQuiz = deferExercise();
  for (const exercise of practiceCards) mockLoad.mockResolvedValueOnce(exercise);
  mockLoad.mockReturnValueOnce(obsoleteQuiz.promise).mockResolvedValueOnce(replacement).mockResolvedValueOnce(replacementQuiz);

  await render();
  await tap("Начать тренировку");
  for (let index = 0; index < 2; index++) {
    await answer(true);
    await tap("Следующее задание");
  }
  expect(readyCards()[3]).toEqual({ stage: "test", seen: practiceCards.map(({ text }) => text) });
  const obsoleteSignal = mockLoad.mock.calls[3][3];
  act(() => mockCard.onChange("of", "of"));
  mockGrade.mockRejectedValueOnce(new ApiError("expired", 400, "exercise_expired"));
  await tap("Проверить");
  await tap("Новый пример");

  expect(obsoleteSignal.aborted).toBe(true);
  expect(mockCard.exercise).toEqual(replacement);
  expect(readyCards()[5]).toEqual({ stage: "test", seen: [...practiceCards.map(({ text }) => text), replacement.text] });
  expect((await loadGuestLimit()).used).toBe(4);
  await act(async () => { obsoleteQuiz.resolve({ ...replacement, token: "discarded" }); });
  await answer(true);
  await tap("К зачёту");
  expect(mockLoad).toHaveBeenCalledTimes(6);
  await tap("Начать зачёт");
  expect(mockCard.exercise).toEqual(replacementQuiz);
  expect(mockLoad).toHaveBeenCalledTimes(7);
  expect((await loadGuestLimit()).used).toBe(5);
});

it("requires an eligible saved mistake or a topic from text review before loading an exercise", async () => {
  mockTargets.mockReturnValue([]);
  await render();
  expect(JSON.stringify(screen.toJSON())).toContain("Пока нет ошибок для тренировки");
  expect(button("Начать тренировку")).toBeUndefined();
  expect(mockLoad).not.toHaveBeenCalled();
});
