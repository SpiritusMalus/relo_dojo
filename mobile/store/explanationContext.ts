import type { Exercise } from "../services/api";

const MAX_CONTEXT = 2000;
type VisibleValue = string | string[] | string[][];

/** Post-grade teaching context only: whitelist public task fields, never serialize the sealed key. */
export function explanationContext(exercise: Exercise): string {
  const context: Record<string, VisibleValue> = { type: exercise.type, topic: exercise.topic };
  for (const field of ["text", "prompt", "instruction", "anchor"] as const) {
    if (exercise[field]?.trim()) context[field] = exercise[field]!;
  }
  for (const field of ["options", "tokens"] as const) {
    if (exercise[field]?.length) context[field] = exercise[field];
  }
  if (exercise.tiles?.length || exercise.distractors?.length) {
    // Build/transform mix these in one visible bank. Do not reveal which tiles are traps.
    const bank = [...(exercise.tiles ?? []), ...(exercise.distractors ?? [])];
    context.tiles = exercise.type === "build-the-sentence" || exercise.type === "transform-the-sentence"
      ? bank.sort() : bank;
  }
  for (const field of ["left", "right"] as const) {
    if (exercise[field]?.length) context[field] = exercise[field].map((item) => item.text);
  }
  if (exercise.blankOptions?.length) context.blankOptions = exercise.blankOptions;
  if ((exercise.type === "listen-and-answer" || exercise.type === "listen-and-retell") && exercise.speak?.trim()) {
    context.speak = exercise.speak;
  }

  const full = JSON.stringify(context);
  if (full.length <= MAX_CONTEXT) return full;
  // Share a character cap across every string, so a long passage cannot crowd out the options
  // or one side of a matching task. Preserve list boundaries and item counts when shortening.
  function serialize(cap: number): string {
    return JSON.stringify(context, (_key, value: unknown) => typeof value === "string" && value.length > cap
      ? value.slice(0, Math.max(0, cap - 1)) + (cap ? "…" : "") : value);
  }
  let low = 0;
  let high = MAX_CONTEXT;
  if (serialize(0).length > MAX_CONTEXT) {
    // Defensive bound for malformed, oversized lists; make the missing context explicit.
    const marker = " [context truncated]";
    return full.slice(0, MAX_CONTEXT - marker.length) + marker;
  }
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (serialize(mid).length <= MAX_CONTEXT) low = mid;
    else high = mid - 1;
  }
  return serialize(low);
}
