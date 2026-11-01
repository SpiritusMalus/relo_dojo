import type { Exercise } from "../services/api";

/** A pauseable foreground-only clock. API latency, background time and feedback never measure
 *  learner ability. The clock freezes on submit and resumes only when grading failed. */
export class AttemptClock {
  private elapsed = 0;
  private since: number | null;
  hintUsed = false;

  constructor(private now: () => number = Date.now, active = true) {
    this.since = active ? now() : null;
  }

  pause(): void {
    if (this.since !== null) this.elapsed += Math.max(0, this.now() - this.since);
    this.since = null;
  }

  resume(): void {
    if (this.since === null) this.since = this.now();
  }

  elapsedMs(): number {
    return Math.min(600_000, this.elapsed + (this.since === null ? 0 : Math.max(0, this.now() - this.since)));
  }
}

/** A generous effort reference, not a response deadline. Longer passages and constructive formats
 *  naturally need more time. A slow correct answer keeps at least 80% of its positive signal. */
export function expectedSolveMs(exercise: Exercise): number {
  const words = [exercise.text, exercise.speak, exercise.instruction].filter(Boolean).join(" ").split(/\s+/).length;
  const constructive = ["build-the-sentence", "transform-the-sentence", "multiple-blanks", "order-the-dialog", "listen-and-retell", "free-text"].includes(exercise.type);
  return Math.min(180_000, (constructive ? 35_000 : 18_000) + words * 700);
}

export function exerciseAttemptKey(exercise: Exercise): string {
  return exercise.token ?? JSON.stringify([exercise.type, exercise.topic, exercise.level, exercise.text, exercise.options]);
}
