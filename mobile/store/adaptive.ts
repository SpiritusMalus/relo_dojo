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

// Prior topic mix (the user's weak spots) — also mirrored on the backend.
export const TOPIC_PRIORS: Record<string, number> = {
  prepositions: 40,
  conditionals: 30,
  "verb sequence (tense agreement)": 20,
  vocabulary: 10,
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
function typeWeightsForLevel(level: number): Array<[ExerciseType, number]> {
  const cefr = levelToCefr(level);
  if (cefr === "A1" || cefr === "A2") {
    return [
      ["multiple-choice", 55],
      ["match-pairs", 30],
      ["build-the-sentence", 15],
      ["tap-the-error", 0],
    ];
  }
  if (cefr === "B1") {
    return [
      ["multiple-choice", 30],
      ["match-pairs", 20],
      ["build-the-sentence", 30],
      ["tap-the-error", 20],
    ];
  }
  return [
    ["multiple-choice", 10],
    ["match-pairs", 15],
    ["build-the-sentence", 35],
    ["tap-the-error", 40],
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

/** Topic urgency weight: prior × deficit-to-target × focus boost (under-practiced topics use a 0.5
 *  accuracy prior; topics the user flagged in onboarding get an extra multiplier). */
export function topicWeight(p: Progress, topic: string): number {
  const st = p.topics[topic];
  const acc = st && st.attempts >= 3 ? st.correct / st.attempts : 0.5;
  const focus = p.profile?.focusTopics?.includes(topic) ? FOCUS_BOOST : 1;
  return TOPIC_PRIORS[topic] * (1 + Math.max(0, TARGET_SUCCESS - acc) * 2) * focus;
}

/** Pick the next exercise's topic, difficulty (CEFR) and type from the learner model. */
export function selectNext(p: Progress): { topic: string; cefr: Cefr; type: ExerciseType } {
  const topics = Object.keys(TOPIC_PRIORS);
  const topic = weightedPick(
    topics,
    topics.map((t) => topicWeight(p, t))
  );
  const level = skillFor(p, topic);
  const tw = typeWeightsForLevel(level).filter(([, w]) => w > 0);
  const type = weightedPick(
    tw.map(([t]) => t),
    tw.map(([, w]) => w)
  );
  return { topic, cefr: levelToCefr(level), type };
}
