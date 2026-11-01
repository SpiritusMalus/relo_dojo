import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError, getExercise, request, setAuthToken, type Exercise } from "../api";
import { captureAccountScope } from "../../store/accountScope";
import { createLearningSessionTracker, recoverLearningSessions, type LearningSession } from "../learningSession";

jest.mock("../api", () => ({ ...jest.requireActual("../api"), request: jest.fn(), getExercise: jest.fn() }));
const member = (id: string) => `header.${Buffer.from(JSON.stringify({ sub: id })).toString("base64url")}.signature`;
const params = { topic: "articles", level: "A2", type: "multiple-choice", context: "" };
const session = (): LearningSession => ({ id: "server-session", item_count: 10, graded_count: 0,
  completed: false, reward_day: null, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
let server: LearningSession;
let serial = 0;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  setAuthToken(member("a"));
  server = session();
  serial = 0;
  jest.mocked(request).mockImplementation(async (path, _body, method) => {
    if (path.endsWith("/complete")) return { session: { ...server, graded_count: 10, completed: true, reward_day: "2026-11-01" }, dojo: null } as any;
    return { ...server } as any;
  });
  jest.mocked(getExercise).mockImplementation(async () => ({ token: `issued-${serial++}`, review_token: "review" } as Exercise));
});
afterEach(() => setAuthToken(null));

async function answerTen(tracker: ReturnType<typeof createLearningSessionTracker>) {
  for (let n = 0; n < 10; n++) {
    const exercise = await tracker.fetch(params);
    tracker.recordGraded(exercise);
  }
}

