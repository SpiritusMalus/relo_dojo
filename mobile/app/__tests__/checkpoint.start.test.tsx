import { ActivityIndicator } from "react-native";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import Button from "../../components/ui/Button";
import type { Lang } from "../../i18n/strings";
import type { Exercise } from "../../services/api";
import { ThemeProvider } from "../../theme/theme";
import CheckpointScreen from "../checkpoint";

const mockNext = jest.fn<Promise<Exercise>, []>();
const mockClear = jest.fn();
const mockDispose = jest.fn();
const mockPrefetch = jest.fn();
const mockBegin = jest.fn();
const mockBack = jest.fn();
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
  const reset = jest.fn();
  return { useExerciseCheck: () => ({ beginAttempt: mockBegin, checking: false, reset }) };
});
jest.mock("../../services/exerciseQueue", () => ({
  createExerciseQueue: () => ({ next: mockNext, clear: mockClear, dispose: mockDispose, prefetch: mockPrefetch }),
}));
jest.mock("../../components/ui/Sensei", () => () => null);
jest.mock("../../components/ExerciseCard", () => () => null);

const firstExercise: Exercise = {
  type: "build-the-sentence", topic: "word order", level: "A1",
  text: "", prompt: "Ты проверяешь логи?", tiles: ["you", "Do", "the", "check", "logs"],
  options: [], tokens: [], left: [], right: [], blankOptions: [], token: "first",
};

let screen: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "ru";
});
afterEach(() => act(() => screen.unmount()));

function button(label: string) {
  return screen.root.findAll((node) => node.type === Button && node.props.label === label)[0];
}

async function renderScreen() {
  await act(async () => {
    screen = TestRenderer.create(<ThemeProvider><CheckpointScreen /></ThemeProvider>);
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
