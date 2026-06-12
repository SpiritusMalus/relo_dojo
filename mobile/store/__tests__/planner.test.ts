import { DEFAULT_PROGRESS, type Progress } from "../progress";
import { buildStats, planPatch, shouldReplan } from "../planner";
import { topicWeight } from "../adaptive";

const TODAY = "2026-06-11";

function base(over: Partial<Progress> = {}): Progress {
  return {
    ...DEFAULT_PROGRESS,
    onboarded: true,
    profile: {
      goals: [],
      focusTopics: [],
      selfLevel: "intermediate",
      dailyMinutes: 10,
      sphere: "",
      domains: [],
      painText: "emails",
      tone: "balanced",
      planWeights: { articles: 1.5 },
      planNote: "n",
      planDate: "2026-06-10",
      planGoal: "emails",
    },
    lastActiveDate: "2026-06-10",
    ...over,
  };
}

describe("shouldReplan", () => {
  it("is quiet when the plan is fresh and the goal unchanged", () => {
    expect(shouldReplan(base(), TODAY)).toBeNull();
  });
  it("fires 'first' when there is no plan yet", () => {
    const p = base();
    p.profile = { ...p.profile!, planWeights: undefined, planDate: undefined };
    expect(shouldReplan(p, TODAY)).toBe("first");
  });
  it("fires 'new-goal' when the goal text changed since the plan", () => {
    const p = base();
    p.profile = { ...p.profile!, painText: "interviews" };
    expect(shouldReplan(p, TODAY)).toBe("new-goal");
  });
  it("fires 'lapse' after a 3-day gap", () => {
    expect(shouldReplan(base({ lastActiveDate: "2026-06-08" }), TODAY)).toBe("lapse");
  });
  it("fires 'stale' when the plan is a week old", () => {
    const p = base();
    p.profile = { ...p.profile!, planDate: "2026-06-04" };
    expect(shouldReplan(p, TODAY)).toBe("stale");
  });
  it("never fires before onboarding", () => {
    expect(shouldReplan({ ...base(), onboarded: false }, TODAY)).toBeNull();
  });
});

describe("buildStats / planPatch", () => {
  it("collects only practiced topics with their skill", () => {
    const p = base({
      topics: { articles: { attempts: 4, correct: 3 }, "word order": { attempts: 0, correct: 0 } },
      skill: { articles: 2.5 },
    });
    expect(buildStats(p)).toEqual({ articles: { attempts: 4, correct: 3, skill: 2.5 } });
  });
  it("planPatch snapshots the goal and the quest baseline", () => {
    const patch = planPatch({ topicWeights: { articles: 2 }, note: "x", date: TODAY }, base().profile!, { articles: 3 });
    expect(patch).toEqual({
      planWeights: { articles: 2 },
      planNote: "x",
      planDate: TODAY,
      planGoal: "emails",
      planBaseline: { articles: 3 },
    });
  });
});

describe("plan weights in topicWeight", () => {
  it("multiplies the topic urgency", () => {
    const p = base();
    const without = { ...p, profile: { ...p.profile!, planWeights: undefined } };
    expect(topicWeight(p, "articles", TODAY)).toBeCloseTo(topicWeight(without, "articles", TODAY) * 1.5);
    // un-planned topics stay neutral
    expect(topicWeight(p, "prepositions", TODAY)).toBeCloseTo(topicWeight(without, "prepositions", TODAY));
  });
});
