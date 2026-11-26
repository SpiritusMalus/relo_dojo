import { ActivityIndicator } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import Button from "../../components/ui/Button";
import type { Lang } from "../../i18n/strings";
import type { Exercise } from "../../services/api";
import type { ExerciseProps } from "../../components/types";
import type { FetchParams, QueueDeps } from "../../services/exerciseQueue";
import { beltByIndex, ThemeProvider } from "../../theme/theme";
import CheckpointScreen from "../checkpoint";
import BeltExamScreen from "../belt-exam";

const mockNext = jest.fn<Promise<Exercise>, []>();
const mockClear = jest.fn();
const mockDispose = jest.fn();
const mockPrefetch = jest.fn();
const mockBegin = jest.fn();
const mockBack = jest.fn();
const mockSelectParams = jest.fn<FetchParams, []>();
let mockCard: ExerciseProps;
let mockSelected: { topic: string; type: string };
let mockLanguage: Lang;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ topic: "word order" }),
  useRouter: () => ({ back: mockBack, canGoBack: () => true, replace: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../store/i18n", () => {
  const { STRINGS } = jest.requireActual("../../i18n/strings");
  return { useI18n: () => ({ lang: mockLanguage, t: (key: string) => STRINGS[mockLanguage][key] }) };
});
jest.mock("../../store/progress", () => {
  const { DEFAULT_PROGRESS } = jest.requireActual("../../store/progress");
  const marks = Array.from({ length: 8 }, () => ({ c: true, f: "build-the-sentence" }));
  const progress = { ...DEFAULT_PROGRESS, course: { mastered: [], history: { "word order": marks } } };
  return { useProgress: () => ({ progress, masterUnit: jest.fn() }) };
});
jest.mock("../../store/useExerciseCheck", () => {
  const React = require("react");
  const reset = jest.fn();
  return { useExerciseCheck: () => {
    const [result, setResult] = React.useState(null);
    return { beginAttempt: mockBegin, checking: false, result, reset,
      check: async () => {
        const grade = { correct: true, correct_answer: "Do you check the logs?" };
        setResult(grade);
        return grade;
      },
    };
  } };
});
jest.mock("../../store/exam", () => ({
  ...jest.requireActual("../../store/exam"),
  examOffer: () => ({ target: 1, confirm: false }),
}));
jest.mock("../../store/adaptive", () => ({
  ...jest.requireActual("../../store/adaptive"),
  selectNext: () => mockSelected,
}));
jest.mock("../../services/exerciseQueue", () => ({
  createExerciseQueue: ({ selectParams }: QueueDeps) => {
    mockSelectParams.mockImplementation(selectParams);
    return { next: mockNext, clear: mockClear, dispose: mockDispose, prefetch: mockPrefetch };
  },
}));
jest.mock("../../components/ui/Sensei", () => () => null);
jest.mock("../../components/ExerciseCard", () => (props: ExerciseProps) => { mockCard = props; return null; });

const firstExercise: Exercise = {
  type: "build-the-sentence", topic: "word order", level: "A1",
  text: "", prompt: "Ты проверяешь логи?", tiles: ["you", "Do", "the", "check", "logs"],
  options: [], tokens: [], left: [], right: [], blankOptions: [], token: "first",
};

let screen: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "ru";
  mockSelected = { topic: "word order", type: "listen-and-answer" };
});
afterEach(() => act(() => screen.unmount()));

function button(label: string) {
  return screen.root.findAll((node) => node.type === Button && node.props.label === label)[0];
}

async function renderScreen(Screen = CheckpointScreen) {
  await act(async () => {
    screen = TestRenderer.create(<ThemeProvider><Screen /></ThemeProvider>);
  });
}

function deferExercise() {
  let resolve!: (exercise: Exercise) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Exercise>((accept, fail) => { resolve = accept; reject = fail; });
  mockNext.mockReturnValueOnce(promise);
  return { resolve, reject };
}

it("starts a single request for ten immediate taps and shows the Russian loading state", async () => {
  const first = deferExercise();
  await renderScreen();
  const start = button("Начать зачёт").props.onPress;
  act(() => {
    for (let tap = 0; tap < 10; tap++) start();
  });
  expect(mockNext).toHaveBeenCalledTimes(1);
  const loading = button("Готовим первое задание…");
  expect(loading.props.disabled).toBe(true);
  expect(loading.props.left.type).toBe(ActivityIndicator);

  await act(async () => { first.resolve(firstExercise); });
  expect(button("Готовим первое задание…")).toBeUndefined();
  expect(mockBegin).toHaveBeenCalledWith(firstExercise);
  expect(mockBegin).toHaveBeenCalledTimes(1);
  act(() => start());
  expect(mockNext).toHaveBeenCalledTimes(1);
});

