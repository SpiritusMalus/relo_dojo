// Shared promotion evidence for both the Home meter and exam eligibility. No runtime imports from
// progress/dojo/exam: these read the same thresholds without a circular dependency.
import { CURRICULUM } from "./curriculum";

export const PROMOTION_MIN_ATTEMPTS = 10;
export const PROMOTION_MIN_CORRECT = 8;

export function practiceEligibilityFraction(p: {
  topics: Record<string, { attempts: number; correct: number }>;
}): number {
  let attempts = 0;
  let correct = 0;
  for (const { topic } of CURRICULUM) {
    const stat = p.topics[topic];
    const n = Number.isFinite(stat?.attempts) ? Math.max(0, stat.attempts) : 0;
    attempts += n;
    correct += Number.isFinite(stat?.correct) ? Math.min(n, Math.max(0, stat.correct)) : 0;
  }
  return Math.min(1, attempts / PROMOTION_MIN_ATTEMPTS, correct / PROMOTION_MIN_CORRECT);
}
