import { DEFAULT_PROGRESS, type Progress } from "../progress";
import { bonusDue, bonusPaidPatch, buildQuests, questBaseline, questsComplete, QUEST_TARGET } from "../quest";

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
      painText: "",
      planWeights: { articles: 2, prepositions: 1.6, conditionals: 1.4, "word order": 0.8 },
      planDate: "2026-06-12",
      planBaseline: { articles: 5 },
    },
    topics: {
      articles: { attempts: 20, correct: 9 }, // 9 - 5 baseline = 4 done
      prepositions: { attempts: 30, correct: 30 }, // no baseline → all 30, capped at target
    },
    ...over,
  };
}

describe("buildQuests", () => {
  it("takes the top-3 plan topics and measures against the baseline", () => {
    const q = buildQuests(base());
    expect(q.map((x) => x.topic)).toEqual(["articles", "prepositions", "conditionals"]);
    expect(q[0]).toEqual({ topic: "articles", done: 4, target: QUEST_TARGET });
    expect(q[1].done).toBe(QUEST_TARGET); // capped
    expect(q[2].done).toBe(0); // never practiced
  });
  it("is empty without a cached plan", () => {
    const p = base();
    p.profile = { ...p.profile!, planWeights: undefined, planDate: undefined };
    expect(buildQuests(p)).toEqual([]);
  });
});

describe("completion + bonus", () => {
  function complete(): Progress {
    return base({
      topics: {
        articles: { attempts: 30, correct: 5 + QUEST_TARGET },
        prepositions: { attempts: 30, correct: QUEST_TARGET },
        conditionals: { attempts: 30, correct: QUEST_TARGET },
      },
    });
  }
  it("questsComplete only when every goal hit the target", () => {
    expect(questsComplete(buildQuests(base()))).toBe(false);
    expect(questsComplete(buildQuests(complete()))).toBe(true);
  });
  it("bonus is due once and never twice for the same plan", () => {
    const p = complete();
    expect(bonusDue(p)).toBe(true);
    p.profile = { ...p.profile!, ...bonusPaidPatch(p.profile!) };
    expect(p.profile.planBonusPaid).toBe("2026-06-12");
    expect(bonusDue(p)).toBe(false);
  });
});

describe("questBaseline", () => {
  it("snapshots correct counts per topic", () => {
    expect(questBaseline(base())).toEqual({ articles: 9, prepositions: 30 });
  });
});
