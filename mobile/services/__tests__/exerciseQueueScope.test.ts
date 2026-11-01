import { createExerciseQueue, type FetchParams } from "../exerciseQueue";
import type { Exercise } from "../api";
import { setAccountToken } from "../../store/accountScope";

const params: FetchParams = { topic: "articles", level: "A2", type: "multiple-choice", context: "A context" };
const exercise: Exercise = { ...params, prompt: "", text: "She is ___ doctor.", options: ["a", "an"],
  tiles: [], tokens: [], left: [], right: [], blankOptions: [], token: "sealed", type: "multiple-choice" };
const deferred = () => {
  let resolve!: (value: Exercise) => void;
  const promise = new Promise<Exercise>((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => setAccountToken("queue-session-a"));
afterEach(() => { setAccountToken(null); jest.useRealTimers(); });

it("settles a cold A next immediately on B login even when the provider never settles", async () => {
  const old = deferred();
  const fetch = jest.fn(() => old.promise);
  const queue = createExerciseQueue({ selectParams: () => params, fetch });
  const next = queue.next().catch((error) => error);
  setAccountToken("queue-session-b");
  expect(await next).toMatchObject({ code: "session_changed" });
  old.resolve(exercise);
  await flush();
  expect(queue.readyCount()).toBe(0);
  queue.prefetch();
  queue.clear();
  await expect(queue.next()).rejects.toMatchObject({ code: "session_changed" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("clears an A retry timer and never starts a paid follow-up under B", async () => {
  jest.useFakeTimers();
  const fetch = jest.fn(async () => { throw new Error("session_changed"); });
  const queue = createExerciseQueue({ selectParams: () => params, fetch, size: 1, retryDelayMs: 1000 });
  queue.prefetch();
  await flush();
  expect(jest.getTimerCount()).toBe(1);
  setAccountToken("queue-session-b");
  jest.advanceTimersByTime(5000);
  await flush();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(queue.readyCount()).toBe(0);
});

it("wakes buffered-prefetch waiters with a terminal session error without borrowing B", async () => {
  const old = deferred();
  const fetch = jest.fn(() => old.promise);
  const queue = createExerciseQueue({ selectParams: () => params, fetch, size: 1 });
  queue.prefetch();
  const waiting = queue.next().catch((error) => error);
  setAccountToken("queue-session-b");
  expect(await waiting).toMatchObject({ code: "session_changed" });
  expect(fetch).toHaveBeenCalledTimes(1);
  old.resolve(exercise);
  await flush();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("discards ready A cards and never revives that queue when A later signs in again", async () => {
  const fetch = jest.fn(async () => exercise);
  const queue = createExerciseQueue({ selectParams: () => params, fetch, size: 1 });
  queue.prefetch();
  await flush();
  expect(queue.readyCount()).toBe(1);
  setAccountToken("queue-session-b");
  expect(queue.readyCount()).toBe(0);
  setAccountToken("queue-session-a");
  queue.prefetch();
  await expect(queue.next()).rejects.toMatchObject({ code: "session_changed" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("dispose ends pending work and retries without making adaptive clear terminal", async () => {
  const old = deferred();
  const fetch = jest.fn(() => old.promise);
  const queue = createExerciseQueue({ selectParams: () => params, fetch, size: 1 });
  const waiting = queue.next().catch((error) => error);
  queue.dispose();
  queue.dispose(); // cleanup is safe if both scope and component lifetimes end
  expect(await waiting).toMatchObject({ code: "queue_disposed" });
  old.resolve(exercise);
  await flush();
  queue.clear();
  queue.prefetch();
  await expect(queue.next()).rejects.toMatchObject({ code: "queue_disposed" });
  expect(queue.readyCount()).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(1);
});