test("starts once, binds actual graded ordinals and completes once under double Finish", async () => {
  const tracker = createLearningSessionTracker(captureAccountScope(), true);
  await answerTen(tracker);
  expect(jest.mocked(request).mock.calls.filter(([path]) => path === "/dojo/sessions")).toHaveLength(1);
  expect(jest.mocked(getExercise).mock.calls.map(([p]) => p?.learning_item)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const [first, second] = await Promise.all([tracker.complete(), tracker.complete()]);
  expect(first?.session.completed).toBe(true);
  expect(second).toEqual(first);
  expect(jest.mocked(request).mock.calls.filter(([path]) => path.endsWith("/complete"))).toHaveLength(1);
});

test("swerve and abandoned cards reuse an ordinal; duplicate grading cannot skip ahead", async () => {
  const tracker = createLearningSessionTracker(captureAccountScope(), true);
  const abandoned = await tracker.fetch(params);
  const replacement = await tracker.fetch({ ...params, topic: "word order" });
  expect(jest.mocked(getExercise).mock.calls.map(([p]) => p?.learning_item)).toEqual([0, 0]);
  tracker.recordGraded(replacement);
  tracker.recordGraded(replacement);
  tracker.recordGraded(abandoned);
  await tracker.fetch(params);
  expect(jest.mocked(getExercise).mock.calls[2][0]?.learning_item).toBe(1);
  expect(await tracker.complete()).toBeNull();
  expect(jest.mocked(request).mock.calls.some(([path]) => path.endsWith("/complete"))).toBe(false);
});

test("nine graded items and arbitrary unbound exercises cannot earn a day", async () => {
  const tracker = createLearningSessionTracker(captureAccountScope(), true);
  for (let n = 0; n < 9; n++) tracker.recordGraded(await tracker.fetch(params));
  tracker.recordGraded({ token: "not-issued-by-this-session" } as Exercise);
  expect(await tracker.complete()).toBeNull();
});

test("feature-off preserves ordinary practice and cannot report permanent rewards", async () => {
  jest.mocked(request).mockRejectedValueOnce(new ApiError("Unavailable", 404));
  const tracker = createLearningSessionTracker(captureAccountScope(), true);
  const exercise = await tracker.fetch(params);
  tracker.recordGraded(exercise);
  expect(getExercise).toHaveBeenCalledWith(params);
  expect(tracker.hasBoundSession()).toBe(false);
  expect(await tracker.complete()).toBeNull();
});

test("guest practice never calls dojo or writes a recovery descriptor", async () => {
  setAuthToken(null);
  const tracker = createLearningSessionTracker(captureAccountScope(), false);
  const exercise = await tracker.fetch(params);
  tracker.recordGraded(exercise);
  expect(request).not.toHaveBeenCalled();
  expect(getExercise).toHaveBeenCalledWith(params);
  expect(await tracker.complete()).toBeNull();
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
});

test("an uncertain completion resolves via GET without another grant request", async () => {
  const tracker = createLearningSessionTracker(captureAccountScope(), true);
  await answerTen(tracker);
  jest.mocked(request).mockImplementation(async (path) => {
    if (path.endsWith("/complete")) throw new Error("response lost after commit");
    return { ...server, graded_count: 10, completed: true, reward_day: "2026-11-01" } as any;
  });
  const result = await tracker.complete();
  expect(result?.session.completed).toBe(true);
  expect(jest.mocked(request).mock.calls.filter(([path]) => path.endsWith("/complete"))).toHaveLength(1);
  expect(jest.mocked(request).mock.calls.some(([path, , method]) => path === "/dojo/sessions/server-session" && method === "GET")).toBe(true);
});

test("cold foreground recovery uses the server count, never a local count, and stays owner-scoped", async () => {
  const scope = captureAccountScope();
  const tracker = createLearningSessionTracker(scope, true);
  await tracker.fetch(params); // Persisted descriptor, no completed lesson locally.
  server.graded_count = 10; // Last grade reached the API before an interrupted UI.
  const receipts = await recoverLearningSessions(scope);
  expect(receipts).toHaveLength(1);
  expect(receipts[0].session.completed).toBe(true);
  const keys = await AsyncStorage.getAllKeys();
  expect(keys).toEqual(["relo_dojo/learning-sessions/v1/user%3Aa"]);
  expect(keys.join()).not.toContain(member("a"));
  setAuthToken(member("b"));
  expect(await recoverLearningSessions(scope)).toEqual([]);
  const calls = jest.mocked(request).mock.calls.length;
  expect(await tracker.complete()).toBeNull();
  expect(jest.mocked(request).mock.calls).toHaveLength(calls);
});

test("foreground recovery abandons a partial lesson instead of completing its local count", async () => {
  const scope = captureAccountScope();
  const tracker = createLearningSessionTracker(scope, true);
  await tracker.fetch(params);
  server.graded_count = 9;
  expect(await recoverLearningSessions(scope)).toEqual([]);
  expect(jest.mocked(request).mock.calls.some(([path]) => path.endsWith("/complete"))).toBe(false);
  expect(jest.mocked(request).mock.calls.some(([path]) => path.endsWith("/abandon"))).toBe(true);
});

test("repeated entry/exit releases each partial session before the next lesson", async () => {
  for (let n = 0; n < 6; n++) {
    const tracker = createLearningSessionTracker(captureAccountScope(), true);
    tracker.recordGraded(await tracker.fetch(params));
    await tracker.dispose();
  }
  expect(jest.mocked(request).mock.calls.filter(([path]) => path.endsWith("/abandon"))).toHaveLength(6);
  expect(await AsyncStorage.getItem("relo_dojo/learning-sessions/v1/user%3Aa")).toBe("[]");
});

test("ten local grades are not abandoned on exit and remain recoverable", async () => {
  const tracker = createLearningSessionTracker(captureAccountScope(), true);
  await answerTen(tracker);
  await tracker.dispose();
  expect(jest.mocked(request).mock.calls.some(([path]) => path.endsWith("/abandon"))).toBe(false);
  server.graded_count = 10;
  expect(await recoverLearningSessions(captureAccountScope())).toHaveLength(1);
});

test("flag-off ordinary issuance cannot become a server learning receipt", async () => {
  jest.mocked(getExercise).mockResolvedValueOnce({ token: "ordinary-no-review-binding" } as Exercise);
  const tracker = createLearningSessionTracker(captureAccountScope(), true);
  tracker.recordGraded(await tracker.fetch(params));
  expect(tracker.hasBoundSession()).toBe(false);
  expect(await tracker.complete()).toBeNull();
});

test("an expired binding cannot trap the learner in an endless retry or mint a replacement reward", async () => {
  jest.mocked(getExercise).mockRejectedValueOnce(new ApiError("Expired", 410, "learning_session_expired"));
  const tracker = createLearningSessionTracker(captureAccountScope(), true);
  const exercise = await tracker.fetch(params);
  tracker.recordGraded(exercise);
  expect(getExercise).toHaveBeenCalledTimes(2);
  expect(jest.mocked(getExercise).mock.calls[1][0]).toEqual(params);
  expect(tracker.hasBoundSession()).toBe(false);
  expect(await tracker.complete()).toBeNull();
  expect(jest.mocked(request).mock.calls.filter(([path]) => path === "/dojo/sessions")).toHaveLength(1);
});

test("a delayed A start cannot request an exercise or create evidence with B's bearer", async () => {
  const start = deferred<LearningSession>();
  jest.mocked(request).mockImplementationOnce(() => start.promise as Promise<any>);
  const tracker = createLearningSessionTracker(captureAccountScope(), true);
  const old = tracker.fetch(params);
  for (let i = 0; i < 30 && !jest.mocked(request).mock.calls.length; i++) await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(1);
  setAuthToken(member("b"));
  start.resolve(server);
  await expect(old).rejects.toMatchObject({ code: "session_changed" });
  expect(getExercise).not.toHaveBeenCalled();
  expect(await tracker.complete()).toBeNull();
});

test("leaving during session startup cannot launch paid exercise generation later", async () => {
  const start = deferred<LearningSession>();
  jest.mocked(request).mockImplementationOnce(() => start.promise as Promise<any>);
  const tracker = createLearningSessionTracker(captureAccountScope(), true);
  const old = tracker.fetch(params);
  for (let i = 0; i < 30 && !jest.mocked(request).mock.calls.length; i++) await Promise.resolve();
  tracker.dispose();
  start.resolve(server);
  await expect(old).rejects.toMatchObject({ code: "queue_disposed" });
  expect(getExercise).not.toHaveBeenCalled();
});
