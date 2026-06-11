// Stage 2 Planner triggers (pure, unit-testable): WHEN to ask the server for a fresh plan.
// The plan itself is built server-side (/agent/plan) and cached into Profile.planWeights;
// adaptive.topicWeight folds the weights into topic selection.
import type { Profile, Progress } from "./progress";
import type { TopicStats } from "../services/api";

export const PLAN_MAX_AGE_DAYS = 7; // weekly refresh
export const LAPSE_DAYS = 3; // a 3-day gap means the old plan likely went stale

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

export type ReplanReason = "first" | "new-goal" | "lapse" | "stale" | null;

/** Should we ask the server for a fresh plan? Returns the trigger that fired (null = keep plan).
 *  Requires an onboarded profile; auth is the caller's concern (the endpoint needs it). */
export function shouldReplan(p: Progress, today: string): ReplanReason {
  const prof = p.profile;
  if (!p.onboarded || !prof) return null;
  if (!prof.planDate || !prof.planWeights) return "first";
  if ((prof.painText || "") !== (prof.planGoal || "")) return "new-goal";
  if (p.lastActiveDate && daysBetween(p.lastActiveDate, today) >= LAPSE_DAYS) return "lapse";
  if (daysBetween(prof.planDate, today) >= PLAN_MAX_AGE_DAYS) return "stale";
  return null;
}

/** Per-topic stats payload for /agent/plan, from the local learner model. */
export function buildStats(p: Progress): TopicStats {
  const out: TopicStats = {};
  for (const [topic, st] of Object.entries(p.topics)) {
    if (st.attempts > 0) {
      out[topic] = { attempts: st.attempts, correct: st.correct, skill: p.skill[topic] ?? 0 };
    }
  }
  return out;
}

/** The profile patch that caches a server plan locally. */
export function planPatch(
  plan: { topicWeights: Record<string, number>; note: string; date: string },
  profile: Profile
): Partial<Profile> {
  return {
    planWeights: plan.topicWeights,
    planNote: plan.note,
    planDate: plan.date,
    planGoal: profile.painText || "",
  };
}
