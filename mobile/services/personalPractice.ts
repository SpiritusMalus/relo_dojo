import { captureAccountScope, isCurrentAccountScope, subscribeAccountScope, type AccountScope } from "../store/accountScope";
import { isCefr, TOPIC_PRIORS } from "../store/adaptive";
import { CHECKPOINT_FORMATS } from "../store/curriculum";
import { deliverGuestExercise } from "../store/guestLimit";
import { mistakeHintsForTopic, type Mistake } from "../store/mistakes";
import { localDate } from "../store/streak";
import { ApiError, getExercise, type Exercise, type ExerciseType } from "./api";

export const PERSONAL_PRACTICE_COUNT = 3;
export const PERSONAL_TEST_COUNT = 3;
export const PERSONAL_TEST_PASS = 2;

const MAX_ATTEMPTS = 3;
const CARD_TIMEOUT_MS = 70_000;
const targetScopes = new WeakMap<PersonalPracticeTarget, AccountScope>();
let requestIndex = Math.floor(Math.random() * 1_000_000_000);

export type PersonalPracticeTarget = { topic: string; level: string; mistakes: readonly Mistake[] };
type Phase = "practice" | "test";

export function isPersonalPracticeTopic(topic: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOPIC_PRIORS, topic);
}

function recentFirst(a: Mistake, b: Mistake): number {
  return String(b.missedAt ?? "").localeCompare(String(a.missedAt ?? ""));
}

export function personalPracticeTargets(
  list: Mistake[],
  fallbackLevel: string,
  requestedTopic?: string,
): PersonalPracticeTarget[] {
  const scope = captureAccountScope();
  const explicit = requestedTopic && isPersonalPracticeTopic(requestedTopic) ? requestedTopic : undefined;
  const groups = new Map<string, { misses: number; items: Mistake[] }>();
  if (explicit) groups.set(explicit, { misses: 0, items: [] });
  for (const mistake of [...list].filter((item) => item?.exercise).sort(recentFirst)) {
    if (!isPersonalPracticeTopic(mistake.topic) || mistake.exercise.topic !== mistake.topic) continue;
    const group = groups.get(mistake.topic) ?? { misses: 0, items: [] };
    group.misses += Number.isFinite(mistake.misses) ? Math.max(1, mistake.misses) : 1;
    group.items.push(mistake);
    groups.set(mistake.topic, group);
  }

  return [...groups.entries()]
    .sort(([topicA, a], [topicB, b]) => {
      if (topicA === explicit) return -1;
      if (topicB === explicit) return 1;
      return b.misses - a.misses || recentFirst(a.items[0], b.items[0]);
    })
    .map(([topic, { items }]) => {
      const level = items.find(({ exercise }) => isCefr(exercise.level))?.exercise.level;
      const target = { topic, level: level ?? (isCefr(fallbackLevel) ? fallbackLevel : "A2"), mistakes: items };
      targetScopes.set(target, scope);
      return target;
    });
}

