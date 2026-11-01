// Shared check → grade → record flow for a single exercise card.
//
// Both the Practice screen and the mini-Story screen render an ExerciseCard and need the exact same
// behavior on "Check": grade the answer (deterministic /check or LLM /check-answer), feed the
// difficulty-aware skill signal, award XP/streak via recordAnswer, and detect a per-topic CEFR
// level-up. Keeping it here means the two screens can't drift apart.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  checkFreeText,
  checkInteractive,
  checkRetell,
  explain,
  explainStream,
  type Exercise,
  type ExplainResult,
  type ResponseValue,
} from "../services/api";
import { useProgress, type Progress } from "./progress";
import { useWallet } from "./wallet";
import { cefrMidpoint, effectiveSkill, isCefr, levelToCefr } from "./adaptive";
import { captureMistake } from "./mistakes";
import { AttemptClock, exerciseAttemptKey, expectedSolveMs } from "./answerAttempt";

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
  /** Local-only snapshot, already updated when check resolves (never sent to the API). */
  progressAfter?: Progress;
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
  const foreground = useRef(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const attemptRef = useRef<{ key: string | null; clock: AttemptClock | null; inFlight: boolean; complete: boolean }>({ key: null, clock: null, inFlight: false, complete: false });

  // Call when the card becomes visible, rather than when a slow fetch begins.
  const beginAttempt = useCallback((exercise: Exercise) => {
    const key = exerciseAttemptKey(exercise);
    if (attemptRef.current.key === key) return;
    attemptRef.current = { key, clock: new AttemptClock(Date.now, foreground.current), inFlight: false, complete: false };
  }, []);
  const markHintUsed = useCallback(() => {
    if (attemptRef.current.clock && !attemptRef.current.complete) attemptRef.current.clock.hintUsed = true;
  }, []);
  // check() / doExplain() setState after an await; if the screen unmounts mid-request, gate the
  // setters so we don't update an unmounted component.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    const sub = AppState.addEventListener("change", (state) => {
      foreground.current = state === "active";
      const attempt = attemptRef.current;
      if (foreground.current && !attempt.inFlight && !attempt.complete) attempt.clock?.resume();
      else attempt.clock?.pause();
    });
    return () => {
      isMounted.current = false;
      attemptRef.current.clock?.pause();
      sub.remove();
    };
  }, []);

  // Grade `response` for `exercise`, record the answer, and return the result (or null on error).
  // `onWrong` lets the caller trigger UI feedback (e.g. a shake) without re-deriving correctness.
  const check = useCallback(
    async (exercise: Exercise, response: ResponseValue, onWrong?: () => void): Promise<Result | null> => {
      const key = exerciseAttemptKey(exercise);
      if (attemptRef.current.key !== key) {
        // Legacy callers can still grade without measuring timing until they wire beginAttempt.
        attemptRef.current = { key, clock: null, inFlight: false, complete: false };
      }
      const attempt = attemptRef.current;
      // React's checking state updates one render later. A ref closes the double-tap/StrictMode race,
      // and a completed card cannot award XP or affect ability a second time.
      if (attempt.inFlight || attempt.complete) return null;
      attempt.inFlight = true;
      attempt.clock?.pause();
      const effort = attempt.clock ? {
        elapsedMs: attempt.clock.elapsedMs(),
        expectedMs: expectedSolveMs(exercise),
        hintUsed: attempt.clock.hintUsed,
      } : {};
      setChecking(true);
      setError(null);
      try {
        // Retell rides its own LLM endpoint (content-coverage rubric + the sealed passage);
        // every other tokened type grades deterministically; tokenless free-text goes to the LLM.
        const res: Result =
          exercise.type === "listen-and-retell" && exercise.token
            ? await checkRetell(exercise.token, String(response))
            : exercise.token
            ? await checkInteractive(exercise.token, response)
            : await checkFreeText(exercise.text, String(response));
        if (!isMounted.current || attemptRef.current !== attempt) return null;
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
        // Detect a CEFR level-up from the actual committed snapshot, keeping hints/timing consistent
        // with the model update and with the next card's immediate selection.
        const before = effectiveSkill(progressRef.current, exercise.topic);
        // `format` feeds the course mastery evidence: constructive formats weigh more than
        // guessable ones (store/curriculum.ts).
        const progressAfter = recordAnswer(exercise.topic, res.correct, { score: res.score, difficulty: servedDifficulty, format: exercise.type, ...effort });
        progressRef.current = progressAfter;
        attempt.complete = true;
        const committed = { ...res, progressAfter };
        setResult(committed);
        const after = effectiveSkill(progressAfter, exercise.topic);
        if (after > before && levelToCefr(after) !== levelToCefr(before)) {
          setLevelUp(levelToCefr(after));
        }
        return committed;
      } catch (e) {
        if (isMounted.current && attemptRef.current === attempt) {
          setError(e instanceof Error ? e.message : "Failed to check answer");
          // Network wait did not measure the learner. A retry may include more thinking time.
          if (foreground.current) attempt.clock?.resume();
        }
        return null;
      } finally {
        attempt.inFlight = false;
        if (isMounted.current && attemptRef.current === attempt) setChecking(false);
      }
    },
    [recordAnswer, applyCheckReward]
  );

  // On-demand teaching note for an interactive miss. Streams token-by-token (/explain/stream) so the
  // note appears as it's written; on any stream failure (old server, network, "unavailable") it falls
  // back to the one-shot structured /explain so the feature degrades, never breaks.
  const doExplain = useCallback(async (exercise: Exercise, responseDisplay: string) => {
    if (!result || explainLoading || explainAbort.current) return;
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
          if (!isMounted.current) return; // screen gone mid-stream — stop updating state
          // First token in: drop the spinner and start showing the growing note.
          if (!started) {
            started = true;
            setExplainLoading(false);
          }
          setExplained({ explanation: full, tip: "" });
        },
        controller.signal
      );
      if (isMounted.current) setExplained({ explanation: finalText, tip: "" });
    } catch (e) {
      if (controller.signal.aborted) return; // cancelled by the next card — stay silent
      try {
        const note = await explain(exercise.text, correct, responseDisplay);
        if (isMounted.current) setExplained(note);
      } catch (e2) {
        if (isMounted.current) setError(e2 instanceof Error ? e2.message : "Failed to explain");
      }
    } finally {
      if (explainAbort.current === controller) explainAbort.current = null;
      if (isMounted.current) setExplainLoading(false);
    }
  }, [result, explainLoading]);

  // Clear all per-card state before showing the next exercise.
  const reset = useCallback(() => {
    attemptRef.current.clock?.pause();
    attemptRef.current = { key: null, clock: null, inFlight: false, complete: false };
    explainAbort.current?.abort();
    explainAbort.current = null;
    setResult(null);
    setError(null);
    setLevelUp(null);
    setExplained(null);
    setChecking(false);
    setExplainLoading(false);
  }, []);

  return { result, checking, error, levelUp, explained, explainLoading, check, doExplain, reset, setError, beginAttempt, markHintUsed };
}
