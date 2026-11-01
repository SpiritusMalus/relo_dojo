import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError, getExercise, request, type Exercise } from "./api";
import type { DojoSnapshot } from "./dojo";
import type { FetchParams } from "./exerciseQueue";
import { isCurrentAccountScope, type AccountScope } from "../store/accountScope";

export type LearningSession = {
  id: string;
  item_count: number;
  expires_at: string;
  graded_count: number;
  completed: boolean;
  reward_day: string | null;
};
export type LearningSessionReceipt = { session: LearningSession; dojo: DojoSnapshot | null };
type Pending = { clientId: string; id?: string; createdAt: number };
const pendingQueues = new Map<string, Promise<unknown>>();
const recovery = new Map<AccountScope, Promise<LearningSessionReceipt[]>>();
const validOwner = (scope: AccountScope) => !!scope.owner && scope.owner !== "guest" && isCurrentAccountScope(scope);
const pendingKey = (scope: AccountScope) => `relo_dojo/learning-sessions/v1/${encodeURIComponent(scope.owner!)}`;

export function startLearningSession(clientId: string): Promise<LearningSession> {
  return request("/dojo/sessions", { client_id: clientId }, "POST", 8000);
}
export function getLearningSession(id: string): Promise<LearningSession> {
  return request(`/dojo/sessions/${encodeURIComponent(id)}`, undefined, "GET", 8000);
}
export function completeLearningSession(id: string): Promise<LearningSessionReceipt> {
  return request(`/dojo/sessions/${encodeURIComponent(id)}/complete`, {}, "POST", 12000);
}
export function abandonLearningSession(id: string): Promise<LearningSession> {
  return request(`/dojo/sessions/${encodeURIComponent(id)}/abandon`, {}, "POST", 8000);
}

// These ids deduplicate retries; they confer no authority (the API binds sessions to the account).
function clientId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
    const n = Math.floor(Math.random() * 16);
    return (letter === "x" ? n : (n & 3) | 8).toString(16);
  });
}

async function pendingTask<T>(scope: AccountScope, fallback: T, run: (list: Pending[]) => Promise<T>): Promise<T> {
  if (!validOwner(scope)) return fallback;
  const key = pendingKey(scope);
  const task = (pendingQueues.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (!validOwner(scope)) return fallback;
    let list: Pending[] = [];
    try {
      const parsed: unknown = JSON.parse(await AsyncStorage.getItem(key) ?? "[]");
      if (Array.isArray(parsed)) list = parsed.filter((p): p is Pending => p && typeof p.clientId === "string" && typeof p.createdAt === "number" && (p.id === undefined || typeof p.id === "string"));
    } catch { /* A missing/corrupt recovery list cannot become an earned practice day. */ }
    if (!validOwner(scope)) return fallback;
    return run(list);
  });
  pendingQueues.set(key, task);
  try { return await task; }
  finally { if (pendingQueues.get(key) === task) pendingQueues.delete(key); }
}

async function savePending(scope: AccountScope, pending: Pending): Promise<void> {
  await pendingTask(scope, undefined, async (list) => {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    const next = [...list.filter((p) => p.clientId !== pending.clientId && p.createdAt >= cutoff), pending];
    // The captured immutable owner key is safe even when a native write finishes after logout.
    if (validOwner(scope)) await AsyncStorage.setItem(pendingKey(scope), JSON.stringify(next));
  });
}
async function forgetPending(scope: AccountScope, id: string): Promise<void> {
  await pendingTask(scope, undefined, async (list) => {
    if (validOwner(scope)) await AsyncStorage.setItem(pendingKey(scope), JSON.stringify(list.filter((p) => p.clientId !== id)));
  });
}

/** Recovery is GET-first once the server id is known. Only the server's ten graded receipts may
 * complete a day; an analytics event or local answer count cannot claim a decoration. */
export function recoverLearningSessions(scope: AccountScope): Promise<LearningSessionReceipt[]> {
  if (!validOwner(scope)) return Promise.resolve([]);
  const existing = recovery.get(scope);
  if (existing) return existing;
  const task = (async () => {
    const list = await pendingTask(scope, [] as Pending[], async (stored) => stored);
    const receipts: LearningSessionReceipt[] = [];
    for (const pending of list) {
      if (!validOwner(scope)) break;
      try {
        const session = pending.id ? await getLearningSession(pending.id) : await startLearningSession(pending.clientId);
        if (!validOwner(scope)) break;
        if (session.completed) {
          receipts.push({ session, dojo: null });
          await forgetPending(scope, pending.clientId);
        } else if (Date.parse(session.expires_at) <= Date.now()) {
          await forgetPending(scope, pending.clientId);
        } else if (session.graded_count >= session.item_count) {
          const receipt = await completeLearningSession(session.id);
          if (!validOwner(scope)) break;
          receipts.push(receipt);
          await forgetPending(scope, pending.clientId);
        } else {
          // Home is outside the presented lesson. Release a partial abandoned session so normal
          // enter/exit navigation cannot consume every open-session slot for the next 24 hours.
          const released = await abandonLearningSession(session.id);
          if (!validOwner(scope)) break;
          if (released.completed || released.graded_count < released.item_count) await forgetPending(scope, pending.clientId);
        }
      } catch (error) {
        if (!validOwner(scope)) break;
        if (error instanceof ApiError && [404, 410].includes(error.status)) await forgetPending(scope, pending.clientId);
        // Keep uncertain writes for the next foreground visit. Never retry an uncertain grant as
        // a new session or manufacture a local practice-day increment.
      }
    }
    return receipts;
  })();
  recovery.set(scope, task);
  void task.finally(() => { if (recovery.get(scope) === task) recovery.delete(scope); }).catch(() => {});
  return task;
}

