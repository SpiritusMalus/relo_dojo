import { SCENARIO_PACKS, JOURNEY_GOALS, pickScenario } from "../scenarioPacks";
import { buildContext } from "../onboarding";
import type { Profile } from "../progress";

// Task 4 content packs: curated journey scenarios that ride the generation `context` string.
describe("journey scenario packs", () => {
  test("every journey goal has a non-empty pack", () => {
    for (const g of JOURNEY_GOALS) {
      expect((SCENARIO_PACKS[g] ?? []).length).toBeGreaterThan(0);
    }
  });

  test("no journey goal selected → null (generic fallback)", () => {
    expect(pickScenario([])).toBeNull();
    expect(pickScenario(["emails", "travel"])).toBeNull();
    expect(pickScenario(null)).toBeNull();
    expect(pickScenario(undefined)).toBeNull();
  });

  test("returns a member of the selected stage's pack (rng=0 → first)", () => {
    const s = pickScenario(["work_comms"], () => 0);
    expect(SCENARIO_PACKS.work_comms).toContain(s);
    expect(s).toBe(SCENARIO_PACKS.work_comms[0]);
  });

  test("rng near 1 stays in-bounds → last item, never undefined", () => {
    const s = pickScenario(["interviews"], () => 0.999999);
    const pack = SCENARIO_PACKS.interviews;
    expect(s).toBe(pack[pack.length - 1]);
  });

  test("with several stages selected, rng=0 picks the first (input order)", () => {
    const s = pickScenario(["work_comms", "relocation_life"], () => 0);
    expect(s).toBe(SCENARIO_PACKS.work_comms[0]);
  });
});

describe("buildContext weaves the journey scenario", () => {
  const base: Profile = {
    goals: ["work_comms"],
    focusTopics: [],
    selfLevel: "intermediate",
    dailyMinutes: 10,
    sphere: "Software & IT",
    domains: ["backend"],
    painText: "",
    tone: "balanced",
  };

  test("appends a curated scenario when a journey goal is set (seeded, within cap)", () => {
    const ctx = buildContext(base, () => 0);
    expect(ctx).toContain("e.g. giving a daily standup update");
    expect(ctx.length).toBeLessThanOrEqual(300);
  });

  test("no scenario when no journey goal is selected", () => {
    const ctx = buildContext({ ...base, goals: ["emails"] }, () => 0);
    expect(ctx).not.toContain("e.g.");
    expect(ctx).toContain("goals: writing emails and messages");
  });
});
