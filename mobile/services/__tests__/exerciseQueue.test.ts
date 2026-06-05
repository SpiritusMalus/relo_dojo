import { createExerciseQueue, type FetchParams } from "../exerciseQueue";
import type { Exercise } from "../api";

const PARAMS: FetchParams = { topic: "articles", level: "B1", type: "multiple-choice", context: "" };

function fakeExercise(id: number): Exercise {
  return {
    type: "multiple-choice",
    topic: "articles",
    text: `q${id}`,
    prompt: "",
    options: [],
    tiles: [],
    tokens: [],
    left: [],
    right: [],
    blankOptions: [],
    token: null,
  };
}

// A controllable fetcher: each call returns a promise we resolve by hand, so we can assert timing.
function deferredFetcher() {
  const resolvers: Array<() => void> = [];
  let calls = 0;
  const fetch = (_p: FetchParams) =>
    new Promise<Exercise>((resolve) => {
      const id = calls++;
      resolvers.push(() => resolve(fakeExercise(id)));
    });
  return {
    fetch,
    get calls() {
      return calls;
    },
    resolveAll: () => resolvers.splice(0).forEach((r) => r()),
  };
}

const flush = () => new Promise<void>((r) => setTimeout(() => r(), 0));

describe("createExerciseQueue", () => {
  it("prefetches up to `size` cards in the background", async () => {
    const d = deferredFetcher();
    const q = createExerciseQueue({ selectParams: () => PARAMS, fetch: d.fetch, size: 2 });
    q.prefetch();
    expect(d.calls).toBe(2); // two in flight, capped at size
    d.resolveAll();
    await flush();
    expect(q.readyCount()).toBe(2);
  });

  it("serves a buffered card instantly and refills", async () => {
    const d = deferredFetcher();
    const q = createExerciseQueue({ selectParams: () => PARAMS, fetch: d.fetch, size: 2 });
    q.prefetch();
    d.resolveAll();
    await flush();
    expect(q.readyCount()).toBe(2);

    const ex = await q.next();
    expect(ex.type).toBe("multiple-choice");
    expect(q.readyCount()).toBe(1); // one served, one still buffered
    // the refill fetch is now in flight; resolve it and confirm the buffer is back to size
    d.resolveAll();
    await flush();
    expect(q.readyCount()).toBe(2);
  });

  it("fetches on demand when the buffer is empty (cold start)", async () => {
    const d = deferredFetcher();
    const q = createExerciseQueue({ selectParams: () => PARAMS, fetch: d.fetch, size: 1 });
    const p = q.next(); // nothing buffered yet
    d.resolveAll();
    const ex = await p;
    expect(ex).toBeTruthy();
  });

  it("clear() discards in-flight results from the stale generation", async () => {
    const d = deferredFetcher();
    const q = createExerciseQueue({ selectParams: () => PARAMS, fetch: d.fetch, size: 2 });
    q.prefetch(); // 2 in flight
    q.clear(); // bump generation before they resolve
    d.resolveAll();
    await flush();
    expect(q.readyCount()).toBe(0); // stragglers dropped
  });

  it("propagates errors from next() when nothing is buffered", async () => {
    const q = createExerciseQueue({
      selectParams: () => PARAMS,
      fetch: () => Promise.reject(new Error("boom")),
      size: 1,
    });
    await expect(q.next()).rejects.toThrow("boom");
  });

  it("swallows background prefetch errors (no unhandled rejection)", async () => {
    const q = createExerciseQueue({
      selectParams: () => PARAMS,
      fetch: () => Promise.reject(new Error("boom")),
      size: 2,
    });
    q.prefetch();
    await flush();
    expect(q.readyCount()).toBe(0); // failed fetches simply leave the buffer empty
  });
});
