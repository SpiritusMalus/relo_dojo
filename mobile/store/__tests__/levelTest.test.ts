import {
  blendListening,
  combineLevels,
  isDone,
  levelTestResult,
  nextItem,
  recordAnswer,
  skillReport,
  startLevelTest,
  BLEND_PRACTICE_CAP,
  LT_MAX_ITEMS,
  LT_MIN_ITEMS,
  MIN_PRACTICE_FOR_SOLO,
  PRACTICE_PER_UNIT,
  type LevelTestState,
} from "../levelTest";
import { isCoreItem, pickOnboardingItem, pickWritingPrompt, skillOf, type CalItem, type CalSkill } from "../calibrationBank";
import { levelToCefr } from "../adaptive";

// Drive the engine to completion modelling a learner of `trueAbility`: they reliably handle items at
// or below their level and miss harder ones. Returns the placement + how many items it took.
function runTest(trueAbility: number, seed = 1.5) {
  let s: LevelTestState = startLevelTest(seed);
  let guard = 0;
  while (!isDone(s) && guard++ < 100) {
    const it = nextItem(s);
    if (!it) break;
    s = recordAnswer(s, it, it.level <= trueAbility + 0.001);
  }
  return { ...levelTestResult(s), items: s.answered };
}

describe("level test engine — mechanics", () => {
  test("a correct answer raises the estimate, a wrong one lowers it", () => {
    const s0 = startLevelTest(2.5);
    const item = nextItem(s0)!;
    expect(item).toBeTruthy();
    const up = recordAnswer(s0, item, true);
    const down = recordAnswer(s0, item, false);
    expect(up.theta).toBeGreaterThan(s0.theta);
    expect(down.theta).toBeLessThan(s0.theta);
  });

  test("never decides before the minimum, always ends by the maximum", () => {
    let s = startLevelTest(2.5);
    // Answer everything correct; the run must not be 'done' before LT_MIN_ITEMS.
    for (let i = 0; i < LT_MIN_ITEMS - 1; i++) {
      const it = nextItem(s)!;
      s = recordAnswer(s, it, true);
      expect(isDone(s)).toBe(false);
    }
    // And a full run never exceeds the hard cap.
    const r = runTest(2.5);
    expect(r.items).toBeLessThanOrEqual(LT_MAX_ITEMS);
    expect(r.items).toBeGreaterThanOrEqual(LT_MIN_ITEMS);
  });
});

describe("level test engine — objective placement (incl. C1)", () => {
  // The whole point: a strong learner CAN reach C1 (the onboarding cap is gone here), and a weak
  // learner lands low. Tolerance is one band since placement is an estimate.
  test.each([
    [0.5, ["A1", "A2"]],
    [2.5, ["A2", "B1", "B2"]],
    [4.5, ["B2", "C1"]],
  ])("true ability %p places within %p", (ability, acceptable) => {
    const r = runTest(ability as number);
    expect(acceptable).toContain(r.cefr);
  });

  test("a true C1 learner can actually reach C1 (the cap is lifted here)", () => {
    expect(runTest(4.5).cefr).toBe("C1");
  });

  test("levelTestResult maps θ → CEFR consistently", () => {
    const s = startLevelTest(4.2);
    expect(levelTestResult(s).cefr).toBe(levelToCefr(4.2));
  });
});

describe("level test engine — multi-skill coverage", () => {
  test("a run samples reading, not only grammar/vocab", () => {
    let s = startLevelTest(2.5);
    const skills = new Set<string>();
    let guard = 0;
    while (!isDone(s) && guard++ < 100) {
      const it = nextItem(s);
      if (!it) break;
      skills.add(skillOf(it));
      s = recordAnswer(s, it, it.level <= 2.5);
    }
    expect(skills.has("reading")).toBe(true);
    expect(skills.has("listening")).toBe(true);
    // and it still includes the grammar/vocab core
    expect(skills.has("grammar") || skills.has("vocab")).toBe(true);
  });

  test("the onboarding picker never serves reading/listening items (it can't render them)", () => {
    const used = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const it = pickOnboardingItem(2.5, used);
      if (!it) break;
      expect(isCoreItem(it)).toBe(true);
      expect(["reading", "listening"]).not.toContain(skillOf(it));
      used.add(it.id);
    }
  });
});