function words(text: string | undefined): string[] {
  return String(text ?? "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function exampleKeys(exercise: Exercise): string[] {
  // Compare the actual prompts and sentences. Most build/tap cards share a generic instruction,
  // while display order for the tiles and choices is randomized by the server.
  let examples: string[];
  switch (exercise.type) {
    case "build-the-sentence":
    case "transform-the-sentence":
      examples = [exercise.prompt, exercise.tiles?.join(" ")];
      break;
    case "tap-the-error":
      examples = [exercise.tokens?.join(" ") || exercise.text];
      break;
    case "multiple-choice": {
      examples = [exercise.text];
      const gaps = exercise.text?.match(/_{2,}/g);
      if (gaps?.length === 1) {
        for (const choice of exercise.options ?? []) examples.push(exercise.text.replace(/_{2,}/, () => choice));
      }
      break;
    }
    case "multiple-blanks":
    case "free-text":
      examples = [exercise.text, exercise.prompt];
      break;
    default:
      // The generic prompts of match/dialogue/etc. do not identify a standalone example.
      return [];
  }
  return examples.flatMap((example) => {
    const normalized = words(example);
    return normalized.length ? [normalized.sort().join(" ")] : [];
  });
}

function availableFormats(topic: string, phase: Phase): readonly string[] {
  if (phase === "practice") return ["multiple-choice"];
  return CHECKPOINT_FORMATS.filter((format) =>
    !(topic === "word order" && format === "tap-the-error") &&
    !(topic === "punctuation" && format === "build-the-sentence"));
}

function usable(exercise: Exercise, format: ExerciseType): boolean {
  if (exercise?.type !== format || !exercise.token || (exercise.evidence_kind && exercise.evidence_kind !== "topic")) return false;
  switch (format) {
    case "multiple-choice": return !!exercise.text?.trim() && exercise.options?.length >= 2;
    case "build-the-sentence": return !!exercise.prompt?.trim() && exercise.tiles?.length >= 2;
    case "tap-the-error": return exercise.tokens?.length >= 2;
    case "multiple-blanks": {
      const gapCount = exercise.text?.match(/___/g)?.length ?? 0;
      return gapCount > 0 && exercise.blankOptions?.length === gapCount && exercise.blankOptions.every((row) => row.length >= 2);
    }
    default: return false;
  }
}

export async function getPersonalPracticeExercise(
  target: PersonalPracticeTarget,
  phase: Phase,
  seen: readonly Exercise[],
  signal: AbortSignal,
): Promise<Exercise> {
  const scope = targetScopes.get(target) ?? captureAccountScope();
  if (signal.aborted) throw new ApiError("Request cancelled.", 409, "request_aborted");
  if (!isCurrentAccountScope(scope)) throw new ApiError("The signed-in account changed.", 409, "session_changed");
  if (!isPersonalPracticeTopic(target.topic) || !isCefr(target.level)) {
    throw new ApiError("Choose a valid grammar topic and level.", 422, "personal_practice_unavailable");
  }
  const used = new Set([...target.mistakes.map((mistake) => mistake.exercise), ...seen].flatMap(exampleKeys));
  const hints = phase === "practice" ? mistakeHintsForTopic([...target.mistakes], target.topic) : undefined;
  const formats = availableFormats(target.topic, phase);
  const controller = new AbortController();
  let rejectInterruption!: (error: Error) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectInterruption = reject; });
  const interrupt = (error: ApiError) => {
    rejectInterruption(error);
    controller.abort();
  };
  const onAbort = () => interrupt(new ApiError("Request cancelled.", 409, "request_aborted"));
  signal.addEventListener("abort", onAbort, { once: true });
  const unsubscribe = subscribeAccountScope(() =>
    interrupt(new ApiError("The signed-in account changed.", 409, "session_changed")));
  const timer = setTimeout(() =>
    interrupt(new ApiError("The reply is taking longer. Try again.", 0, "learning_timeout")), CARD_TIMEOUT_MS);
  const fetchFreshCard = async (): Promise<Exercise> => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (controller.signal.aborted) return interrupted;
      const format = formats[(seen.length + attempt) % formats.length] as ExerciseType;
      requestIndex = (requestIndex + 1) % 1_000_000_000;
      let exercise: Exercise;
      try {
        exercise = await getExercise({
          topic: target.topic,
          level: target.level,
          type: format,
          mistakes: hints,
          practice_index: requestIndex,
          assessment: phase === "test",
        }, controller.signal);
      } catch (error) {
        if (error instanceof ApiError && error.code === "assessment_unavailable") continue;
        throw error;
      }
      if (controller.signal.aborted) return interrupted;
      if (exercise?.topic === target.topic && exercise.level === target.level &&
        usable(exercise, format) && !exampleKeys(exercise).some((key) => used.has(key))) {
        return exercise;
      }
    }
    throw new ApiError("A fresh exercise is temporarily unavailable.", 503, "personal_practice_unavailable");
  };
  try {
    const exercise = await Promise.race([
      interrupted,
      scope.owner === "guest" ? deliverGuestExercise(localDate(new Date()), fetchFreshCard) : fetchFreshCard(),
    ]);
    if (!exercise) throw new ApiError("Daily exercise limit reached.", 403, "daily_limit");
    return exercise;
  } finally {
    clearTimeout(timer);
    unsubscribe();
    signal.removeEventListener("abort", onAbort);
  }
}
