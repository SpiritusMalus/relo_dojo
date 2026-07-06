// Quarterly level re-check nudge (pure). The full Level Test (store/levelTest.ts) has always been
// retakeable — this decides WHEN Home should invite the learner to it, closing the "приложение само
// периодически проверяет уровень" loop instead of leaving the test buried on the Progress tab.
import { totalAttempts, type Progress } from "./progress";

// Quarterly cadence: enough practice accumulates between checks for the level to actually move.
export const LEVEL_CHECK_INTERVAL_DAYS = 90;
// A learner who has never taken the full test is invited once they have real practice behind them —
// right after onboarding the calibration is fresh and a second test would just nag (the results
// screen already offers it once, see app/onboarding.tsx).
export const FIRST_CHECK_MIN_ATTEMPTS = 30;

/** Which invitation is due: the first full placement, the quarterly re-check, or none. */
export type LevelCheckKind = "first" | "quarterly";

/** Whole days from `a` to `b` (both local YYYY-MM-DD); positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** The Home-card decision for `today` (local YYYY-MM-DD). Null = no invitation. */
export function levelCheckDue(p: Progress, today: string): LevelCheckKind | null {
  if (!p.onboarded) return null;
  const last = p.lastLevelTestDate ?? "";
  if (!last) return totalAttempts(p) >= FIRST_CHECK_MIN_ATTEMPTS ? "first" : null;
  return daysBetween(last, today) >= LEVEL_CHECK_INTERVAL_DAYS ? "quarterly" : null;
}
