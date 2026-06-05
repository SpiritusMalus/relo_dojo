import {
  FOCUS_BOOST,
  isoDay,
  levelToCefr,
  reviewBoost,
  selectNext,
  skillFor,
  START_LEVEL,
  TARGET_SUCCESS,
  topicWeight,
  updateSkill,
} from "../adaptive";
import { DEFAULT_PROGRESS, type Progress } from "../progress";

function progressWith(overrides: Partial<Progress>): Progress {
  return { ...DEFAULT_PROGRESS, ...overrides };
}

describe("levelToCefr", () => {
  it("maps the 0..5 skill scale to CEFR bands", () => {
    expect(levelToCefr(0)).toBe("A1");
    expect(levelToCefr(0.9)).toBe("A1");
    expect(levelToCefr(1)).toBe("A2");
    expect(levelToCefr(2.5)).toBe("B1");
    expect(levelToCefr(3.2)).toBe("B2");
    expect(levelToCefr(5)).toBe("C1");
  });
});

describe("skillFor", () => {
  it("falls back to START_LEVEL for an unseen topic", () => {
    expect(skillFor(DEFAULT_PROGRESS, "prepositions")).toBe(START_LEVEL);
  });
  it("returns the stored skill when present", () => {
    const p = progressWith({ skill: { prepositions: 3.1 } });
    expect(skillFor(p, "prepositions")).toBe(3.1);
  });
});

describe("updateSkill", () => {
  it("raises the level on a correct answer and lowers it on a wrong one", () => {
    const p = progressWith({ skill: { articles: 2 }, topics: { articles: { attempts: 0, correct: 0 } } });
    expect(updateSkill(p, "articles", true).articles).toBeGreaterThan(2);
    expect(updateSkill(p, "articles", false).articles).toBeLessThan(2);
  });

  it("converges toward TARGET_SUCCESS (correct step < wrong step)", () => {
    const p = progressWith({ skill: { articles: 2 } });
    const up = updateSkill(p, "articles", true).articles - 2;
    const down = 2 - updateSkill(p, "articles", false).articles;
    // At ~75% target, a miss should move the level more than a hit.
    expect(down).toBeGreaterThan(up);
  });

  it("shrinks the step as attempts accumulate (more evidence → smaller moves)", () => {
    const few = progressWith({ skill: { articles: 2 }, topics: { articles: { attempts: 0, correct: 0 } } });
    const many = progressWith({ skill: { articles: 2 }, topics: { articles: { attempts: 200, correct: 150 } } });
    const stepFew = updateSkill(few, "articles", true).articles - 2;
    const stepMany = updateSkill(many, "articles", true).articles - 2;
    expect(stepMany).toBeLessThan(stepFew);
  });

  it("clamps to [0, 5]", () => {
    const hi = progressWith({ skill: { articles: 5 } });
    const lo = progressWith({ skill: { articles: 0 } });
    expect(updateSkill(hi, "articles", true).articles).toBeLessThanOrEqual(5);
    expect(updateSkill(lo, "articles", false).articles).toBeGreaterThanOrEqual(0);
  });
});

describe("reviewBoost (spaced repetition)", () => {
  it("is 1 for a never-practiced topic", () => {
    expect(reviewBoost(DEFAULT_PROGRESS, "prepositions", "2026-06-04")).toBe(1);
  });

  it("is 1 within the grace window", () => {
    const p = progressWith({ topics: { prepositions: { attempts: 5, correct: 4, lastSeen: "2026-06-03" } } });
    expect(reviewBoost(p, "prepositions", "2026-06-04")).toBe(1); // 1 day idle < grace
  });

  it("grows with idle days and stays within the cap", () => {
    const seen = (d: string): Progress =>
      progressWith({ topics: { prepositions: { attempts: 5, correct: 4, lastSeen: d } } });
    const week = reviewBoost(seen("2026-05-28"), "prepositions", "2026-06-04"); // ~7d idle
    const month = reviewBoost(seen("2026-05-05"), "prepositions", "2026-06-04"); // ~30d idle
    expect(week).toBeGreaterThan(1);
    expect(month).toBeGreaterThan(week);
    expect(month).toBeLessThanOrEqual(1.5); // REVIEW_MAX_BOOST
  });
});

describe("topicWeight", () => {
  const today = "2026-06-04";

  it("weights a low-accuracy topic above a high-accuracy one", () => {
    const weak = progressWith({ topics: { prepositions: { attempts: 10, correct: 2 } } });
    const strong = progressWith({ topics: { prepositions: { attempts: 10, correct: 9 } } });
    expect(topicWeight(weak, "prepositions", today)).toBeGreaterThan(
      topicWeight(strong, "prepositions", today)
    );
  });

  it("applies the focus boost for flagged topics", () => {
    const base = topicWeight(DEFAULT_PROGRESS, "prepositions", today);
    const focused = progressWith({
      profile: { ...DEFAULT_PROGRESS.profile!, goals: [], focusTopics: ["prepositions"], selfLevel: "", dailyMinutes: 0, domains: [], painText: "" },
    });
    expect(topicWeight(focused, "prepositions", today)).toBeCloseTo(base * FOCUS_BOOST, 5);
  });
});

describe("selectNext", () => {
  it("honors a forced topic", () => {
    const r = selectNext(DEFAULT_PROGRESS, "articles");
    expect(r.topic).toBe("articles");
    expect(r.cefr).toBe(levelToCefr(START_LEVEL));
  });

  it("ignores an unknown forced topic and still returns a valid pick", () => {
    const r = selectNext(DEFAULT_PROGRESS, "not-a-topic");
    expect(typeof r.topic).toBe("string");
    expect(r.type).toBeTruthy();
  });

  it("derives CEFR from the topic's skill", () => {
    const p = progressWith({ skill: { articles: 4.5 } });
    expect(selectNext(p, "articles").cefr).toBe("C1");
  });
});

describe("isoDay", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(isoDay(new Date(2026, 5, 4))).toBe("2026-06-04");
    expect(isoDay(new Date(2026, 0, 9))).toBe("2026-01-09");
  });
});

// sanity: constants are in the expected range
it("uses a sane target-success and start level", () => {
  expect(TARGET_SUCCESS).toBeGreaterThan(0.5);
  expect(TARGET_SUCCESS).toBeLessThan(1);
  expect(START_LEVEL).toBeGreaterThan(0);
});
