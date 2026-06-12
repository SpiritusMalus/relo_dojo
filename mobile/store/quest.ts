// Weekly quest scroll (pure, unit-testable): the Planner's invisible math made visible.
//
// When a plan is cached (store/planner.ts), we also snapshot a per-topic baseline of correct
// answers. The scroll shows the plan's top QUEST_COUNT topics as goals — "N correct this week" —
// with progress measured against that baseline. Completing all goals pays QUEST_BONUS_XP once
// per plan (XP is client-owned, like the combo bonus; koku must stay server-authoritative, so a
// koku reward waits for a server-verified version — see BACKLOG).
import type { Profile, Progress } from "./progress";

export const QUEST_COUNT = 3;
export const QUEST_TARGET = 8; // correct answers per goal topic within the plan week
export const QUEST_BONUS_XP = 100;

export type Quest = { topic: string; done: number; target: number };

/** Baseline snapshot for quest progress: correct-answer count per topic at plan time. */
export function questBaseline(p: Progress): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [topic, st] of Object.entries(p.topics)) out[topic] = st.correct;
  return out;
}

/** The plan's top-weighted topics as this week's goals, or [] when no plan is cached. */
export function buildQuests(p: Progress): Quest[] {
  const prof = p.profile;
  if (!prof?.planWeights || !prof.planDate) return [];
  const baseline = prof.planBaseline ?? {};
  return Object.entries(prof.planWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, QUEST_COUNT)
    .map(([topic]) => {
      const done = Math.max(0, (p.topics[topic]?.correct ?? 0) - (baseline[topic] ?? 0));
      return { topic, done: Math.min(done, QUEST_TARGET), target: QUEST_TARGET };
    });
}

export function questsComplete(quests: Quest[]): boolean {
  return quests.length > 0 && quests.every((q) => q.done >= q.target);
}

/** The bonus is one-shot per plan: pay when all goals are done and this plan hasn't paid yet. */
export function bonusDue(p: Progress): boolean {
  const prof = p.profile;
  if (!prof?.planDate) return false;
  return questsComplete(buildQuests(p)) && prof.planBonusPaid !== prof.planDate;
}

/** Profile patch marking the current plan's bonus as paid. */
export function bonusPaidPatch(profile: Profile): Partial<Profile> {
  return { planBonusPaid: profile.planDate ?? "" };
}
