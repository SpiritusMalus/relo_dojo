// Shared check → grade → record flow for a single exercise card.
//
// Both the Practice screen and the mini-Story screen render an ExerciseCard and need the exact same
// behavior on "Check": grade the answer (deterministic /check or LLM /check-answer), feed the
// difficulty-aware skill signal, award XP/streak via recordAnswer, and detect a per-topic CEFR
// level-up. Keeping it here means the two screens can't drift apart.
import { useCallback, useRef, useState } from "react";
import {
  checkFreeText,
  checkInteractive,
  explain,
  explainStream,
  type Exercise,
  type ExplainResult,
  type ResponseValue,
} from "../services/api";
import { useProgress } from "./progress";
import { useWallet } from "./wallet";
import { cefrMidpoint, effectiveSkill, isCefr, levelToCefr, updateSkill } from "./adaptive";
import { captureMistake } from "./mistakes";

export type Result = {
  correct: boolean;
  correct_answer: string;
  score?: number;
  detail?: string;
  per_item?: boolean[]; // per-element marks in display order (match rows, blanks, dialog lines)
  explanation?: string;
  tip?: string;
  coins_earned?: number; // koku earned (authenticated + correct only)
  coins?: number | null; // new server koku balance after the award
  first_win_bonus?: number; // once-per-day first-win bonus included in coins_earned
  combo_bonus?: number; // consecutive-correct combo bonus included in coins_earned
};

export function useExerciseCheck() {
  const { progress, recordAnswer } = useProgress();
  const { applyCheckReward } = useWallet();
  // Latest progress for selecting/grading without stale closures.
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const [result, setResult] = useState<Result | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelUp, setLevelUp] = useState<string | null>(null);
  const [explained, setExplained] = useState<ExplainResult | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  // In-flight explanation stream, so a new card (reset) can cancel a half-streamed note.
  const explainAbort = useRef<AbortController | null>(null);

  // Grade `response` for `exercise`, record the answer, and return the result (or null on error).
  // `onWrong` lets the caller trigger UI feedback (e.g. a shake) without re-deriving correctness.
  const check = useCallback(
    async (exercise: Exercise, response: ResponseValue, onWrong?: () => void): Promise<Result | null> => {
      setChecking(true);
      setError(null);
      try {
        const res: Result = exercise.token
          ? await checkInteractive(exercise.token, response)
          : await checkFreeText(exercise.text, String(response));
        setResult(res);
        // Koku earned server-side on a correct answer — patch the cached wallet balance.
        applyCheckReward(res.coins);
        if (!res.correct) {
          onWrong?.();
          // Remember the exact missed item so it can be resurfaced in Review (fire-and-forget).
          void captureMistake(exercise);
        }
        // Difficulty-aware skill signal: partial score + the difficulty of the served item.
        const fallback = cefrMidpoint(levelToCefr(effectiveSkill(progressRef.current, exercise.topic)));
        const servedDifficulty = isCefr(exercise.level) ? cefrMidpoint(exercise.level) : fallback;
        const outcome = res.score ?? (res.correct ? 1 : 0);
        // Detect a CEFR level-up for this topic (compute the would-be new level before state updates).
        const before = effectiveSkill(progressRef.current, exercise.topic);
        const after = updateSkill(progressRef.current, exercise.topic, outcome, servedDifficulty)[exercise.topic];
        recordAnswer(exercise.topic, res.correct, { score: res.score, difficulty: servedDifficulty });
        if (after > before && levelToCefr(after) !== levelToCefr(before)) {
          setLevelUp(`${exercise.topic} is now ${levelToCefr(after)}`);
        }
        return res;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to check answer");
        return null;
      } finally {
        setChecking(false);
      }
    },
    [recordAnswer, applyCheckReward]
  );

  // On-demand teaching note for an interactive miss. Streams token-by-token (/explain/stream) so the
  // note appears as it's written; on any stream failure (old server, network, "unavailable") it falls
  // back to the one-shot structured /explain so the feature degrades, never breaks.
  const doExplain = useCallback(async (exercise: Exercise, responseDisplay: string) => {
    if (!result || explainLoading) return;
    setExplainLoading(true);
    const correct = result.correct_answer;
    const controller = new AbortController();
    explainAbort.current = controller;
    try {
      let started = false;
      const finalText = await explainStream(
        exercise.text,
        correct,
        responseDisplay,
        (full) => {
          // First token in: drop the spinner and start showing the growing note.
          if (!started) {
            started = true;
            setExplainLoading(false);
          }
          setExplained({ explanation: full, tip: "" });
        },
        controller.signal
      );
      setExplained({ explanation: finalText, tip: "" });
    } catch (e) {
      if (controller.signal.aborted) return; // cancelled by the next card — stay silent
      try {
        setExplained(await explain(exercise.text, correct, responseDisplay));
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : "Failed to explain");
      }
    } finally {
      if (explainAbort.current === controller) explainAbort.current = null;
      setExplainLoading(false);
    }
  }, [result, explainLoading]);

  // Clear all per-card state before showing the next exercise.
  const reset = useCallback(() => {
    explainAbort.current?.abort();
    explainAbort.current = null;
    setResult(null);
    setError(null);
    setLevelUp(null);
    setExplained(null);
  }, []);

  return { result, checking, error, levelUp, explained, explainLoading, check, doExplain, reset, setError };
}
