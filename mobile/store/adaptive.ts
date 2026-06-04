// Adaptive difficulty — per-topic learner model (pure, no React/RN imports → unit-testable).
//
// Each topic has a continuous skill `level ∈ [0,5]` mapped to a CEFR band. A target-success
// controller nudges the level so the learner stays around ~75% success: a correct answer raises it
// a little, a wrong answer lowers it more, with the step shrinking as evidence accumulates. The
// level then drives the served difficulty (CEFR) and the exercise-type mix; topic choice is biased
// toward weak/underpracticed areas while staying varied (weighted-random).
import type { Progress } from "./progress";
import type { ExerciseType } from "../services/api";

export const START_LEVEL = 1.5; // ≈ A2/B1 boundary (Pre-Intermediate)
export const TARGET_SUCCESS = 0.75;
export const LEVEL_MIN = 0;
export const LEVEL_MAX = 5;

// Prior topic mix (the user's weak spots) — mirrors backend grammar.py TOPICS.
export const TOPIC_PRIORS: Record<string, number> = {
  prepositions: 16,
  conditionals: 12,
  "verb sequence (tense agreement)": 12,
  vocabulary: 10,
  articles: 10,
  "modal verbs": 9,
  "phrasal verbs": 9,
  "gerunds & infinitives": 7,
  "comparatives & superlatives": 6,
  "word order": 5,
  punctuation: 4,
};

export type Cefr = "A1" | "A2" | "B1" | "B2" | "C1";

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function levelToCefr(level: number): Cefr {
  if (level < 1) return "A1";
  if (level < 2) return "A2";
  if (level < 3) return "B1";
  if (level < 4) return "B2";
  return "C1";
}

export function skillFor(p: Progress, topic: string): number {
  const v = p.skill?.[topic];
  return typeof v === "number" ? v : START_LEVEL;
}

/** New skill map after one answer. `p` is the snapshot BEFORE this answer (so attempts = prior count
 *  → the step shrinks as the topic accumulates evidence). */
export function updateSkill(
  p: Progress,
  topic: string,
  correct: boolean
): Record<string, number> {
  const attempts = p.topics[topic]?.attempts ?? 0;
  const k = Math.max(0.15, 0.5 / (1 + attempts / 20));
  const next = clamp(
    skillFor(p, topic) + k * ((correct ? 1 : 0) - TARGET_SUCCESS),
    LEVEL_MIN,
    LEVEL_MAX
  );
  return { ...p.skill, [topic]: next };
}

// Exercise-type mix by level — recognition first, production later. free-text stays disabled.
// odd-one-out is recognition (fine early); multiple-blanks is mid; order-the-dialog needs cohesion
// (later). Anything at weight 0 is filtered out before the weighted pick.
function typeWeightsForLevel(level: number): Array<[ExerciseType, number]> {
  const cefr = levelToCefr(level);
  if (cefr === "A1" || cefr === "A2") {
    return [
      ["multiple-choice", 45],
      ["match-pairs", 25],
      ["build-the-sentence", 12],
      ["odd-one-out", 18],
      ["tap-the-error", 0],
      ["multiple-blanks", 0],
      ["order-the-dialog", 0],
    ];
  }
  if (cefr === "B1") {
    return [
      ["multiple-choice", 22],
      ["match-pairs", 15],
      ["build-the-sentence", 22],
      ["tap-the-error", 15],
      ["odd-one-out", 12],
      ["multiple-blanks", 10],
      ["order-the-dialog", 4],
    ];
  }
  return [
    ["multiple-choice", 8],
    ["match-pairs", 10],
    ["build-the-sentence", 26],
    ["tap-the-error", 28],
    ["odd-one-out", 8],
    ["multiple-blanks", 12],
    ["order-the-dialog", 8],
  ];
}

function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export const FOCUS_BOOST = 1.5; // extra weight for topics the user flagged as hard in onboarding

// Spaced repetition: a topic gains review urgency the longer it goes unseen. The boost ramps with
// days idle and saturates, so well-practiced topics resurface for review instead of being forgotten.
export const REVIEW_GRACE_DAYS = 2; // no boost for the first couple of days
export const REVIEW_HALFLIFE_DAYS = 7; // days of idleness for half the max boost
export const REVIEW_MAX_BOOST = 1.5; // cap (e.g. 1.5 = up to +50% weight)

/** Local calendar date as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00`);
  const b = Date.parse(`${toIso}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Review-urgency multiplier for a topic given today's date. Topics never practiced (no lastSeen)
 *  get no boost — they're already surfaced via the low-attempts accuracy prior. */
export function reviewBoost(p: Progress, topic: string, today: string): number {
  const last = p.topics[topic]?.lastSeen;
  if (!last) return 1;
  const idle = daysBetween(last, today) - REVIEW_GRACE_DAYS;
  if (idle <= 0) return 1;
  // Saturating ramp: idle / (idle + halflife) ∈ [0,1).
  const ramp = idle / (idle + REVIEW_HALFLIFE_DAYS);
  return 1 + ramp * (REVIEW_MAX_BOOST - 1);
}

/** Topic urgency weight: prior × deficit-to-target × focus boost × review boost (under-practiced
 *  topics use a 0.5 accuracy prior; topics the user flagged in onboarding get an extra multiplier;
 *  long-unseen topics gain spaced-repetition urgency). */
export function topicWeight(p: Progress, topic: string, today: string = isoDay(new Date())): number {
  const st = p.topics[topic];
  const acc = st && st.attempts >= 3 ? st.correct / st.attempts : 0.5;
  const focus = p.profile?.focusTopics?.includes(topic) ? FOCUS_BOOST : 1;
  return (
    TOPIC_PRIORS[topic] *
    (1 + Math.max(0, TARGET_SUCCESS - acc) * 2) *
    focus *
    reviewBoost(p, topic, today)
  );
}

/** Pick the next exercise's topic, difficulty (CEFR) and type from the learner model.
 *  Pass `forcedTopic` to drill a chosen topic (difficulty/type still adapt to its level). */
export function selectNext(
  p: Progress,
  forcedTopic?: string,
  today: string = isoDay(new Date())
): { topic: string; cefr: Cefr; type: ExerciseType } {
  const topics = Object.keys(TOPIC_PRIORS);
  const topic =
    forcedTopic && topics.includes(forcedTopic)
      ? forcedTopic
      : weightedPick(
          topics,
          topics.map((t) => topicWeight(p, t, today))
        );
  const level = skillFor(p, topic);
  const tw = typeWeightsForLevel(level).filter(([, w]) => w > 0);
  const type = weightedPick(
    tw.map(([t]) => t),
    tw.map(([, w]) => w)
  );
  return { topic, cefr: levelToCefr(level), type };
}
