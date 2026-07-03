// Pre-generation buffer for exercises (framework-agnostic → unit-testable).
//
// Each exercise is a live LLM call (slow), so we keep a few generated ahead: while the learner
// solves the current card, the next ones are fetched in the background and served instantly on
// "Next". Selection params are resolved lazily (at fetch time), so each prefetched card uses the
// freshest learner model available — but a buffered card is inherently up to one answer "stale"
// (it was chosen before the in-progress answer updated the skill). That drift is at most a fraction
// of a level, so the served CEFR rarely changes; acceptable for the latency win.
import { getExercise, type Exercise } from "./api";

export type FetchParams = { topic: string; level: string; type: string; context: string; mistakes?: string[] };

export type QueueDeps = {
  /** Resolve the next exercise's params from the current learner model (called per fetch). */
  selectParams: () => FetchParams;
  /** Override the fetcher (tests). Defaults to the real API call. */
  fetch?: (params: FetchParams) => Promise<Exercise>;
  /** Target number of cards ready-or-in-flight. */
  size?: number;
  /** Delay before the single re-try of a failed background prefetch (tests shrink it). */
  retryDelayMs?: number;
};

export type ExerciseQueue = {
  /** Next card: instant if buffered, otherwise fetched on demand (errors propagate here only). */
  next: () => Promise<Exercise>;
  /** Kick background prefetch up to `size` (safe to call repeatedly). */
  prefetch: () => void;
  /** Drop buffered + discard in-flight results (e.g. when the topic/context changes). */
  clear: () => void;
  /** Count currently ready to serve instantly (for tests/diagnostics). */
  readyCount: () => number;
};

export function createExerciseQueue(deps: QueueDeps): ExerciseQueue {
  const size = deps.size ?? 2;
  const fetchFn = deps.fetch ?? getExercise;
  const retryDelayMs = deps.retryDelayMs ?? 1500;
  let ready: Exercise[] = [];
  let inFlight = 0;
  let gen = 0; // bumped on clear() so stragglers from a stale generation are dropped

  // Best-effort background fetch: failures are swallowed (next() re-fetches and surfaces the error
  // only when the learner actually needs a card and none is buffered) — but each failed slot gets
  // ONE delayed re-try first. Without it a transient backend blip leaves the buffer cold, and the
  // learner pays on "Next" with a full-latency spinner or a visible error.
  function prefetchOne(retriesLeft = 1): void {
    const myGen = gen;
    inFlight++;
    void fetchFn(deps.selectParams())
      .then((ex) => {
        if (myGen === gen) ready.push(ex);
      })
      .catch(() => {
        if (retriesLeft > 0 && myGen === gen) {
          setTimeout(() => {
            // Re-check at fire time: the topic may have changed (gen) or next() may have refilled.
            if (myGen === gen && ready.length + inFlight < size) prefetchOne(retriesLeft - 1);
          }, retryDelayMs);
        }
      })
      .finally(() => {
        inFlight--;
      });
  }

  function prefetch(): void {
    while (ready.length + inFlight < size) prefetchOne();
  }

  async function next(): Promise<Exercise> {
    if (ready.length > 0) {
      const ex = ready.shift() as Exercise;
      prefetch(); // refill in the background
      return ex;
    }
    // Cold start or drained buffer: fetch directly so errors reach the caller.
    const ex = await fetchFn(deps.selectParams());
    prefetch();
    return ex;
  }

  function clear(): void {
    gen++;
    ready = [];
  }

  return { next, prefetch, clear, readyCount: () => ready.length };
}
