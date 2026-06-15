// Curated scenario packs for the "English for IT relocation" journey (NICHE_PIVOT_IT_RELOCATION.md,
// Task 4). Pure data + selection — no React/RN, no backend change. These ride the existing generation
// `context` string (see buildContext in onboarding.ts): they add concrete, rotating specificity on top
// of the generic GOAL_PHRASES, so an exercise reads like a real moment ("a daily standup update")
// rather than a bare topic. Reversible: the packs only apply when a learner picked a journey goal;
// otherwise generation falls back to the generic phrase exactly as before.
//
// Keys match the journey goal ids in onboarding.ts (the interview -> life -> work arc). English-only:
// the model generates English examples, so these are English hints, not UI copy.

export const SCENARIO_PACKS: Record<string, readonly string[]> = {
  // Pre-move: interview English (behavioural + technical).
  interviews: [
    "a behavioural interview: 'tell me about a time you disagreed with a teammate'",
    "explaining a past project's trade-offs to an interviewer",
    "a system-design interview, thinking out loud about your approach",
    "a recruiter screen: notice period and salary expectations",
    "answering 'what's your biggest weakness?' without clichés",
  ],
  // Arrival: everyday admin English after the move.
  relocation_life: [
    "opening a bank account as a new arrival",
    "calling a landlord about a broken heater",
    "registering with a doctor's office abroad",
    "sorting out a phone plan and an ID appointment",
    "asking a neighbour where to recycle and sort the rubbish",
  ],
  // Ongoing: workplace English — the retention anchor that survives the move.
  work_comms: [
    "giving a daily standup update",
    "leaving a comment on a colleague's pull request",
    "writing a Slack message to unblock a teammate",
    "disagreeing politely in a design-doc thread",
    "explaining why a release slipped in a status update",
  ],
};

// The journey stages in arc order (pre-move -> arrival -> ongoing).
export const JOURNEY_GOALS = ["interviews", "relocation_life", "work_comms"] as const;

/**
 * Pick one curated scenario for the learner's relocation-journey goals. When several journey goals
 * are selected, a stage is chosen first (so each gets airtime), then a scenario within it. Returns
 * null when no journey goal is selected — callers then fall back to the generic context.
 *
 * `preferGoal` (a journey goal id, e.g. from the learner's current journey stage) biases the pick to
 * that goal's pack when it has one, so content follows where the learner is on the arc. `rng` is
 * injectable purely for deterministic tests; production uses Math.random for variety.
 */
export function pickScenario(
  goals: string[] | null | undefined,
  rng: () => number = Math.random,
  preferGoal?: string | null
): string | null {
  if (preferGoal) {
    const pref = SCENARIO_PACKS[preferGoal];
    if (pref && pref.length > 0) return pref[Math.floor(rng() * pref.length) % pref.length];
  }
  const selected = (goals ?? []).filter((g) => (JOURNEY_GOALS as readonly string[]).includes(g));
  if (selected.length === 0) return null;
  const stage = selected[Math.floor(rng() * selected.length) % selected.length];
  const pack = SCENARIO_PACKS[stage];
  if (!pack || pack.length === 0) return null;
  return pack[Math.floor(rng() * pack.length) % pack.length];
}