it("shows a localized load failure and permits one fresh retry", async () => {
  mockLanguage = "en";
  const first = deferExercise();
  await renderScreen();
  act(() => button("Start the checkpoint").props.onPress());
  expect(button("Preparing the first exercise…").props.disabled).toBe(true);

  await act(async () => { first.reject(new Error("Network unavailable")); });
  expect(JSON.stringify(screen.toJSON())).toContain("Couldn't prepare the exercise");
  const second = deferExercise();
  const retry = button("Try again").props.onPress;
  act(() => { retry(); retry(); });
  expect(mockNext).toHaveBeenCalledTimes(2);
  expect(button("Preparing the first exercise…").props.disabled).toBe(true);
  await act(async () => { second.resolve(firstExercise); });
  expect(mockBegin).toHaveBeenCalledWith(firstExercise);
});

it("ignores an exercise response delivered after closing the intro", async () => {
  const first = deferExercise();
  await renderScreen();
  act(() => button("Начать зачёт").props.onPress());
  const close = screen.root.findAll((node) =>
    node.props.accessibilityLabel === "Закрыть" && typeof node.props.onPress === "function")[0];
  expect(close).toBeDefined();
  act(() => {
    close!.props.onPress();
    close!.props.onPress();
  });
  expect(mockBack).toHaveBeenCalledTimes(1);
  await act(async () => { first.resolve(firstExercise); });
  expect(mockBegin).not.toHaveBeenCalled();
});

it("requests strict word-order formats and leaves feedback visible until Continue", async () => {
  jest.useFakeTimers({ doNotFake: ["setImmediate", "clearImmediate", "nextTick", "queueMicrotask"] });
  try {
    const first = deferExercise();
    await renderScreen();
    const requested = mockSelectParams();
    expect(requested).toMatchObject({ assessment: true, topic: "word order", type: "build-the-sentence" });
    act(() => button("Начать зачёт").props.onPress());
    await act(async () => { first.resolve(firstExercise); });
    act(() => mockCard.onChange("Do you check the logs?", "Do you check the logs?"));
    await act(async () => { await button("Проверить").props.onPress(); });
    act(() => jest.advanceTimersByTime(10_000));
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockCard.locked).toBe(true);
    expect(mockCard.feedback?.correct).toBe(true);
    expect(mockSelectParams()).toMatchObject({ level: requested.level, type: "multiple-blanks" });

    const second = deferExercise();
    const advance = button("Дальше").props.onPress;
    act(() => { advance(); advance(); });
    expect(mockNext).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(firstExercise); });
  } finally {
    jest.useRealTimers();
  }
});

it("guards belt exam start and retry, asking only for the target belt's exact format and level", async () => {
  mockLanguage = "en";
  const first = deferExercise();
  await renderScreen(BeltExamScreen);
  expect(mockSelectParams()).toMatchObject({ assessment: true, topic: "word order", type: "build-the-sentence" });
  const start = button("Step onto the mat").props.onPress;
  act(() => { for (let tap = 0; tap < 10; tap++) start(); });
  expect(mockNext).toHaveBeenCalledTimes(1);
  expect(button("Preparing the first exercise…").props.disabled).toBe(true);
  await act(async () => { first.reject(new Error("Network unavailable")); });
  const second = deferExercise();
  act(() => { button("Try again").props.onPress(); });
  await act(async () => { second.resolve(firstExercise); });
  expect(mockBegin).toHaveBeenCalledWith(firstExercise);
  expect(mockNext).toHaveBeenCalledTimes(2);
});

it.each([
  ["word order", "tap-the-error", "build-the-sentence"],
  ["word order", "odd-one-out", "build-the-sentence"],
  ["punctuation", "build-the-sentence", "tap-the-error"],
  ["punctuation", "transform-the-sentence", "tap-the-error"],
])("keeps the strict belt request compatible for %s / %s", async (topic, type, compatible) => {
  mockSelected = { topic, type };
  await renderScreen(BeltExamScreen);
  const requested = mockSelectParams();
  expect(requested).toMatchObject({ assessment: true, topic, level: beltByIndex(1).cefr, type: compatible });
  mockSelected = { topic: "articles", type: "multiple-choice" };
  expect(mockSelectParams()).toEqual(requested);
});
