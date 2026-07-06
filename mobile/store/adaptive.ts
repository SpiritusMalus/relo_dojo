// Adaptive difficulty — per-topic learner model (pure, no React/RN imports → unit-testable).
//
// Each topic has a continuous skill `level ∈ [0,5]` mapped to a CEFR band. A target-success
// controller nudges the level so the learner stays around ~75% success: a correct answer raises it
// a little, a wrong answer lowers it more, with the step shrinking as evidence accumulates. The
// level then drives the served difficulty (CEFR) and the exercise-type mix; topic choice is biased
// toward weak/underpracticed areas while staying varied (weighted-random).
import type { Progress, Steering } from "./progress";
import type { ExerciseType } from "../services/api";
import { CURRICULUM } from "./curriculum";

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

// Midpoint of each CEFR band on the 0..5 skill scale — used as the served item's difficulty.
const CEFR_MIDPOINT: Record<Cefr, number> = { A1: 0.5, A2: 1.5, B1: 2.5, B2: 3.5, C1: 4.5 };
export function cefrMidpoint(cefr: Cefr): number {
  return CEFR_MIDPOINT[cefr];
}
export function isCefr(s: string): s is Cefr {
  return s in CEFR_MIDPOINT;
}

export function skillFor(p: Progress, topic: string): number {
  const v = p.skill?.[topic];
  return typeof v === "number" ? v : START_LEVEL;
}

// Cross-topic cold start: grammar topics that tend to move together. Used to estimate the level of a
// topic the learner hasn't actually practiced yet from correlated topics they have — e.g. someone
// strong in conditionals likely isn't a beginner at verb-sequence — instead of a flat START_LEVEL.
export const TOPIC_CORRELATIONS: Record<string, string[]> = {
  "verb sequence (tense agreement)": ["conditionals", "modal verbs", "gerunds & infinitives"],
  conditionals: ["verb sequence (tense agreement)", "modal verbs"],
  "modal verbs": ["conditionals", "verb sequence (tense agreement)"],
  "gerunds & infinitives": ["verb sequence (tense agreement)", "phrasal verbs"],
  prepositions: ["articles", "phrasal verbs"],
  articles: ["prepositions"],
  "phrasal verbs": ["prepositions", "gerunds & infinitives"],
  "word order": ["comparatives & superlatives", "punctuation"],
  "comparatives & superlatives": ["word order"],
  punctuation: ["word order"],
  vocabulary: [],
};

// How far an untested topic's estimate is pulled from its seed toward correlated practiced topics.
export const COLD_START_BLEND = 0.6;

/** Effective skill used for difficulty/selection. For a topic with real evidence (≥1 attempt) this is
 *  just `skillFor`. For an *untested* topic it blends the seed toward the average skill of correlated
 *  topics the learner HAS practiced, so cold topics start near related ability instead of flat. */
export function effectiveSkill(p: Progress, topic: string): number {
  const base = skillFor(p, topic);
  const attempts = p.topics?.[topic]?.attempts ?? 0;
  if (attempts > 0) return base; // direct evidence wins
  const related = (TOPIC_CORRELATIONS[topic] ?? []).filter((t) => (p.topics?.[t]?.attempts ?? 0) > 0);
  if (related.length === 0) return base; // nothing correlated practiced yet
  const avg = related.reduce((s, t) => s + skillFor(p, t), 0) / related.length;
  return clamp(base + COLD_START_BLEND * (avg - base), LEVEL_MIN, LEVEL_MAX);
}

// How strongly the served difficulty bends the expected outcome (per skill-level of gap). At 0 this
// reduces to the plain target-success controller (expected outcome = TARGET_SUCCESS always).
export const DIFFICULTY_SENSITIVITY = 0.15;

/** Expected outcome (0..1) for a learner of `skill` facing an item of `difficulty` (both on 0..5).
 *  Anchored at TARGET_SUCCESS when difficulty == skill; easier items raise it, harder items lower it. */
export function expectedOutcome(skill: number, difficulty: number): number {
  return clamp(TARGET_SUCCESS + DIFFICULTY_SENSITIVITY * (skill - difficulty), 0.05, 0.95);
}

/** New skill map after one answer. `p` is the snapshot BEFORE this answer (so attempts = prior count
 *  → the step shrinks as the topic accumulates evidence).
 *
 *  Difficulty-aware (Elo/IRT-lite): the level moves by `outcome − expectedOutcome(skill, difficulty)`,
 *  so nailing a hard item raises skill more than nailing an easy one, and fluffing an easy item costs
 *  more. `outcome` accepts the partial score (0..1) or a boolean. When `difficulty` is omitted it
 *  defaults to the current skill → expected == TARGET_SUCCESS, i.e. the original controller. */
