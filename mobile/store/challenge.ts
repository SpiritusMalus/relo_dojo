// Daily Challenge — pure scoring + best-score persistence.
//
// The Challenge is a timed run: answer as many cards as you can before the clock runs out. Correct
// answers build a combo that multiplies the points of the next one; a miss resets the combo. This
// module holds the pure scoring math (easy to unit-test) and a tiny AsyncStorage record of the best
// score. Answers still flow through useExerciseCheck, so XP / streak / the adaptive model update
// exactly as in normal practice — only the headline "score" and "best" are challenge-local.
import AsyncStorage from "@react-native-async-storage/async-storage";

export const CHALLENGE_SECONDS = 60;
export const BASE_POINTS = 10;
export const MAX_MULTIPLIER = 5;

// Multiplier applied to the *next* answer given the current combo (consecutive corrects so far).
// 1× at combo 0, +1× per consecutive correct, capped so it can't run away.
export function comboMultiplier(combo: number): number {
  return Math.min(1 + Math.max(0, combo), MAX_MULTIPLIER);
}

export type ScoreStep = { points: number; combo: number; multiplier: number };

// Score one answer. `fraction` (0..1) carries partial credit for multi-element types so a near-miss
// still scores something but does NOT extend the combo (only a fully-correct answer does).
export function scoreAnswer(combo: number, correct: boolean, fraction = 1): ScoreStep {
  if (!correct && fraction <= 0) return { points: 0, combo: 0, multiplier: comboMultiplier(0) };
  const multiplier = comboMultiplier(combo);
  const points = Math.round(BASE_POINTS * multiplier * (correct ? 1 : fraction));
  // Only a clean answer keeps the combo alive; partial credit scores but breaks the streak.
  return { points, combo: correct ? combo + 1 : 0, multiplier };
}

const BEST_KEY = "relo_dojo/challenge-best/v1";

export async function loadBestScore(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(BEST_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// Persist `score` if it beats the stored best. Returns the best score after the write and whether it
// was a new record, so the summary screen can celebrate a personal best.
export async function recordBestScore(score: number): Promise<{ best: number; isRecord: boolean }> {
  const prev = await loadBestScore();
  if (score <= prev) return { best: prev, isRecord: false };
  try {
    await AsyncStorage.setItem(BEST_KEY, String(score));
  } catch {
    // best-effort; an unsaved record just won't persist
  }
  return { best: score, isRecord: true };
}
