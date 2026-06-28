// Adaptive Level Test (CAT-lite) — the full, retakeable English placement.
//
// Unlike the short onboarding calibration (capped at B2 because 10 items is weak evidence; see
// store/onboarding.ts), this gathers enough evidence to place objectively across the whole range and
// CAN reach C1. Pure + offline: items come from the curated CALIBRATION_BANK (graded locally against
// the known answer — no LLM, no network).
//
// Method: an up-down STAIRCASE. Serve the unused bank item nearest the current estimate θ; a correct
// answer steps θ up, a wrong one steps it down, with the step shrinking as evidence accumulates. On a
// pure winning streak θ keeps climbing (so a strong learner reaches C1); once the learner both passes
// and fails around θ, the estimate has bracketed their true level and the test stops. (A target-success
// controller like adaptive.ts would instead converge to the 75%-success point, never the ceiling —
// wrong for placement, right for ongoing practice.)
import { pickItem, type CalItem, type CalSkill } from "./calibrationBank";
import { levelToCefr, START_LEVEL, type Cefr } from "./adaptive";
import { beltByCefr } from "../theme/theme";

export const LT_MIN_ITEMS = 8; // never decide on fewer than this — placement needs evidence
export const LT_MAX_ITEMS = 16; // hard ceiling so the test always terminates
const BRACKET_WINDOW = 4; // look at the last N answers to detect that θ has bracketed the boundary

// The test rotates through these skills so the placement reflects more than grammar (each is sampled
// roughly evenly). "listening" joins once TTS lands; "writing" is a separate LLM-scored section.
const SKILL_ROTATION: CalSkill[] = ["grammar", "vocab", "reading"];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Step size for the n-th answer (0-based): starts ~0.7 of a band, decays toward a 0.25 floor so the
 *  estimate moves decisively early and fine-tunes late. */
export function levelTestStep(answered: number): number {
  return Math.max(0.25, 0.7 / (1 + Math.max(0, answered) / 4));
}

export type LevelTestState = {
  theta: number; // ability estimate on the 0..5 skill scale (same scale as adaptive.ts)
  answered: number;
  used: Set<string>;
  recent: boolean[]; // last few outcomes — drives the bracket/stop rule
};

/** Begin a test. `seed` is the starting ability (e.g. the learner's current overall skill, or
 *  START_LEVEL for a fresh account) — the staircase converges regardless, it just starts nearer. */
export function startLevelTest(seed: number = START_LEVEL): LevelTestState {
  return { theta: clamp(seed, 0, 5), answered: 0, used: new Set(), recent: [] };
}

/** The next item to serve: rotate to the next skill (for balanced coverage) and pick the unused item
 *  of that skill closest to the current θ; if that skill is exhausted, fall back to any skill. */
export function nextItem(s: LevelTestState): CalItem | null {
  const skill = SKILL_ROTATION[s.answered % SKILL_ROTATION.length];
  return pickItem(s.theta, s.used, skill) ?? pickItem(s.theta, s.used);
}

/** Fold one graded answer into the estimate (up-down staircase with a decaying step). */
export function recordAnswer(s: LevelTestState, item: CalItem, correct: boolean): LevelTestState {
  const step = levelTestStep(s.answered);
  const theta = clamp(s.theta + (correct ? step : -step), 0, 5);
  const used = new Set(s.used);
  used.add(item.id);
  return {
    theta,
    answered: s.answered + 1,
    used,
    recent: [...s.recent, correct].slice(-BRACKET_WINDOW),
  };
}

/** Whether the test should end: hit the cap, ran out of items, or θ has bracketed the learner's level
 *  (the recent window contains both a pass and a miss → we're oscillating around their boundary). */
export function isDone(s: LevelTestState): boolean {
  if (s.answered >= LT_MAX_ITEMS) return true;
  if (pickItem(s.theta, s.used) === null) return true; // bank exhausted (safety net)
  if (s.answered < LT_MIN_ITEMS) return false;
  const w = s.recent;
  return w.length >= BRACKET_WINDOW && w.some((c) => c) && w.some((c) => !c);
}

export type LevelTestResult = { level: number; cefr: Cefr; beltIdx: number };

/** The placement to apply: the raw ability (seeds skill, uncapped → can be C1), its CEFR, and the
 *  belt index it earns. This is the path that lifts the onboarding B2 cap. */
export function levelTestResult(s: LevelTestState): LevelTestResult {
  const cefr = levelToCefr(s.theta);
  return { level: s.theta, cefr, beltIdx: beltByCefr(cefr).idx };
}

/** Fold the writing-section score (0..5, from /assess-writing) into the receptive estimate. The
 *  receptive MCQ section gets ~double weight (many more items than the single writing task). */
export function combineLevels(receptive: number, writing: number): LevelTestResult {
  const level = clamp((2 * receptive + writing) / 3, 0, 5);
  const cefr = levelToCefr(level);
  return { level, cefr, beltIdx: beltByCefr(cefr).idx };
}
