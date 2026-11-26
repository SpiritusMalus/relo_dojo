import { StrictMode } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { useExerciseCheck, type Result } from "../useExerciseCheck";
import { DEFAULT_PROGRESS, recordAnswer, type GradeSignal, type Progress } from "../progress";
import { ApiError, checkInteractive, explain, explainStream, setAuthToken, type Exercise } from "../../services/api";
import { captureMistake } from "../mistakes";

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
  return { ...actual, checkInteractive: jest.fn(), explain: jest.fn(), explainStream: jest.fn() };
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
  setAuthToken(null);
  jest.clearAllMocks();
  mockProgress = { ...DEFAULT_PROGRESS, skill: { articles: 2.5 } };
  mockRecord.mockImplementation((topic: string, right: boolean, grade?: GradeSignal) => {
    mockProgress = recordAnswer(mockProgress, topic, right, new Date(), grade);
    return mockProgress;
  });
});

it.each([true, false])("a late A grade (correct=%s) cannot write B progress, coins or mistakes", async (right) => {
  const memberToken = (id: string) => `header.${btoa(JSON.stringify({ sub: id }))}.signature`;
  setAuthToken(memberToken("A"));
  let resolve!: (value: Result) => void;
  jest.mocked(checkInteractive).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  const renderer = mount();
  act(() => hook.beginAttempt(exercise));
  let pending!: Promise<Result | null>;
  act(() => { pending = hook.check(exercise, "an"); });
  act(() => setAuthToken(memberToken("B")));
  await act(async () => { resolve({ ...correct, correct: right }); expect(await pending).toBeNull(); });
  expect(mockRecord).not.toHaveBeenCalled();
  expect(mockReward).not.toHaveBeenCalled();
  expect(captureMistake).not.toHaveBeenCalled();
  expect(hook.result).toBeNull();
  expect(hook.checking).toBe(false);
  act(() => renderer.unmount());
});

