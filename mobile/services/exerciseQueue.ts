// Exercises are selected from the current learner snapshot. Practice prefetches during feedback,
// after recording the answer; fixed-spec exams may keep prefetch-on-serve. A model revision change
// invalidates both buffered cards and in-flight results, including an on-demand cold fetch.
import { getExercise, type Exercise } from "./api";

export type FetchParams = { topic: string; level: string; type: string; context: string; mistakes?: string[]; practice_index?: number };

export type QueueDeps = {
  selectParams: () => FetchParams;
  fetch?: (params: FetchParams) => Promise<Exercise>;
  size?: number;
  retryDelayMs?: number;
  /** Learner-model revision (e.g. total recorded answers). An older card must never cross it. */
  revision?: () => number | string;
  /** Practice sets false and calls prefetch only AFTER recording the current answer. */
  prefetchOnServe?: boolean;
};

export type ExerciseQueue = {
  next: () => Promise<Exercise>;
  prefetch: () => void;
  clear: () => void;
  readyCount: () => number;
};

export function createExerciseQueue(deps: QueueDeps): ExerciseQueue {
  const size = deps.size ?? 2;
  const fetchFn = deps.fetch ?? getExercise;
  const retryDelayMs = deps.retryDelayMs ?? 1500;
  let ready: Exercise[] = [];
  let inFlight = 0;
  let gen = 0;
  let revision = deps.revision?.();
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();
  const waiters = new Set<() => void>();

  function wakeWaiters(): void {
    for (const wake of waiters) wake();
    waiters.clear();
  }

  function clear(): void {
    gen++;
    ready = [];
    // Old fetch finalizers must not consume the new generation's slots.
    inFlight = 0;
    revision = deps.revision?.();
    for (const timer of retryTimers) clearTimeout(timer);
    retryTimers.clear();
    wakeWaiters();
  }

  function reconcileRevision(): void {
    if (deps.revision && deps.revision() !== revision) clear();
  }

  function current(myGen: number): boolean {
    reconcileRevision();
    return myGen === gen;
  }

  function prefetchOne(retriesLeft = 1): void {
    const myGen = gen;
    const params = deps.selectParams();
    inFlight++;
    let request: Promise<Exercise>;
    try { request = fetchFn(params); } catch (error) { request = Promise.reject(error); }
    void request
      .then((ex) => {
        if (current(myGen)) ready.push(ex);
      })
      .catch(() => {
        if (retriesLeft > 0 && current(myGen)) {
          const timer = setTimeout(() => {
            retryTimers.delete(timer);
            if (current(myGen) && ready.length + inFlight < size) prefetchOne(retriesLeft - 1);
          }, retryDelayMs);
          retryTimers.add(timer);
        }
      })
      .finally(() => {
        if (myGen === gen) {
          inFlight--;
          wakeWaiters();
        }
      });
  }

  function prefetch(): void {
    reconcileRevision();
    while (ready.length + inFlight < size) prefetchOne();
  }

  async function next(): Promise<Exercise> {
    for (;;) {
      reconcileRevision();
      if (ready.length > 0) {
        const ex = ready.shift() as Exercise;
        if (deps.prefetchOnServe !== false) prefetch();
        return ex;
      }
      if (inFlight > 0) {
        // Next can be tapped before feedback-time generation finishes. Reuse that work instead
        // of launching a third paid request alongside the two prefetches.
        await new Promise<void>((resolve) => waiters.add(resolve));
        continue;
      }
      const myGen = gen;
      try {
        const ex = await fetchFn(deps.selectParams());
        // Steering/model changed while this slow request was running: fetch the current spec.
        if (!current(myGen)) continue;
        if (deps.prefetchOnServe !== false) prefetch();
        return ex;
      } catch (error) {
        if (!current(myGen)) continue;
        throw error;
      }
    }
  }

  return { next, prefetch, clear, readyCount: () => { reconcileRevision(); return ready.length; } };
}
