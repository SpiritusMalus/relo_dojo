import { DEFAULT_PROGRESS, type Progress } from "../progress";
import { senseiGreeting, weakestTopic, DEFAULT_GREETING_COUNT } from "../greeting";

const TODAY = "2026-06-12";

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
      wins: "Nailed articles!",
    },
    ...over,
  };
}

describe("senseiGreeting priorities", () => {
  it("is silent before onboarding", () => {
    expect(senseiGreeting({ ...base(), onboarded: false }, TODAY)).toBeNull();
  });
  it("praises when today is already done", () => {
    expect(senseiGreeting(base({ lastActiveDate: TODAY, dailyStreak: 4 }), TODAY)).toEqual({
      kind: "doneToday",
      n: 4,
    });
  });
  it("riffs on yesterday's win the morning after", () => {
    expect(senseiGreeting(base({ lastActiveDate: "2026-06-11" }), TODAY)).toEqual({
      kind: "wins",
      wins: "Nailed articles!",
    });
  });
  it("falls to the weakest topic when the win is stale", () => {
    const p = base({
      lastActiveDate: "2026-06-09",
      topics: {
        articles: { attempts: 6, correct: 2 }, // 33% — weakest
        prepositions: { attempts: 6, correct: 3 }, // 50%
        "word order": { attempts: 2, correct: 0 }, // too few attempts
      },
    });
    expect(senseiGreeting(p, TODAY)).toEqual({ kind: "weakTopic", topic: "articles" });
  });
  it("names the streak when nothing is weak", () => {
    const p = base({ lastActiveDate: "2026-06-09", dailyStreak: 5 });
    expect(senseiGreeting(p, TODAY)).toEqual({ kind: "streak", n: 5 });
  });
  it("rotates a deterministic default otherwise", () => {
    const g = senseiGreeting(base(), TODAY);
    expect(g).toEqual({ kind: "default", idx: 12 % DEFAULT_GREETING_COUNT });
    expect(senseiGreeting(base(), TODAY)).toEqual(g); // stable within the day
  });
});

describe("weakestTopic", () => {
  it("ignores accurate and under-practiced topics", () => {
    const p = base({
      topics: {
        articles: { attempts: 10, correct: 9 }, // 90% — fine
        conditionals: { attempts: 2, correct: 0 }, // too few
      },
    });
    expect(weakestTopic(p)).toBeNull();
  });
});
