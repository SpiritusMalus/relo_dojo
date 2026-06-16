// "Review my text" weekly hook (IDEAS_2026-06-16 — distribution §1.2 + retention §2.4).
//
// "Review my text" is the killer FREE taste: paste a REAL relocation message (a standup update, a
// Slack to a teammate, an email to the landlord) and get it fixed — free, no account needed
// (review_text is open to everyone; see store/access.ts). Today it's a buried mode button. This
// surfaces it as a prominent Home card whose prompt ROTATES WEEKLY, so a returning learner always
// has a fresh, job-relevant reason to paste this week's real message — the recurring D7 hook tied to
// their actual work, not a generic "come back".
//
// Pure logic + tiny AsyncStorage persistence, mirroring store/journey.ts / store/registerWall.ts.
// Its own storage key, fully decoupled from synced Progress → zero server-schema risk. The card is
// dismissable for the CURRENT week; next week it returns with the next prompt.
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "grammar-dojo/reviewHook/v1";

// Relocation-flavored prompt ids. Each maps to an i18n label `revhook.p.<id>` (EN + RU). Rotated
// weekly so the hook stays fresh and tracks the learner's real interview → life → work arc.
export const REVIEW_PROMPTS = [
  "standup",
  "slack",
  "interviewEmail",
  "landlord",
  "prReview",
  "hrEmail",
] as const;
export type ReviewPrompt = (typeof REVIEW_PROMPTS)[number];

export type ReviewHookState = { dismissedWeek: string | null };
export const DEFAULT_REVIEW_HOOK: ReviewHookState = { dismissedWeek: null };

// A fixed anchor (a Monday) — its absolute value is irrelevant; we only need a stable weekly bucket.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const EPOCH = Date.UTC(2024, 0, 1);

/** Whole weeks since the anchor — increments by 1 every 7 days, constant within a week. Pure. */
export function weekIndex(d: Date): number {
  return Math.floor((d.getTime() - EPOCH) / WEEK_MS);
}

/** Stable per-week key (e.g. "w123"), used to remember "dismissed this week". Pure. */
export function weekKey(d: Date): string {
  return `w${weekIndex(d)}`;
}

/** Which prompt to show this week — deterministic rotation, stable within the week. Pure. */
export function promptForWeek(d: Date): ReviewPrompt {
  const n = REVIEW_PROMPTS.length;
  return REVIEW_PROMPTS[((weekIndex(d) % n) + n) % n];
}

/** Show the hook unless it was dismissed during the current week (so it returns next week). Pure. */
export function shouldShowHook(s: ReviewHookState, d: Date): boolean {
  return s.dismissedWeek !== weekKey(d);
}

/** Mark the hook dismissed for the current week. Returns new state; does not mutate. Pure. */
export function dismissForWeek(s: ReviewHookState, d: Date): ReviewHookState {
  return { ...s, dismissedWeek: weekKey(d) };
}

// --- persistence (best-effort; a lost write is non-fatal — the card just reappears) ---

export async function loadReviewHook(): Promise<ReviewHookState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ReviewHookState>;
    return { dismissedWeek: typeof v.dismissedWeek === "string" ? v.dismissedWeek : null };
  } catch {
    return null;
  }
}

export async function saveReviewHook(s: ReviewHookState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

/** Clear hook state (called on logout so a fresh learner on the device starts clean). */
export async function resetReviewHook(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
