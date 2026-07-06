import {
  DEFAULT_PROGRESS,
  LEVEL_HISTORY_MAX,
  mergeProgress,
  recordAnswer,
  withUnitMastered,
  XP_PER_CORRECT,
  type LevelSnapshot,
  type Progress,
} from "../progress";
import { masteryOf } from "../curriculum";

function progressWith(overrides: Partial<Progress>): Progress {
  return { ...DEFAULT_PROGRESS, ...overrides };
}

const DAY = "2026-06-04";
const at = (s: string) => new Date(`${s}T12:00:00`);

describe("recordAnswer — course evidence (mastery gate)", () => {
  const correctAt = (p: Progress, format: string, correct = true) =>
    recordAnswer(p, "articles", correct, at(DAY), { format });

  it("appends the answer with its format to the topic's rolling window", () => {
    const next = correctAt(DEFAULT_PROGRESS, "build-the-sentence");
    expect(next.course.history.articles).toEqual([{ c: true, f: "build-the-sentence" }]);
  });

  it("caps the window at 10 marks (oldest fall out)", () => {
    let p = DEFAULT_PROGRESS;
    for (let i = 0; i < 12; i++) p = correctAt(p, "multiple-choice", i >= 2); // 2 early misses
    expect(p.course.history.articles).toHaveLength(10);
    expect(p.course.history.articles.every((m) => m.c)).toBe(true); // the misses aged out
  });

  it("accumulates evidence but NEVER grants mastery itself — that's the checkpoint's job", () => {
    let p = DEFAULT_PROGRESS;
    for (let i = 0; i < 8; i++) p = correctAt(p, "build-the-sentence");
    expect(masteryOf(p.course.history.articles).met).toBe(true); // meter full = checkpoint ready
    expect(p.course.mastered).toEqual([]); // but not mastered until the зачёт is passed
  });

  it("withUnitMastered promotes one-way and idempotently (checkpoint passed)", () => {
    let p = withUnitMastered(DEFAULT_PROGRESS, "articles");
    expect(p.course.mastered).toEqual(["articles"]);
    expect(withUnitMastered(p, "articles")).toBe(p); // idempotent — same object back
    for (let i = 0; i < 10; i++) p = correctAt(p, "multiple-choice", false);
    expect(p.course.mastered).toEqual(["articles"]); // later misses never un-master
  });
});

describe("recordAnswer — listening modality estimate", () => {
  it("folds a listening answer into progress.listening (and only listening formats)", () => {
    const heard = recordAnswer(DEFAULT_PROGRESS, "articles", true, at(DAY), {
      format: "listen-and-answer",
      difficulty: 2.5,
    });
    expect(heard.listening).toBeDefined();
    expect(heard.listening!.attempts).toBe(1);

    const typed = recordAnswer(DEFAULT_PROGRESS, "articles", true, at(DAY), {
      format: "multiple-choice",
    });
    expect(typed.listening).toBeUndefined();
  });

  it("accumulates evidence across answers (retell counts too, via its score)", () => {
    let p = recordAnswer(DEFAULT_PROGRESS, "articles", true, at(DAY), { format: "listen-and-answer" });
    const before = p.listening!.level;
    p = recordAnswer(p, "prepositions", false, at(DAY), { format: "listen-and-retell", score: 0 });
    expect(p.listening!.attempts).toBe(2);
    expect(p.listening!.level).toBeLessThan(before); // the miss pulled the estimate down
  });
});

describe("mergeProgress — listening modality estimate", () => {
  it("keeps the side with more evidence; a missing side never wipes the other", () => {
    const a = progressWith({ listening: { level: 2.0, attempts: 3 } });
    const b = progressWith({ listening: { level: 3.0, attempts: 10 } });
    expect(mergeProgress(a, b).listening).toEqual({ level: 3.0, attempts: 10 });
    expect(mergeProgress(b, a).listening).toEqual({ level: 3.0, attempts: 10 });
    expect(mergeProgress(a, DEFAULT_PROGRESS).listening).toEqual({ level: 2.0, attempts: 3 });
    expect(mergeProgress(DEFAULT_PROGRESS, b).listening).toEqual({ level: 3.0, attempts: 10 });
    expect(mergeProgress(DEFAULT_PROGRESS, DEFAULT_PROGRESS).listening).toBeUndefined();
  });
});

describe("mergeProgress — level test trail", () => {
  const snap = (date: string, level: number, extra: Partial<LevelSnapshot> = {}): LevelSnapshot => ({
    date,
    level,
    cefr: "B1",
    skills: {},
    ...extra,
  });

  it("keeps the later lastLevelTestDate and unions histories by date (b wins a same-day collision)", () => {
    const a = progressWith({
      lastLevelTestDate: "2026-01-05",
      levelHistory: [snap("2026-01-05", 2.5), snap("2026-04-05", 2.8)],
    });
    const b = progressWith({
      lastLevelTestDate: "2026-04-05",
      levelHistory: [snap("2026-04-05", 3.0, { cefr: "B2", skills: { listening: 2.0 } })],
    });
    const m = mergeProgress(a, b);
    expect(m.lastLevelTestDate).toBe("2026-04-05");
    expect(m.levelHistory).toHaveLength(2);
    expect(m.levelHistory![0].date).toBe("2026-01-05");
    expect(m.levelHistory![1].level).toBe(3.0); // b's richer same-day snapshot won
    expect(m.levelHistory![1].skills.listening).toBe(2.0);
  });

  it("caps the merged history at LEVEL_HISTORY_MAX, dropping the oldest", () => {
    const many = Array.from({ length: LEVEL_HISTORY_MAX + 3 }, (_, i) =>
      snap(`2026-01-${String(i + 1).padStart(2, "0")}`, 2)
    );
    const m = mergeProgress(progressWith({ levelHistory: many }), DEFAULT_PROGRESS);
    expect(m.levelHistory).toHaveLength(LEVEL_HISTORY_MAX);
    expect(m.levelHistory![0].date).toBe("2026-01-04"); // the 3 oldest fell off
  });

  it("stays absent when neither side has taken the test (legacy accounts)", () => {
    const m = mergeProgress(DEFAULT_PROGRESS, DEFAULT_PROGRESS);
    expect(m.lastLevelTestDate).toBeUndefined();
    expect(m.levelHistory).toBeUndefined();
  });
});

describe("mergeProgress — course state", () => {
  it("unions mastered units and keeps the longer per-topic history", () => {
    const a: Progress = {
      ...DEFAULT_PROGRESS,
      course: { history: { articles: [{ c: true, f: "multiple-choice" }] }, mastered: ["word order"] },
    };
    const b: Progress = {
      ...DEFAULT_PROGRESS,
      course: {
        history: { articles: [{ c: false, f: "multiple-choice" }, { c: true, f: "tap-the-error" }] },
        mastered: ["prepositions"],
      },
    };
    const m = mergeProgress(a, b);
    expect(m.course.mastered.sort()).toEqual(["prepositions", "word order"]);
    expect(m.course.history.articles).toHaveLength(2); // b's longer window wins
  });
});

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
