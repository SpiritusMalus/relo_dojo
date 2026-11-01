import { DEFAULT_PROGRESS, type Progress } from "../progress";
import { beltProgress, hasEvidence } from "../dojo";
import { examOffer } from "../exam";
import { TOPIC_PRIORS } from "../adaptive";
import { practiceEligibilityFraction } from "../promotion";

function learner(attempts: number, correct: number, level = 2.5): Progress {
  return { ...DEFAULT_PROGRESS, onboarded: true, beltEarned: 0,
    topics: { "word order": { attempts, correct } },
    skill: Object.fromEntries(Object.keys(TOPIC_PRIORS).map((topic) => [topic, level])),
  };
}

it("two real successes show only 20% practice readiness despite an advanced placement seed", () => {
  const p = learner(2, 2, 4.5);
  expect(beltProgress(p).pctToNext).toBe(20);
  expect(examOffer(p)).toBeNull();
});

it("Home's 100% threshold and the exam gate are the same real 10/8 requirement", () => {
  expect(beltProgress(learner(9, 9)).pctToNext).toBe(90);
  expect(examOffer(learner(9, 9))).toBeNull();
  expect(beltProgress(learner(10, 7)).pctToNext).toBe(88);
  expect(examOffer(learner(10, 7))).toBeNull();
  expect(beltProgress(learner(10, 8)).pctToNext).toBe(100);
  expect(examOffer(learner(10, 8))).toEqual({ target: 1, confirm: false });
});

it("uses the smaller of skill and practice progress and preserves earned belts", () => {
  const p = { ...learner(10, 8, 2.2), beltEarned: 2 };
  expect(beltProgress(p).pctToNext).toBe(20);
  expect(examOffer(p)).toBeNull();
  expect(beltProgress({ ...p, beltEarned: 3 }).belt.idx).toBe(3);
});

it("a server null means no earned exam, never zero-attempt evidence or a fabricated full bar", () => {
  const p = { ...learner(0, 0), beltEarned: null } as unknown as Progress;
  expect(hasEvidence(p)).toBe(false);
  expect(beltProgress(p).pctToNext).toBe(0);
  expect(beltProgress({ ...p, topics: learner(2, 2).topics }).pctToNext).toBe(20);
});

it("does not credit unknown pseudo-topics as promotion practice", () => {
  expect(practiceEligibilityFraction({ topics: { placement: { attempts: 100, correct: 100 } } })).toBe(0);
});
