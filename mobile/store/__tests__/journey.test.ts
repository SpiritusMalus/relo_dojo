import {
  JOURNEY_STAGES,
  STAGE_GOAL,
  SUGGEST_ADVANCE_AFTER,
  stageFromGoals,
  nextStage,
  isLastStage,
  countSession,
  advance,
  shouldSuggestAdvance,
  hasJourneyGoal,
  defaultJourney,
  type JourneyState,
} from "../journey";
import { buildContext } from "../onboarding";
import { pickScenario, SCENARIO_PACKS } from "../scenarioPacks";
import type { Profile } from "../progress";

// Retention feature: the relocation arc (pre-move → arrived → settled) drives content + a nudge.
describe("relocation journey engine", () => {
  test("stageFromGoals: none → pre_move; maps each goal; earliest-in-arc wins", () => {
    expect(stageFromGoals([])).toBe("pre_move");
    expect(stageFromGoals(["emails"])).toBe("pre_move");
    expect(stageFromGoals(["interviews"])).toBe("pre_move");
    expect(stageFromGoals(["relocation_life"])).toBe("arrived");
    expect(stageFromGoals(["work_comms"])).toBe("settled");
    expect(stageFromGoals(["work_comms", "relocation_life"])).toBe("arrived");
    expect(stageFromGoals(["work_comms", "interviews"])).toBe("pre_move");
  });

  test("nextStage clamps at the end; isLastStage", () => {
    expect(nextStage("pre_move")).toBe("arrived");
    expect(nextStage("arrived")).toBe("settled");
    expect(nextStage("settled")).toBe("settled");
    expect(isLastStage("settled")).toBe(true);
    expect(isLastStage("pre_move")).toBe(false);
  });

  test("countSession + advance (resets counter, no-op at last stage)", () => {
    let s: JourneyState = defaultJourney(["interviews"]);
    expect(s).toEqual({ stage: "pre_move", sessions: 0 });
    s = countSession(countSession(s));
    expect(s.sessions).toBe(2);
    s = advance(s);
    expect(s).toEqual({ stage: "arrived", sessions: 0 });
    expect(advance({ stage: "settled", sessions: 3 })).toEqual({ stage: "settled", sessions: 3 });
  });

  test("shouldSuggestAdvance: gated by threshold, never at the last stage", () => {
    expect(shouldSuggestAdvance({ stage: "pre_move", sessions: SUGGEST_ADVANCE_AFTER - 1 })).toBe(false);
    expect(shouldSuggestAdvance({ stage: "pre_move", sessions: SUGGEST_ADVANCE_AFTER })).toBe(true);
    expect(shouldSuggestAdvance({ stage: "settled", sessions: 99 })).toBe(false);
  });

  test("hasJourneyGoal", () => {
    expect(hasJourneyGoal(["emails", "travel"])).toBe(false);
    expect(hasJourneyGoal(["emails", "work_comms"])).toBe(true);
    expect(hasJourneyGoal(null)).toBe(false);
  });

  test("every stage maps to a real scenario pack", () => {
    for (const stage of JOURNEY_STAGES) {
      expect((SCENARIO_PACKS[STAGE_GOAL[stage]] ?? []).length).toBeGreaterThan(0);
    }
  });
});

describe("journey stage biases generation", () => {
  const profile: Profile = {
    goals: ["interviews"],
    focusTopics: [],
    selfLevel: "intermediate",
    dailyMinutes: 10,
    sphere: "Software & IT",
    domains: ["backend"],
    painText: "",
    tone: "balanced",
  };

  test("pickScenario preferGoal overrides the selected-goal pick; unknown falls back", () => {
    expect(pickScenario(["interviews"], () => 0, "work_comms")).toBe(SCENARIO_PACKS.work_comms[0]);
    expect(pickScenario(["interviews"], () => 0, "nope")).toBe(SCENARIO_PACKS.interviews[0]);
  });

  test("buildContext follows the stage emphasis when preferGoal is passed", () => {
    expect(buildContext(profile, () => 0, "work_comms")).toContain(`e.g. ${SCENARIO_PACKS.work_comms[0]}`);
    expect(buildContext(profile, () => 0)).toContain(`e.g. ${SCENARIO_PACKS.interviews[0]}`);
  });
});
