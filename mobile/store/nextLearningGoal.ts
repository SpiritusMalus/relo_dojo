import type { Progress } from "./progress";
import { CURRICULUM, masteryOf } from "./curriculum";
import { weakestTopic } from "./greeting";
import { dueMistakes, nextDueAt, type Mistake } from "./mistakes";

export type LearningGoal = {
  kind: "review" | "checkpoint" | "course" | "weak" | "mix";
  topic?: string;
  dueCount: number;
  nextReviewAt: string | null;
};

/** A recommendation over existing evidence. It never grants progress, changes a schedule or
 * treats placement/XP as an earned unit. The first unpassed unit is the course's actual gate. */
export function nextLearningGoal(progress: Progress, mistakes: Mistake[], now: string): LearningGoal {
  const due = dueMistakes(mistakes, now);
  const base = { dueCount: due.length, nextReviewAt: nextDueAt(mistakes, now) };
  if (due.length) return { ...base, kind: "review", topic: due[0].topic };
  const unit = CURRICULUM.find((candidate) => !(progress.course?.mastered ?? []).includes(candidate.topic));
  if (unit) {
    return {
      ...base,
      kind: masteryOf(progress.course?.history[unit.topic]).met ? "checkpoint" : "course",
      topic: unit.topic,
    };
  }
  const weak = weakestTopic(progress);
  return weak ? { ...base, kind: "weak", topic: weak } : { ...base, kind: "mix" };
}

export function learningGoalRoute(goal: LearningGoal): { pathname: "/review" | "/checkpoint" | "/practice"; params?: { topic: string } } {
  if (goal.kind === "review") return { pathname: "/review" };
  if (goal.kind === "checkpoint" && goal.topic) return { pathname: "/checkpoint", params: { topic: goal.topic } };
  return goal.topic ? { pathname: "/practice", params: { topic: goal.topic } } : { pathname: "/practice" };
}
