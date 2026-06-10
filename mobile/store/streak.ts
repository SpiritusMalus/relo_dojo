// Streak-as-asset (monetization branch 3) — pure helpers, no I/O.
//
// The streak is the user's most loss-averse possession: the longer it grows, the more they'll pay
// to keep it. Three mechanics hang off this module:
// - detection: a missed day no longer silently resets the count — it becomes a visible BREAK event;
// - omamori: an owned freeze charm auto-bridges the gap (consumed server-side via /wallet/spend);
// - repair ("отработка у Сэнсэя"): within a window the broken streak can be bought back for koku,
//   priced UP with the length of the lost streak (the more invested, the dearer the rescue).

export type BrokenStreak = { streak: number; date: string }; // date = local day the break was noticed

/** Days the repair offer stays open after the break is noticed. */
export const REPAIR_WINDOW_DAYS = 2;
/** Streaks shorter than this aren't worth a repair flow — they just reset quietly. */
export const MIN_REPAIRABLE_STREAK = 3;

// Display mirror of backend pricing (core/config.py: REPAIR_BASE/PER_DAY/MAX). The server computes
// the real charge in /wallet/spend, so drift here is cosmetic only.
export const REPAIR_BASE = 80;
export const REPAIR_PER_DAY = 2;
export const REPAIR_MAX = 300;

/** Koku price to restore a streak of `streak` days. Grows with the loss — loss aversion priced in. */
export function repairPrice(streak: number): number {
  return Math.min(REPAIR_BASE + REPAIR_PER_DAY * streak, REPAIR_MAX);
}

/** Local calendar date as YYYY-MM-DD (streaks follow the user's day, not UTC). */
export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function yesterdayOf(now: Date): string {
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return localDate(y);
}

/** Whole days between the last active day and now (0 = active today, 1 = yesterday, …). */
export function daysSinceActive(lastActiveDate: string, now: Date): number {
  if (!lastActiveDate) return Number.POSITIVE_INFINITY;
  const [y, m, d] = lastActiveDate.split("-").map(Number);
  const last = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - last.getTime()) / 86400000);
}

export type StreakStatus =
  | { kind: "ok" } // active today/yesterday, or nothing to protect
  | { kind: "freezable" } // gap detected AND a charm could bridge it (caller checks ownership)
  | { kind: "broken"; streak: number }; // gap detected, streak worth a repair offer
// (short streaks fall through to "ok" — recordAnswer will quietly restart them at 1)

/** Classify the streak situation on app focus. Pure: charm ownership is the caller's business. */
export function streakStatus(dailyStreak: number, lastActiveDate: string, now: Date): StreakStatus {
  if (dailyStreak <= 0 || !lastActiveDate) return { kind: "ok" };
  const gap = daysSinceActive(lastActiveDate, now);
  if (gap <= 1) return { kind: "ok" }; // today or yesterday — still alive
  if (dailyStreak < MIN_REPAIRABLE_STREAK) return { kind: "ok" }; // too small to monetize
  return { kind: "broken", streak: dailyStreak };
}

/** Is a recorded break still within the repair window? */
export function repairOpen(broken: BrokenStreak | null | undefined, now: Date): boolean {
  if (!broken || broken.streak < MIN_REPAIRABLE_STREAK) return false;
  return daysSinceActive(broken.date, now) <= REPAIR_WINDOW_DAYS;
}