it("a late A explanation cannot appear in B or trigger a fallback request", async () => {
  const token = (id: string) => `header.${btoa(JSON.stringify({ sub: id }))}.signature`;
  setAuthToken(token("A"));
  jest.mocked(checkInteractive).mockResolvedValueOnce({ ...correct, correct: false });
  const renderer = mount();
  await act(async () => { await hook.check(exercise, "an"); });
  let resolve!: (text: string) => void;
  jest.mocked(explainStream).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  let pending!: Promise<void>;
  act(() => { pending = hook.doExplain(exercise, "an"); });
  act(() => setAuthToken(token("B")));
  await act(async () => { resolve("A's private teaching note"); await pending; });
  expect(hook.explained).toBeNull();
  expect(explain).not.toHaveBeenCalled();
  act(() => renderer.unmount());
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

it.each([
  { run: 0, boosted: false, expected: 10 },
  { run: 4, boosted: false, expected: 30 },
  { run: 4, boosted: true, expected: 60 },
])("reports the actual committed answer XP: $expected", async ({ run, boosted, expected }) => {
  mockProgress = { ...mockProgress, xp: 300, currentCorrectRun: run,
    boostUntil: boosted ? new Date(Date.now() + 60_000).toISOString() : "" };
  jest.mocked(checkInteractive).mockResolvedValueOnce(correct);
  const renderer = mount();
  let result: Result | null = null;
  await act(async () => { result = await hook.check(exercise, "a"); });
  expect((result as Result | null)?.xpEarned).toBe(expected);
  expect((result as Result | null)?.hintUsed).toBe(false);
  act(() => renderer.unmount());
});

it("marks a correct hinted answer without claiming unaided evidence or changing XP rules", async () => {
  jest.mocked(checkInteractive).mockResolvedValueOnce(correct);
  const renderer = mount();
  act(() => { hook.beginAttempt(exercise); hook.markHintUsed(); });
  let result: Result | null = null;
  await act(async () => { result = await hook.check(exercise, "a"); });
  expect(result).toMatchObject({ correct: true, hintUsed: true, xpEarned: 10 });
  expect(mockProgress.course.history.articles[0].c).toBe(false);
  act(() => renderer.unmount());
});

it("explains the full four-option task with the same safe context on stream failure", async () => {
  const card = { ...exercise, type: "odd-one-out" as const, topic: "word order",
    text: "Tap the one that doesn't belong", instruction: "Choose the sentence without inversion.",
    options: ["Always we arrive early.", "Seldom do we arrive early.", "Never have we arrived late.", "Rarely did we miss a train."],
    answer: "hidden-key-must-not-be-sent", token: "sealed-private-token" };
  const renderer = mount();
  jest.mocked(checkInteractive).mockResolvedValueOnce({ correct: false, correct_answer: card.options[0] });
  jest.mocked(explainStream).mockRejectedValueOnce(new Error("stream unavailable"));
  jest.mocked(explain).mockResolvedValueOnce({ explanation: "All choices were available for comparison.", tip: "" });
  await act(async () => { await hook.check(card, card.options[1]); });
  await act(async () => { await hook.doExplain(card, card.options[1]); });
  const [context, key, response] = jest.mocked(explainStream).mock.calls[0];
  expect(JSON.parse(context)).toMatchObject({ type: card.type, topic: card.topic, instruction: card.instruction, options: card.options });
  expect(context).not.toContain(card.token);
  expect(context).not.toContain(card.answer);
  expect(explain).toHaveBeenCalledWith(context, key, response);
  act(() => renderer.unmount());
});

it("keeps an explanation outage separate from the grade and allows a fresh explanation retry", async () => {
  jest.mocked(checkInteractive).mockResolvedValueOnce({ ...correct, correct: false });
  jest.mocked(explainStream).mockRejectedValueOnce(new Error("stream failed"));
  jest.mocked(explain).mockRejectedValueOnce(new Error("explanation unavailable"));
  const renderer = mount();
  await act(async () => { await hook.check(exercise, "an"); });
  await act(async () => { await hook.doExplain(exercise, "an"); });
  expect(hook.result?.correct).toBe(false);
  expect(hook.error).toBeNull();
  expect(hook.explainError).toBe("explanation unavailable");
  expect(hook.explained).toBeNull();
  jest.mocked(explainStream).mockResolvedValueOnce("Use 'a' before a consonant sound.");
  await act(async () => { await hook.doExplain(exercise, "an"); });
  expect(hook.explainError).toBeNull();
  expect(hook.explained?.explanation).toMatch(/consonant/);
  act(() => renderer.unmount());
});

it("explains the visible response that was actually submitted, even after the input changes", async () => {
  jest.mocked(checkInteractive).mockResolvedValueOnce({ ...correct, correct: false });
  jest.mocked(explainStream).mockResolvedValueOnce("Use 'a' before a consonant sound.");
  const renderer = mount();
  await act(async () => { await hook.check(exercise, "an", undefined, "She is an doctor."); });
  await act(async () => { await hook.doExplain(exercise, "edited response"); });
  expect(jest.mocked(explainStream).mock.calls[0][2]).toBe("She is an doctor.");
  act(() => renderer.unmount());
});


it("sends the original answer on an ambiguous retry and retains the original feedback snapshot", async () => {
  jest.mocked(checkInteractive).mockRejectedValueOnce(new Error("lost response"));
  jest.mocked(checkInteractive).mockRejectedValueOnce(new ApiError("rate limited", 429));
  jest.mocked(checkInteractive).mockResolvedValueOnce({ ...correct, correct: false });
  const renderer = mount();
  await act(async () => { expect(await hook.check(exercise, "an", undefined, "She is an doctor.")).toBeNull(); });
  expect(hook.submissionLocked).toBe(true);
  await act(async () => { expect(await hook.check(exercise, "a", undefined, "She is a doctor.")).toBeNull(); });
  expect(hook.submissionLocked).toBe(true); // the rate limit does not settle the first request
  await act(async () => { await hook.check(exercise, "a", undefined, "She is a doctor."); });
  expect(jest.mocked(checkInteractive).mock.calls.map(([, answer]) => answer)).toEqual(["an", "an", "an"]);
  expect(hook.result).toMatchObject({ correct: false, submittedResponse: "She is an doctor." });
  expect(mockRecord).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});

it("permits editing after the server explicitly rejects the input without grading", async () => {
  jest.mocked(checkInteractive).mockRejectedValueOnce(new ApiError("empty answer", 422));
  jest.mocked(checkInteractive).mockResolvedValueOnce(correct);
  const renderer = mount();
  await act(async () => { await hook.check(exercise, ""); });
  expect(hook.submissionLocked).toBe(false);
  await act(async () => { await hook.check(exercise, "a"); });
  expect(jest.mocked(checkInteractive).mock.calls.map(([, answer]) => answer)).toEqual(["", "a"]);
  expect(hook.result?.correct).toBe(true);
  act(() => renderer.unmount());
});
