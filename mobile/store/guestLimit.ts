// Guest (anonymous) daily exercise cap. Anonymous users get the SAME daily allowance as a free
// account, so registering is never a downgrade (it was: anon was server-unmetered while free accounts
// are capped). On exhaustion the practice screen shows the soft register wall instead of an error —
// turning the cap into a conversion moment ("create an account to keep training + sync").
//
// Enforced client-side (best-effort): a determined guest can reset local storage. The real cost cap
// for anonymous LLM calls is a server/IP concern, deferred to Phase 5 (VPS) — see BACKLOG. This fix
// targets the incentive inversion, which matters before showing the app to real users.
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "relo_dojo/guest-limit/v1";

/** Mirror of backend FREE_DAILY_LIMIT (core/config.py). Drift here is cosmetic for guests only. */
export const GUEST_DAILY_LIMIT = 20;

export type GuestLimitState = { day: string; used: number }; // day = local YYYY-MM-DD
export const DEFAULT_GUEST_LIMIT: GuestLimitState = { day: "", used: 0 };

/** Pure: exercises remaining today (the counter resets when the local day changes). */
export function remaining(s: GuestLimitState, today: string, limit = GUEST_DAILY_LIMIT): number {
  return s.day === today ? Math.max(0, limit - s.used) : limit;
}

/** Pure: consume one exercise. Returns the next state + whether it was allowed (false = over cap). */
export function consume(
  s: GuestLimitState,
  today: string,
  limit = GUEST_DAILY_LIMIT
): { state: GuestLimitState; allowed: boolean } {
  const used = s.day === today ? s.used : 0; // new day → reset
  if (used >= limit) return { state: { day: today, used }, allowed: false };
  return { state: { day: today, used: used + 1 }, allowed: true };
}

// --- persistence (best-effort) ---

export async function loadGuestLimit(): Promise<GuestLimitState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_GUEST_LIMIT;
    const v = JSON.parse(raw) as Partial<GuestLimitState>;
    return { day: v.day ?? "", used: v.used ?? 0 };
  } catch {
    return DEFAULT_GUEST_LIMIT;
  }
}

/** Load → consume one → save. Returns whether the exercise is allowed today. */
export async function consumeGuestExercise(today: string): Promise<boolean> {
  const { state, allowed } = consume(await loadGuestLimit(), today);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore — worst case the guest gets a few extra exercises
  }
  return allowed;
}

/** Clear the counter (called on logout so a fresh guest starts clean). */
export async function resetGuestLimit(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
