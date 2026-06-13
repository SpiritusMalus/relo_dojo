import {
  DEFAULT_PROGRESS,
  mergeProgress,
  recordAnswer,
  XP_PER_CORRECT,
  type Progress,
} from "../progress";

function progressWith(overrides: Partial<Progress>): Progress {
  return { ...DEFAULT_PROGRESS, ...overrides };
}

const DAY = "2026-06-04";
const at = (s: string) => new Date(`${s}T12:00:00`);

describe("recordAnswer", () => {
  it("increments attempts/correct and stamps lastSeen for the topic", () => {
    const next = recordAnswer(DEFAULT_PROGRESS, "articles", true, at(DAY));
    expect(next.topics.articles).toEqual({ attempts: 1, correct: 1, lastSeen: DAY });
  });

  it("awards XP only on a correct answer", () => {
    expect(recordAnswer(DEFAULT_PROGRESS, "articles", true, at(DAY)).xp).toBe(XP_PER_CORRECT);
    expect(recordAnswer(DEFAULT_PROGRESS, "articles", false, at(DAY)).xp).toBe(0);
  });

  it("updates the per-topic skill (rises when correct)", () => {
    const next = recordAnswer(DEFAULT_PROGRESS, "articles", true, at(DAY));
    expect(next.skill.articles).toBeGreaterThan(DEFAULT_PROGRESS.skill.articles ?? 1.5);
  });

  it("tracks the current and best correct run; a miss resets current", () => {
    let p = recordAnswer(DEFAULT_PROGRESS, "articles", true, at(DAY));
    p = recordAnswer(p, "articles", true, at(DAY));
    expect(p.currentCorrectRun).toBe(2);
    expect(p.bestCorrectRun).toBe(2);
    p = recordAnswer(p, "articles", false, at(DAY));
    expect(p.currentCorrectRun).toBe(0);
    expect(p.bestCorrectRun).toBe(2); // best is retained
  });

  it("continues a streak across consecutive days but resets after a gap", () => {
    const d1 = recordAnswer(DEFAULT_PROGRESS, "articles", true, at("2026-06-04"));
    expect(d1.dailyStreak).toBe(1);
    const d2 = recordAnswer(d1, "articles", true, at("2026-06-05"));
    expect(d2.dailyStreak).toBe(2);
    const gap = recordAnswer(d2, "articles", true, at("2026-06-08"));
    expect(gap.dailyStreak).toBe(1); // missed days broke it
  });

  it("unlocks the first-correct achievement", () => {
    const next = recordAnswer(DEFAULT_PROGRESS, "articles", true, at(DAY));
    expect(next.achievements).toContain("first-correct");
  });

  it("resets the daily counter on a new day, increments within a day", () => {
    const d1a = recordAnswer(DEFAULT_PROGRESS, "articles", true, at("2026-06-04"));
    const d1b = recordAnswer(d1a, "articles", true, at("2026-06-04"));
    expect(d1b.todayCount).toBe(2);
    const d2 = recordAnswer(d1b, "articles", true, at("2026-06-05"));
    expect(d2.todayCount).toBe(1);
  });

  it("counts today's practice as a streak even if it was reset to 0 earlier today", () => {
    // Simulate an unrepaired break noticed on focus: lastActiveDate is today but streak is 0.
    const reset = progressWith({ lastActiveDate: DAY, dailyStreak: 0 });
    const next = recordAnswer(reset, "articles", true, at(DAY));
    expect(next.dailyStreak).toBe(1); // a day with practice is at least a 1-day streak
  });
});

describe("mergeProgress", () => {
  it("takes the max of scalar counters", () => {
    const a = progressWith({ xp: 100, bestCorrectRun: 5 });
    const b = progressWith({ xp: 40, bestCorrectRun: 9 });
    const m = mergeProgress(a, b);
    expect(m.xp).toBe(100);
    expect(m.bestCorrectRun).toBe(9);
  });

  it("keeps the per-topic stat from the side with more attempts", () => {
    const a = progressWith({ topics: { articles: { attempts: 3, correct: 1 } } });
    const b = progressWith({ topics: { articles: { attempts: 10, correct: 8 } } });
    expect(mergeProgress(a, b).topics.articles.attempts).toBe(10);
  });

  it("preserves the later lastSeen even when the other side has more attempts", () => {
    const a = progressWith({ topics: { articles: { attempts: 20, correct: 10, lastSeen: "2026-05-01" } } });
    const b = progressWith({ topics: { articles: { attempts: 2, correct: 2, lastSeen: "2026-06-04" } } });
    const m = mergeProgress(a, b);
    expect(m.topics.articles.attempts).toBe(20); // stat from the higher-evidence side
    expect(m.topics.articles.lastSeen).toBe("2026-06-04"); // but the most recent practice date
  });

  it("keeps the skill from the side with more attempts (more evidence)", () => {
    const a = progressWith({ skill: { articles: 1.2 }, topics: { articles: { attempts: 2, correct: 1 } } });
    const b = progressWith({ skill: { articles: 4.0 }, topics: { articles: { attempts: 30, correct: 25 } } });
    expect(mergeProgress(a, b).skill.articles).toBe(4.0);
  });

  it("unions achievements", () => {
    const a = progressWith({ achievements: ["first-correct"] });
    const b = progressWith({ achievements: ["streak-3"] });
    expect(mergeProgress(a, b).achievements.sort()).toEqual(["first-correct", "streak-3"]);
  });

  it("takes the streak from the most recently active side (never fabricates an active streak)", () => {
    const stale = progressWith({ dailyStreak: 10, lastActiveDate: "2026-06-01" });
    const current = progressWith({ dailyStreak: 2, lastActiveDate: "2026-06-08" });
    const m = mergeProgress(stale, current);
    expect(m.dailyStreak).toBe(2); // the current side wins — not max(10, 2)
    expect(m.lastActiveDate).toBe("2026-06-08");
  });

  it("uses max streak when both sides are from the same day", () => {
    const a = progressWith({ dailyStreak: 5, lastActiveDate: "2026-06-08" });
    const b = progressWith({ dailyStreak: 7, lastActiveDate: "2026-06-08" });
    expect(mergeProgress(a, b).dailyStreak).toBe(7);
  });
});
