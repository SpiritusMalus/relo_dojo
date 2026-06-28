import {
  combineLevels,
  isDone,
  levelTestResult,
  nextItem,
  recordAnswer,
  startLevelTest,
  LT_MAX_ITEMS,
  LT_MIN_ITEMS,
  type LevelTestState,
} from "../levelTest";
import { isCoreItem, pickOnboardingItem, pickWritingPrompt, skillOf } from "../calibrationBank";
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
