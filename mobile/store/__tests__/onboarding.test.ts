import {
  GOALS,
  GOAL_PHRASES,
  DEFAULT_SPHERE,
  SOFTWARE_SPHERE,
  ONBOARDING_MAX_LEVEL,
  buildContext,
  calibrationStep,
  capOnboardingLevel,
  selfLevelToLevel,
} from "../onboarding";
import { levelToCefr } from "../adaptive";
import type { Profile } from "../progress";

// Locks in the "English for IT relocation" niche defaults (NICHE_PIVOT_IT_RELOCATION.md):
// IT sphere pre-selected, the interview → relocation_life → work_comms arc present, and the
// new goal phrases actually flowing into the generation context hint.
describe("IT-relocation niche onboarding defaults", () => {
  test("default sphere is Software & IT (reversible niche default)", () => {
    expect(DEFAULT_SPHERE).toBe(SOFTWARE_SPHERE);
    expect(DEFAULT_SPHERE).toBe("Software & IT");
  });

  test("goal set carries the relocation arc, every goal has a generation phrase", () => {
    const ids = GOALS.map((g) => g.id);
    expect(ids).toEqual(
      expect.arrayContaining(["interviews", "relocation_life", "work_comms"])
    );
    for (const id of ids) expect(GOAL_PHRASES[id]).toBeTruthy();
  });

  test("buildContext threads the new goal phrases into the hint", () => {
    const profile: Profile = {
      goals: ["relocation_life", "work_comms"],
      focusTopics: [],
      selfLevel: "intermediate",
      dailyMinutes: 10,
      sphere: "Software & IT",
      domains: ["backend"],
      painText: "",
      tone: "balanced",
    };
    const ctx = buildContext(profile);
    expect(ctx).toContain("Software & IT — backend");
    expect(ctx).toContain("settling in abroad");
    expect(ctx).toContain("everyday work communication");
  });

  test("buildContext never exceeds the 300-char server cap, even with every goal + a long field", () => {
    const profile: Profile = {
      goals: GOALS.map((g) => g.id), // all goals → many long phrases (the journey arc included)
      focusTopics: [],
      selfLevel: "advanced",
      dailyMinutes: 60,
      sphere: "Science & engineering",
      domains: ["backend", "frontend", "data / ML", "devops", "security", "embedded"],
      painText: "",
      tone: "balanced",
    };
    const ctx = buildContext(profile, () => 0);
    expect(ctx.length).toBeLessThanOrEqual(300);
    expect(ctx).toContain("Science & engineering"); // the most specific part is preserved
  });
});

// Placement objectivity (REVIEW-2026-06-28-cefr-overestimation): a short 10-item MCQ must not award
// C1 off "advanced + a couple of mistakes". Three levers: decaying step, B2 cap, lower self-seed.
describe("onboarding placement is conservative (no C1 over-estimation)", () => {
  // Mirror the calibration loop in app/onboarding.tsx so the math is pinned without the React UI.
  function simulate(selfLevel: string, answers: boolean[]): number {
    let level = selfLevelToLevel(selfLevel);
    answers.forEach((correct, count) => {
      const step = calibrationStep(count);
      level = Math.min(5, Math.max(0, level + (correct ? step : -step)));
    });
    return capOnboardingLevel(level);
  }

  test("calibrationStep decays with evidence and floors at 0.2 (never a whole CEFR band)", () => {
    expect(calibrationStep(0)).toBeCloseTo(0.6); // first item: moderate
    expect(calibrationStep(3)).toBeCloseTo(0.3); // mid: smaller
    expect(calibrationStep(0)).toBeLessThan(1); // a single answer is < one CEFR band of swing
    expect(calibrationStep(9)).toBe(0.2); // late items: floored, fine-tuning only
    expect(calibrationStep(0)).toBeGreaterThan(calibrationStep(5)); // monotonic decay
  });

  test("capOnboardingLevel keeps placement inside B2 (levelToCefr never C1)", () => {
    expect(capOnboardingLevel(5)).toBe(ONBOARDING_MAX_LEVEL);
    expect(levelToCefr(capOnboardingLevel(5))).toBe("B2");
    expect(capOnboardingLevel(2.5)).toBe(2.5); // below the cap: unchanged
  });

  test("self-assessment seed is down-weighted: 'advanced' starts at B1, not inside B2", () => {
    expect(selfLevelToLevel("advanced")).toBe(2.8);
    expect(levelToCefr(selfLevelToLevel("advanced"))).toBe("B1");
  });

  test("'advanced' self-select with a couple of mistakes does NOT reach C1 (the owner's exact case)", () => {
    const answers = [true, true, false, true, true, true, false, true, true, true]; // 8/10
    expect(levelToCefr(simulate("advanced", answers))).not.toBe("C1");
  });

  test("even a flawless 10/10 run from any start caps at B2 out of onboarding", () => {
    const perfect = Array(10).fill(true);
    for (const self of ["beginner", "intermediate", "advanced"]) {
      expect(levelToCefr(simulate(self, perfect))).toBe("B2");
    }
  });

  test("weak performance still places low (the controller works downward too)", () => {
    const mostlyWrong = [false, false, false, true, false, false, false, false, false, false]; // 1/10
    expect(simulate("advanced", mostlyWrong)).toBeLessThan(selfLevelToLevel("advanced"));
  });
});
