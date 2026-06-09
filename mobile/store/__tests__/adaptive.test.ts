import {
  cefrMidpoint,
  COLD_START_BLEND,
  effectiveSkill,
  expectedOutcome,
  FOCUS_BOOST,
  isCefr,
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

describe("effectiveSkill (cross-topic cold start)", () => {
  const VERB = "verb sequence (tense agreement)";

  it("returns the raw skill for a topic with real evidence (≥1 attempt)", () => {
    const p = progressWith({
      skill: { [VERB]: 1.0, conditionals: 4.0 },
      topics: { [VERB]: { attempts: 2, correct: 1 }, conditionals: { attempts: 5, correct: 5 } },
    });
    expect(effectiveSkill(p, VERB)).toBe(1.0); // direct evidence wins, no inference
  });

  it("falls back to the seed when no correlated topic has been practiced", () => {
    const p = progressWith({ skill: { [VERB]: 1.0 } });
    expect(effectiveSkill(p, VERB)).toBe(1.0);
    // and START_LEVEL when there's no seed at all
    expect(effectiveSkill(DEFAULT_PROGRESS, VERB)).toBe(START_LEVEL);
  });

  it("blends an untested topic toward its practiced correlates", () => {
    const p = progressWith({
      skill: { [VERB]: 1.0, conditionals: 4.0 },
      topics: { conditionals: { attempts: 4, correct: 4 } }, // VERB untested
    });
    // 1.0 + COLD_START_BLEND * (4.0 - 1.0)
    expect(effectiveSkill(p, VERB)).toBeCloseTo(1.0 + COLD_START_BLEND * 3, 5);
    expect(effectiveSkill(p, VERB)).toBeGreaterThan(START_LEVEL);
  });

  it("feeds the cold-start estimate into the first updateSkill of an untested topic", () => {
    const p = progressWith({
      skill: { conditionals: 4.0 }, // VERB has neither seed nor attempts
      topics: { conditionals: { attempts: 4, correct: 4 } },
    });
    const cold = effectiveSkill(p, VERB); // inferred from conditionals
    const after = updateSkill(p, VERB, true)[VERB];
    expect(after).toBeGreaterThan(cold); // a correct answer nudges up from the inferred start
    expect(cold).toBeGreaterThan(START_LEVEL);
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

  it("accepts a partial score (0..1), not just a boolean", () => {
    const p = progressWith({ skill: { articles: 2 } });
    const partial = updateSkill(p, "articles", 0.5).articles;
    const full = updateSkill(p, "articles", 1).articles;
    const none = updateSkill(p, "articles", 0).articles;
    expect(partial).toBeGreaterThan(none);
    expect(partial).toBeLessThan(full);
  });

  it("is backward-compatible: no difficulty → boolean path matches the plain controller", () => {
    const p = progressWith({ skill: { articles: 2 }, topics: { articles: { attempts: 0, correct: 0 } } });
    const k = 0.5; // attempts 0
    const expected = 2 + k * (1 - TARGET_SUCCESS);
    expect(updateSkill(p, "articles", true).articles).toBeCloseTo(expected, 6);
  });
});

describe("expectedOutcome (difficulty-aware)", () => {
  it("equals TARGET_SUCCESS when difficulty matches skill", () => {
    expect(expectedOutcome(2.5, 2.5)).toBeCloseTo(TARGET_SUCCESS, 6);
  });
  it("is higher for an easier item, lower for a harder one", () => {
    expect(expectedOutcome(3, 1)).toBeGreaterThan(TARGET_SUCCESS); // easy → expect more
    expect(expectedOutcome(1, 3)).toBeLessThan(TARGET_SUCCESS); // hard → expect less
  });
  it("stays within [0.05, 0.95]", () => {
    expect(expectedOutcome(5, 0)).toBeLessThanOrEqual(0.95);
    expect(expectedOutcome(0, 5)).toBeGreaterThanOrEqual(0.05);
  });
});

describe("updateSkill — difficulty awareness", () => {
  it("rewards a correct answer on a hard item more than on an easy one", () => {
    const p = progressWith({ skill: { articles: 2.5 } });
    const hardWin = updateSkill(p, "articles", 1, 4.5).articles - 2.5; // C1 item
    const easyWin = updateSkill(p, "articles", 1, 0.5).articles - 2.5; // A1 item
    expect(hardWin).toBeGreaterThan(easyWin);
  });
  it("penalizes a miss on an easy item more than on a hard one", () => {
    const p = progressWith({ skill: { articles: 2.5 } });
    const easyMiss = 2.5 - updateSkill(p, "articles", 0, 0.5).articles; // should-have-known
    const hardMiss = 2.5 - updateSkill(p, "articles", 0, 4.5).articles; // forgivable
    expect(easyMiss).toBeGreaterThan(hardMiss);
  });
});

describe("cefrMidpoint / isCefr", () => {
  it("maps CEFR bands to their 0..5 midpoints", () => {
    expect(cefrMidpoint("A1")).toBe(0.5);
    expect(cefrMidpoint("B1")).toBe(2.5);
    expect(cefrMidpoint("C1")).toBe(4.5);
  });
  it("guards CEFR strings", () => {
    expect(isCefr("B2")).toBe(true);
    expect(isCefr("")).toBe(false);
    expect(isCefr("Z9")).toBe(false);
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