describe("level test engine — per-skill diagnosis (skillReport)", () => {
  const item = (skill: CalSkill, level: number, id: string): CalItem => ({
    id,
    topic: skill,
    skill,
    level,
    text: "",
    options: ["a", "b"],
    answer: "a",
  });

  test("estimates each sampled skill from its own answers; unsampled skills are absent", () => {
    let s = startLevelTest(2.5);
    // Listening: missed at 1.5 and 2.5 → reads as struggling low (1.0, 2.0 → 1.5).
    s = recordAnswer(s, item("listening", 1.5, "l1"), false);
    s = recordAnswer(s, item("listening", 2.5, "l2"), false);
    // Grammar: handled at 2.5 and 3.5 → reads solidly higher (3.0, 4.0 → 3.5).
    s = recordAnswer(s, item("grammar", 2.5, "g1"), true);
    s = recordAnswer(s, item("grammar", 3.5, "g2"), true);
    const r = skillReport(s);
    expect(r.listening).toBeCloseTo(1.5, 5);
    expect(r.grammar).toBeCloseTo(3.5, 5);
    expect(r.listening!).toBeLessThan(r.grammar!); // the whole point: the gap becomes visible
    expect(r.reading).toBeUndefined();
    expect(r.vocab).toBeUndefined();
  });

  test("estimates stay clamped to the 0..5 scale at the extremes", () => {
    let s = startLevelTest(2.5);
    s = recordAnswer(s, item("vocab", 0.5, "v1"), false); // 0.0 after clamp
    s = recordAnswer(s, item("reading", 4.5, "r1"), true); // 5.0 after clamp
    const r = skillReport(s);
    expect(r.vocab).toBe(0);
    expect(r.reading).toBe(5);
  });

  test("a full run reports exactly the skills it sampled", () => {
    let s = startLevelTest(2.5);
    let guard = 0;
    while (!isDone(s) && guard++ < 100) {
      const it = nextItem(s);
      if (!it) break;
      s = recordAnswer(s, it, it.level <= 2.5);
    }
    const sampled = Array.from(new Set(s.answers.map((a) => a.skill))).sort();
    expect(Object.keys(skillReport(s)).sort()).toEqual(sampled);
    expect(sampled.length).toBeGreaterThanOrEqual(3); // rotation covered more than grammar
  });
});

describe("level test engine — listening blend (daily practice → diagnosis)", () => {
  test("no practice evidence → the test sample passes through untouched", () => {
    expect(blendListening({ estimate: 2.0, n: 3 })).toBe(2.0);
    expect(blendListening({ estimate: 2.0, n: 3 }, { level: 4, attempts: 0 })).toBe(2.0);
  });

  test("practice evidence pulls a thin test sample toward the live estimate", () => {
    // 3 test items at 1.5 + 9 practice answers (3 units) at 3.0 → (1.5*3 + 3*3)/6 = 2.25.
    const blended = blendListening({ estimate: 1.5, n: 3 }, { level: 3.0, attempts: 9 });
    expect(blended).toBeCloseTo(2.25, 5);
    // The test stays primary: the blend sits between the two, nearer neither extreme.
    expect(blended!).toBeGreaterThan(1.5);
    expect(blended!).toBeLessThan(3.0);
  });

  test("practice weight saturates at the cap — a mountain of practice can't drown the test", () => {
    const capped = blendListening({ estimate: 2.0, n: 2 }, { level: 4.0, attempts: 10_000 });
    // Weight caps at BLEND_PRACTICE_CAP units: (2*2 + 4*cap)/(2+cap).
    const expected = (2 * 2 + 4 * BLEND_PRACTICE_CAP) / (2 + BLEND_PRACTICE_CAP);
    expect(capped).toBeCloseTo(expected, 5);
  });

  test("a run that never sampled listening shows the practice-only estimate once it has evidence", () => {
    expect(blendListening({ n: 0 }, { level: 2.8, attempts: MIN_PRACTICE_FOR_SOLO })).toBe(2.8);
    // ...but not from a single lucky answer.
    expect(blendListening({ n: 0 }, { level: 2.8, attempts: MIN_PRACTICE_FOR_SOLO - 1 })).toBeUndefined();
    expect(blendListening({ n: 0 })).toBeUndefined();
  });

  test("practice answers convert to evidence units at the documented rate", () => {
    // attempts == PRACTICE_PER_UNIT → exactly one test-item of weight.
    const one = blendListening({ estimate: 2.0, n: 1 }, { level: 4.0, attempts: PRACTICE_PER_UNIT });
    expect(one).toBeCloseTo(3.0, 5);
  });
});

describe("level test engine — writing blend", () => {
  test("combineLevels weights the receptive section ~2x the single writing task", () => {
    // receptive C1 (4.5) + weak writing A1 (0.5) → (2*4.5 + 0.5)/3 = 3.17 → B2, not C1.
    const r = combineLevels(4.5, 0.5);
    expect(r.level).toBeCloseTo(3.17, 1);
    expect(r.cefr).toBe("B2");
    // strong on both → C1
    expect(combineLevels(4.5, 4.5).cefr).toBe("C1");
  });

  test("a writing prompt is chosen near the estimated ability", () => {
    expect(pickWritingPrompt(0.5).level).toBeLessThan(2);
    expect(pickWritingPrompt(4.5).level).toBeGreaterThan(3.5);
  });
});
