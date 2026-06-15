// Soft register wall (anon-first funnel, P2). Anonymous users learn freely; once they've invested a
// few lessons we offer — never force — an account, sold on the one thing an anon device can't do:
// saving/syncing progress across devices (the `sync` feature in store/access.ts).
//
// Pure logic + tiny AsyncStorage persistence. The wall is a nudge: it fires after N finished lessons
// while the learner is still anonymous and hasn't dismissed it. Creating an account or dismissing
// closes it for good. No content is gated by this — only the prompt.
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "grammar-dojo/register-wall/v1";

/** Finished anonymous lessons before the save-progress prompt appears (Duo-style: taste first). */
export const WALL_AFTER_LESSONS = 3;

export type WallState = { lessons: number; dismissed: boolean };
export const DEFAULT_WALL: WallState = { lessons: 0, dismissed: false };

/** Count one finished lesson (a completed core-practice session). Pure. */
export function countLesson(s: WallState): WallState {
  return { ...s, lessons: s.lessons + 1 };
}

/** Mark the prompt dismissed ("maybe later"). Pure. */
export function dismiss(s: WallState): WallState {
  return { ...s, dismissed: true };
}

/** Should we show the save-progress prompt? Only for anonymous users who've invested `after`
 *  lessons and haven't dismissed it. Accounts (hasAccount=true) never see it. Pure. */
export function shouldShowWall(
  s: WallState,
  hasAccount: boolean,
  after: number = WALL_AFTER_LESSONS
): boolean {
  return !hasAccount && !s.dismissed && s.lessons >= after;
}

// --- persistence (best-effort; losing a write is non-fatal) ---

export async function loadWall(): Promise<WallState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WALL;
    const v = JSON.parse(raw) as Partial<WallState>;
    return { lessons: v.lessons ?? 0, dismissed: !!v.dismissed };
  } catch {
    return DEFAULT_WALL;
  }
}

export async function saveWall(s: WallState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

/** Convenience: load → countLesson → save, returning the new state. Used at session finish. */
export async function recordLessonFinished(): Promise<WallState> {
  const next = countLesson(await loadWall());
  await saveWall(next);
  return next;
}