export function updateSkill(
  p: Progress,
  topic: string,
  outcome: number | boolean,
  difficulty?: number
): Record<string, number> {
  const o = typeof outcome === "boolean" ? (outcome ? 1 : 0) : clamp(outcome, 0, 1);
  const attempts = p.topics[topic]?.attempts ?? 0;
  const k = Math.max(0.15, 0.5 / (1 + attempts / 20));
  // Cold-start aware: the first answer on an untested topic moves from its correlated estimate.
  const skill = effectiveSkill(p, topic);
  const expected = expectedOutcome(skill, difficulty ?? skill);
  const next = clamp(skill + k * (o - expected), LEVEL_MIN, LEVEL_MAX);
  return { ...p.skill, [topic]: next };
}

// Exercise-type mix by level — recognition first, production later. free-text stays disabled.
// odd-one-out is recognition (fine early); multiple-blanks is mid; order-the-dialog needs cohesion
// (later). Listening joins at every band (comprehension is trained from day one) but the typed
// retelling waits for B1 — writing a summary at A1 is a wall, not practice. Anything at weight 0
// is filtered out before the weighted pick. Exported for tests.
export function typeWeightsForLevel(level: number): Array<[ExerciseType, number]> {
  const cefr = levelToCefr(level);
  if (cefr === "A1" || cefr === "A2") {
    return [
      ["multiple-choice", 40],
      ["match-pairs", 22],
      ["build-the-sentence", 12],
      ["odd-one-out", 16],
      ["tap-the-error", 0],
      ["multiple-blanks", 0],
      ["order-the-dialog", 4],
      ["transform-the-sentence", 0], // production type is B1+ (transforms need a grammar base)
      ["listen-and-answer", 12],
      ["listen-and-retell", 0],
    ];
  }
  if (cefr === "B1") {
    return [
      ["multiple-choice", 20],
      ["match-pairs", 13],
      ["build-the-sentence", 20],
      ["tap-the-error", 14],
      ["odd-one-out", 10],
      ["multiple-blanks", 10],
      ["order-the-dialog", 11],
      ["transform-the-sentence", 10],
      ["listen-and-answer", 12],
      ["listen-and-retell", 6],
    ];
  }
  return [
    ["multiple-choice", 8],
    ["match-pairs", 8],
    ["build-the-sentence", 24],
    ["tap-the-error", 25],
    ["odd-one-out", 6],
    ["multiple-blanks", 11],
    ["order-the-dialog", 14],
    ["transform-the-sentence", 13],
    ["listen-and-answer", 8],
    ["listen-and-retell", 11],
  ];
}

function weightedPick<T>(items: T[], weights: number[]): T {
  // Sanitize weights: a forced/pinned topic absent from TOPIC_PRIORS yields an undefined→NaN weight,
  // which would poison `total` (NaN) and make every `r <= 0` test false, silently always returning the
  // last item. Treat any non-finite or negative weight as 0.
  const safe = items.map((_, i) => (Number.isFinite(weights[i]) && weights[i]! > 0 ? weights[i]! : 0));
  const total = safe.reduce((a, b) => a + b, 0);
  // No positive weight left (all-zero / empty after sanitizing) → fall back to a uniform random pick.
  // Guard the empty-array case so we never index items[-1]/return undefined.
  if (!(total > 0)) {
    return items.length > 0 ? items[Math.floor(Math.random() * items.length)] : (undefined as T);
  }
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= safe[i];
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
  // Stage 2 Planner: per-topic urgency multiplier (server-clamped to 0.5..2; 1 = neutral).
  const plan = p.profile?.planWeights?.[topic] ?? 1;
  return (
    TOPIC_PRIORS[topic] *
    (1 + Math.max(0, TARGET_SUCCESS - acc) * 2) *
    focus *
    plan *
    reviewBoost(p, topic, today)
  );
}

// --- Learner steering ---------------------------------------------------------
// The learner can "correct the teacher": pin a focus topic, mute topics/formats, nudge difficulty.
// All of it flows through `selectNext` as an argument (kept pure/offline-testable), and the empty
// steering (DEFAULT_STEERING) reduces back to the exact legacy behavior.

export const PIN_BOOST = 2.5; // weight multiplier for a learner-pinned focus topic (capped, keeps variety)
export const DIFFICULTY_BIAS_RANGE = 1.0; // max served-level shift (≈ one CEFR band) at |difficultyBias| = 1

/** Topics the course has opened: every mastered unit + the current one (the first unmastered in
 *  syllabus order). Locked units never enter the mix — blocked practice on the current unit first,
 *  interleaving over PASSED material after (the standard blocking→interleaving progression). The
 *  old any-topic roulette read as noise: it drilled rules nobody had presented yet. */
