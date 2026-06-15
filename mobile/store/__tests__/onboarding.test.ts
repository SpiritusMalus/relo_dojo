import {
  GOALS,
  GOAL_PHRASES,
  DEFAULT_SPHERE,
  SOFTWARE_SPHERE,
  buildContext,
} from "../onboarding";
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