/** One tracker belongs to one presented lesson and one account epoch. Replacing/prefetching a
 * card reuses its ordinal; only an actual graded answer advances it. */
export function createLearningSessionTracker(scope: AccountScope, signedIn: boolean) {
  const pending: Pending = { clientId: clientId(), createdAt: Date.now() };
  let session: LearningSession | null = null;
  let started: Promise<LearningSession | null> | null = null;
  let finishing: Promise<LearningSessionReceipt | null> | null = null;
  let receipt: LearningSessionReceipt | null = null;
  let disposed = false;
  let eligible = true;
  let releasing: Promise<void> | null = null;
  const bindings = new Map<string, number>();
  const graded = new Set<number>();
  const owns = () => !disposed && signedIn && validOwner(scope);
  const assertActive = () => {
    if (disposed) throw new ApiError("The lesson is closed.", 409, "queue_disposed");
    if (!isCurrentAccountScope(scope)) throw new ApiError("The signed-in account changed.", 409, "session_changed");
  };

  function releaseOpenSession(id: string): Promise<void> {
    if (!validOwner(scope)) return Promise.resolve();
    if (releasing) return releasing;
    releasing = (async () => {
      try {
        const released = await abandonLearningSession(id);
        if (!validOwner(scope)) return;
        // If the final grade committed before unmount, the API preserves that complete evidence.
        // Leave it queued for GET recovery instead of losing an earned day to a UI interruption.
        if (released.completed || released.graded_count < released.item_count) await forgetPending(scope, pending.clientId);
      } catch { /* An uncertain close stays in owner-scoped recovery. No new account is borrowed. */ }
    })();
    return releasing;
  }

  async function start(): Promise<LearningSession | null> {
    if (!owns() || !eligible) return null;
    if (!started) started = (async () => {
      try {
        await savePending(scope, pending);
        if (!owns()) return null;
        const result = await startLearningSession(pending.clientId);
        if (!validOwner(scope)) return null;
        session = result;
        pending.id = result.id;
        await savePending(scope, pending);
        if (disposed) { await releaseOpenSession(result.id); return null; }
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) await forgetPending(scope, pending.clientId);
        return null; // Guest/old backend/offline practice keeps its ordinary learning path.
      }
    })();
    return started;
  }

  return {
    async fetch(params: FetchParams): Promise<Exercise> {
      assertActive();
      const current = await start();
      assertActive();
      const ordinal = graded.size;
      const bound = current && ordinal < current.item_count;
      let exercise: Exercise;
      try {
        exercise = await getExercise(bound ? { ...params, learning_session_id: current.id, learning_item: ordinal } : params);
      } catch (error) {
        if (!bound || !(error instanceof ApiError) || error.status !== 410 || error.code !== "learning_session_expired") throw error;
        // A long pause may outlive receipt eligibility. Keep the lesson usable with ordinary
        // exercises, but never attach a replacement session halfway through the same ten items.
        eligible = false;
        await forgetPending(scope, pending.clientId);
        assertActive();
        exercise = await getExercise(params);
      }
      assertActive();
      // Flag-off /exercise intentionally serves the ordinary card. A bound issuance always
      // includes the independent review token; never count a degraded ordinary card as proof.
      if (bound && exercise.token && exercise.review_token) bindings.set(exercise.token, ordinal);
      else if (bound) eligible = false;
      return exercise;
    },
    recordGraded(exercise: Exercise): void {
      if (!owns() || !exercise.token) return;
      const ordinal = bindings.get(exercise.token);
      if (ordinal !== undefined) graded.add(ordinal);
    },
    hasBoundSession(): boolean { return owns() && eligible && session !== null; },
    dispose(): Promise<void> {
      disposed = true;
      return session && graded.size < session.item_count ? releaseOpenSession(session.id) : Promise.resolve();
    },
    complete(): Promise<LearningSessionReceipt | null> {
      if (!owns() || !eligible || !session || graded.size < session.item_count) return Promise.resolve(null);
      if (receipt) return Promise.resolve(receipt);
      if (finishing) return finishing;
      const id = session.id;
      finishing = (async () => {
        try {
          let result: LearningSessionReceipt;
          try { result = await completeLearningSession(id); }
          catch (error) {
            if (!owns()) return null;
            if (error instanceof ApiError && error.status === 410) {
              await forgetPending(scope, pending.clientId);
              throw error;
            }
            const recovered = await getLearningSession(id);
            if (!recovered.completed && Date.parse(recovered.expires_at) <= Date.now()) {
              await forgetPending(scope, pending.clientId);
              throw new ApiError("Start a new practice session.", 410, "learning_session_expired");
            }
            if (!recovered.completed) throw error;
            result = { session: recovered, dojo: null };
          }
          if (!owns()) return null;
          receipt = result;
          await forgetPending(scope, pending.clientId);
          return result;
        } finally { finishing = null; }
      })();
      return finishing;
    },
  };
}