export function unlockedTopics(p: Progress): Set<string> {
  const mastered = new Set(p.course?.mastered ?? []);
  const open = new Set<string>();
  for (const unit of CURRICULUM) {
    open.add(unit.topic);
    if (!mastered.has(unit.topic)) break; // the current unit — everything past it stays locked
  }
  for (const m of mastered) open.add(m); // defensive: out-of-order mastery stays practicable
  return open;
}

/** Pick the next exercise's topic, difficulty (CEFR) and type from the learner model, honoring the
 *  learner's `steering` (pinned focus, muted topics/formats, difficulty bias). Pass `forcedTopic` to
 *  drill a chosen topic (difficulty/type still adapt to its level). */
export function selectNext(
  p: Progress,
  forcedTopic?: string,
  steering?: Steering,
  today: string = isoDay(new Date())
): { topic: string; cefr: Cefr; type: ExerciseType } {
  const all = Object.keys(TOPIC_PRIORS);
  // The mix draws only from course-unlocked topics (mastered + current). A drilled `forcedTopic`
  // below still wins unconditionally, so Review / coach / quest entries into any topic keep working.
  const open = unlockedTopics(p);
  const unlocked = all.filter((t) => open.has(t));
  const pool = unlocked.length > 0 ? unlocked : all;
  // Muted topics drop out of the pool, but the pool is never emptied (mute everything → ignore it).
  const muted = new Set(steering?.mutedTopics ?? []);
  let candidates = pool.filter((t) => !muted.has(t));
  if (candidates.length === 0) candidates = pool;

  const pin = steering?.pinnedFocusTopic;
  const topic =
    forcedTopic && all.includes(forcedTopic)
      ? forcedTopic
      : weightedPick(
          candidates,
          // Over-weight the pinned topic by a capped factor so it surfaces often without starving variety.
          candidates.map((t) => topicWeight(p, t, today) * (pin && t === pin ? PIN_BOOST : 1))
        );

  const level = effectiveSkill(p, topic);
  // Difficulty steer: shift the served level (and thus CEFR + type mix) up/down around the model.
  const bias = clamp(steering?.difficultyBias ?? 0, -1, 1);
  const servedLevel = clamp(level + bias * DIFFICULTY_BIAS_RANGE, LEVEL_MIN, LEVEL_MAX);

  // Format prefs filter the type pool (a format explicitly set false is hidden); never empty the pool.
  const prefs = steering?.formatPrefs ?? {};
  const base = typeWeightsForLevel(servedLevel).filter(([, w]) => w > 0);
  let tw = base.filter(([type]) => prefs[type] !== false);
  if (tw.length === 0) tw = base;
  const type = weightedPick(
    tw.map(([t]) => t),
    tw.map(([, w]) => w)
  );
  return { topic, cefr: levelToCefr(servedLevel), type };
}

/** One learner gesture from the swerve sheet / focus surface. Applied to a Steering slice by the
 *  pure reducer below; the caller decides whether the result persists ("remember") or stays a
 *  session overlay ("just now"). */
export type SwerveAction =
  | { kind: "difficulty"; delta: number } // easier (−) / harder (+)
  | { kind: "pinTopic"; topic: string } // focus here
  | { kind: "muteTopic"; topic: string } // hide this topic
  | { kind: "toggleFormat"; type: ExerciseType | "pronunciation" }; // flip a format/modality on/off

/** Apply one swerve action to a steering slice, returning a new immutable Steering. Pure. */
export function applySteeringAction(base: Steering, action: SwerveAction): Steering {
  switch (action.kind) {
    case "difficulty":
      return { ...base, difficultyBias: clamp(base.difficultyBias + action.delta, -1, 1) };
    case "pinTopic":
      // Pinning a topic also lifts any mute on it (the two intents contradict).
      return {
        ...base,
        pinnedFocusTopic: action.topic,
        mutedTopics: base.mutedTopics.filter((t) => t !== action.topic),
      };
    case "muteTopic":
      return {
        ...base,
        mutedTopics: base.mutedTopics.includes(action.topic)
          ? base.mutedTopics
          : [...base.mutedTopics, action.topic],
        // Muting the pinned topic clears the pin.
        pinnedFocusTopic: base.pinnedFocusTopic === action.topic ? undefined : base.pinnedFocusTopic,
      };
    case "toggleFormat": {
      const on = base.formatPrefs[action.type] !== false; // absent = on
      return { ...base, formatPrefs: { ...base.formatPrefs, [action.type]: !on } };
    }
  }
}
