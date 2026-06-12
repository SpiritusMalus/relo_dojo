// Belt exam (pure, unit-testable): promotion is EARNED through a trial, not drifted into.
//
// The skill-derived belt keeps rising silently (the adaptive engine is untouched); what the
// learner WEARS is `Progress.beltEarned`. When skill outgrows the worn belt, an exam unlocks:
// EXAM_ITEMS exercises at the target belt's CEFR, at most EXAM_MAX_MISSES misses. Passing is the
// ceremony moment; failing costs nothing but the retry waits a day (anticipation > grind).
// Legacy snapshots (beltEarned undefined) keep their skill belt and are offered a CONFIRMATION
// exam of that same belt — no one gets downgraded by the feature.
import type { Progress } from "./progress";
import { skillBeltIdx } from "./dojo";

export const EXAM_ITEMS = 10;
export const EXAM_MAX_MISSES = 2;
export const MAX_BELT_IDX = 5; // black

export type ExamOffer = {
  target: number; // belt idx the exam awards
  confirm: boolean; // true = legacy account confirming its current skill belt
};

/** The exam on offer, or null when the worn belt already matches the skill. */
export function examOffer(p: Progress): ExamOffer | null {
  if (!p.onboarded) return null;
  const raw = skillBeltIdx(p);
  const earned = p.beltEarned;
  if (earned === undefined) {
    // Legacy / fresh-feature account: confirm the belt the skill already shows (white needs none).
    return raw >= 1 ? { target: Math.min(raw, MAX_BELT_IDX), confirm: true } : null;
  }
  return raw > earned && earned < MAX_BELT_IDX ? { target: earned + 1, confirm: false } : null;
}

/** One attempt per local day — failing means coming back tomorrow (the comeback hook). */
export function canAttemptToday(p: Progress, today: string): boolean {
  return p.lastExamDate !== today;
}

/** Verdict for a finished run. */
export function examPassed(misses: number): boolean {
  return misses <= EXAM_MAX_MISSES;
}

/** Early abort: one miss past the allowance already decides the run. */
export function examFailedNow(misses: number): boolean {
  return misses > EXAM_MAX_MISSES;
}
