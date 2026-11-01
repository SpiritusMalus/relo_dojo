import { StrictMode } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { useExerciseCheck, type Result } from "../useExerciseCheck";
import { DEFAULT_PROGRESS, recordAnswer, type GradeSignal, type Progress } from "../progress";
import { checkInteractive, type Exercise } from "../../services/api";

let mockProgress: Progress = DEFAULT_PROGRESS;
const mockRecord = jest.fn();
const mockReward = jest.fn();
jest.mock("../progress", () => {
  const actual = jest.requireActual("../progress");
  return { ...actual, useProgress: () => ({ progress: mockProgress, recordAnswer: mockRecord }) };
});
jest.mock("../wallet", () => ({ useWallet: () => ({ applyCheckReward: mockReward }) }));
jest.mock("../mistakes", () => ({ captureMistake: jest.fn(async () => {}) }));
jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return { ...actual, checkInteractive: jest.fn() };
});

const exercise: Exercise = {
  type: "multiple-choice", topic: "articles", level: "B1", text: "She is ___ doctor.", prompt: "",
  options: ["a", "an"], tiles: [], tokens: [], left: [], right: [], blankOptions: [], token: "sealed-one",
};
const correct: Result = { correct: true, correct_answer: "a", score: 1, coins: 12 };
let hook!: ReturnType<typeof useExerciseCheck>;
function Harness() { hook = useExerciseCheck(); return null; }

function mount(): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<StrictMode><Harness /></StrictMode>); });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProgress = { ...DEFAULT_PROGRESS, skill: { articles: 2.5 } };
  mockRecord.mockImplementation((topic: string, right: boolean, grade?: GradeSignal) => {
    mockProgress = recordAnswer(mockProgress, topic, right, new Date(), grade);
    return mockProgress;
  });
});

it("double-submit in StrictMode grades and rewards once and returns an updated selection snapshot", async () => {
  let resolve!: (value: Result) => void;
  jest.mocked(checkInteractive).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  const renderer = mount();
  act(() => hook.beginAttempt(exercise));
  let first!: Promise<Result | null>;
  let duplicate!: Promise<Result | null>;
  act(() => {
    first = hook.check(exercise, "a");
    duplicate = hook.check(exercise, "a");
  });
  expect(checkInteractive).toHaveBeenCalledTimes(1);
  expect(await duplicate).toBeNull();
  let result: Result | null = null;
  await act(async () => { resolve(correct); result = await first; });
  expect((result as Result | null)?.progressAfter?.topics.articles.attempts).toBe(1);
  expect(mockRecord).toHaveBeenCalledTimes(1);
  expect(mockReward).toHaveBeenCalledTimes(1);
  await act(async () => { expect(await hook.check(exercise, "a")).toBeNull(); });
  expect(mockRecord).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});

it("retries a failed check without charging the network wait as learner effort", async () => {
  let now = 0;
  const time = jest.spyOn(Date, "now").mockImplementation(() => now);
  let reject!: (reason: Error) => void;
  jest.mocked(checkInteractive).mockImplementationOnce(() => new Promise((_r, fail) => { reject = fail; }));
  const renderer = mount();
  act(() => hook.beginAttempt(exercise));
  now = 5000;
  let first!: Promise<Result | null>;
  act(() => { first = hook.check(exercise, "a"); });
  now = 95_000;
  await act(async () => { reject(new Error("offline")); expect(await first).toBeNull(); });
  expect(mockRecord).not.toHaveBeenCalled();
  now = 100_000;
  jest.mocked(checkInteractive).mockResolvedValueOnce(correct);
  await act(async () => { await hook.check(exercise, "a"); });
  expect(mockRecord).toHaveBeenCalledTimes(1);
  expect(mockRecord.mock.calls[0][2].elapsedMs).toBe(10_000);
  act(() => renderer.unmount());
  time.mockRestore();
});

it("a response for a reset card cannot update progress or reward the next presentation", async () => {
  let resolve!: (value: Result) => void;
  jest.mocked(checkInteractive).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  const renderer = mount();
  act(() => hook.beginAttempt(exercise));
  let old!: Promise<Result | null>;
  act(() => { old = hook.check(exercise, "a"); });
  act(() => { hook.reset(); hook.beginAttempt({ ...exercise, token: "sealed-two" }); });
  await act(async () => { resolve(correct); expect(await old).toBeNull(); });
  expect(mockRecord).not.toHaveBeenCalled();
  expect(mockReward).not.toHaveBeenCalled();
  expect(hook.checking).toBe(false);
  act(() => renderer.unmount());
});

it("records rule assistance and the difficulty actually served, independent of the current model", async () => {
  const renderer = mount();
  jest.mocked(checkInteractive).mockResolvedValueOnce(correct);
  act(() => { hook.beginAttempt({ ...exercise, level: "A1" }); hook.markHintUsed(); });
  await act(async () => { await hook.check({ ...exercise, level: "A1" }, "a"); });
  expect(mockRecord.mock.calls[0][2]).toMatchObject({ difficulty: 0.5, hintUsed: true });
  expect(mockProgress.course.history.articles[0].c).toBe(false);
  act(() => renderer.unmount());
});
