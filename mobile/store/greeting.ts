// Sensei's personal greeting on Home (pure, unit-testable): the visible face of the memory layer.
// The profile already knows the learner (wins, weak spots, streak) — this picks ONE line that
// proves Sensei remembers. Selection only; the actual copy lives in i18n (the component maps
// kind → tr key). Priority: today's done > fresh win > weak topic > streak > rotating default.
import type { Progress } from "./progress";

export const WEAK_ACC_THRESHOLD = 0.7; // below this accuracy a practiced topic counts as "weak"
export const WEAK_MIN_ATTEMPTS = 3;
export const DEFAULT_GREETING_COUNT = 3; // greet.d0..d2 in i18n

export type Greeting =
  | { kind: "doneToday"; n: number } // trained already — praise + keep the streak visible
  | { kind: "wins"; wins: string } // yesterday's session win, straight from the Progress Agent
  | { kind: "weakTopic"; topic: string } // canonical topic id; component localizes the label
  | { kind: "streak"; n: number }
  | { kind: "default"; idx: number };

function prevDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The learner's shakiest practiced topic (lowest accuracy under the threshold), or null. */
export function weakestTopic(p: Progress): string | null {
  let worst: string | null = null;
  let worstAcc = WEAK_ACC_THRESHOLD;
  for (const [topic, st] of Object.entries(p.topics)) {
    if (st.attempts < WEAK_MIN_ATTEMPTS) continue;
    const acc = st.correct / st.attempts;
    if (acc < worstAcc) {
      worstAcc = acc;
      worst = topic;
    }
  }
  return worst;
}

export function senseiGreeting(p: Progress, today: string): Greeting | null {
  if (!p.onboarded) return null;
  if (p.lastActiveDate === today) return { kind: "doneToday", n: p.dailyStreak };
  // A win line is personal but goes stale fast — only riff on it the morning after the session.
  const wins = p.profile?.wins?.trim();
  if (wins && p.lastActiveDate === prevDay(today)) return { kind: "wins", wins };
  const weak = weakestTopic(p);
  if (weak) return { kind: "weakTopic", topic: weak };
  if (p.dailyStreak >= 2) return { kind: "streak", n: p.dailyStreak };
  // Deterministic per day, so the line doesn't flicker between renders.
  const seed = Number(today.slice(-2)) || 0;
  return { kind: "default", idx: seed % DEFAULT_GREETING_COUNT };
}
