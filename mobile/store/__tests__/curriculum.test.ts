// The standards layer: syllabus integrity + the mastery criterion (store/curriculum.ts).
import {
  CHECKPOINT_FORMATS,
  CHECKPOINT_MAX_MISSES,
  checkpointFailedNow,
  checkpointPassed,
  CURRICULUM,
  GUESSABLE_FORMATS,
  masteryOf,
  MASTERY_MIN_CORRECT,
  MASTERY_MIN_HARD,
  MASTERY_WINDOW,
  RECERT_ITEMS,
  RECERT_MAX_MISSES,
  recertFailedNow,
  recertPassed,
  RULE_CARDS,
  unitDecayed,
  unitFor,
  type AnswerMark,
} from "../curriculum";
import { TOPIC_PRIORS } from "../adaptive";

const mc = (c: boolean): AnswerMark => ({ c, f: "multiple-choice" });
const build = (c: boolean): AnswerMark => ({ c, f: "build-the-sentence" });

describe("masteryOf — the gate criterion", () => {
  it("a fresh topic reads as zero evidence, not met", () => {
    expect(masteryOf(undefined)).toEqual({ correct: 0, hard: 0, met: false, pct: 0 });
    expect(masteryOf([]).met).toBe(false);
  });

  it("met at 8/10 correct with 2 constructive-format corrects", () => {
    const history = [...Array(6).fill(mc(true)), build(true), build(true), mc(false), mc(false)];
    const m = masteryOf(history);
    expect(m.correct).toBe(MASTERY_MIN_CORRECT);
    expect(m.hard).toBe(MASTERY_MIN_HARD);
    expect(m.met).toBe(true);
    expect(m.pct).toBe(100);
  });

  it("guessable-only evidence never meets the gate, even at 10/10", () => {
    // 10 correct multiple-choice answers: enough volume, zero constructive evidence.
    const m = masteryOf(Array(10).fill(mc(true)));
    expect(m.correct).toBe(10);
    expect(m.hard).toBe(0);
    expect(m.met).toBe(false);
  });

  it("odd-one-out counts as guessable; constructive formats count as hard", () => {
    expect(GUESSABLE_FORMATS.has("odd-one-out")).toBe(true);
    expect(GUESSABLE_FORMATS.has("transform-the-sentence")).toBe(false);
    const withOdd = [...Array(8).fill(mc(true)), { c: true, f: "odd-one-out" }, { c: true, f: "odd-one-out" }];
    expect(masteryOf(withOdd).met).toBe(false);
  });

  it("only the last MASTERY_WINDOW answers count — early failures age out", () => {
    const badStart = Array(10).fill(mc(false));
    const goodRun = [...Array(8).fill(mc(true)), build(true), build(true)];
    const m = masteryOf([...badStart, ...goodRun]); // 20 marks; window = last 10
    expect(m.correct).toBe(10);
    expect(m.met).toBe(true);
    expect(MASTERY_WINDOW).toBe(10);
  });

  it("wrong answers in hard formats give no hard credit", () => {
    const history = [...Array(8).fill(mc(true)), build(false), build(false)];
    const m = masteryOf(history);
    expect(m.correct).toBe(8);
    expect(m.hard).toBe(0);
    expect(m.met).toBe(false);
  });
});

describe("checkpoint (зачёт) verdicts", () => {
  it("passes at up to CHECKPOINT_MAX_MISSES misses, fails past it — and can fail early", () => {
    expect(checkpointPassed(0)).toBe(true);
    expect(checkpointPassed(CHECKPOINT_MAX_MISSES)).toBe(true);
    expect(checkpointPassed(CHECKPOINT_MAX_MISSES + 1)).toBe(false);
    expect(checkpointFailedNow(CHECKPOINT_MAX_MISSES)).toBe(false);
    expect(checkpointFailedNow(CHECKPOINT_MAX_MISSES + 1)).toBe(true);
  });

  it("serves only constructive formats (a checkpoint must not be guessable)", () => {
    expect(CHECKPOINT_FORMATS.length).toBeGreaterThan(0);
    for (const f of CHECKPOINT_FORMATS) expect(GUESSABLE_FORMATS.has(f)).toBe(false);
  });
});

describe("CURRICULUM — syllabus integrity", () => {
  it("covers exactly the canonical topics (mirrors backend TOPICS / adaptive priors)", () => {
    const syllabus = CURRICULUM.map((u) => u.topic).sort();
    expect(syllabus).toEqual(Object.keys(TOPIC_PRIORS).sort());
  });

  it("bands never regress along the track (A1 → … → B2)", () => {
    const order = ["A1", "A2", "B1", "B2", "C1"];
    for (let i = 1; i < CURRICULUM.length; i++) {
      expect(order.indexOf(CURRICULUM[i].band)).toBeGreaterThanOrEqual(order.indexOf(CURRICULUM[i - 1].band));
    }
  });

  it("every unit has a rule card in both languages with worked examples", () => {
    for (const unit of CURRICULUM) {
      const card = RULE_CARDS[unit.topic];
      expect(card).toBeTruthy();
      expect(card.rule.ru.length).toBeGreaterThan(40);
      expect(card.rule.en.length).toBeGreaterThan(40);
      expect(card.examples.length).toBeGreaterThanOrEqual(2);
      for (const ex of card.examples) {
        expect(ex.en.trim()).toBeTruthy();
        expect(ex.ru.trim()).toBeTruthy();
      }
    }
  });

  it("unitFor resolves canonical ids and rejects strays", () => {
    expect(unitFor("prepositions")?.band).toBe("A2");
    expect(unitFor("not-a-topic")).toBeUndefined();
  });
});

describe("recertification (переаттестация) — decay detection + the re-зачёт bar", () => {
  const marks = (spec: string): AnswerMark[] =>
    [...spec].map((ch) => ({ c: ch === "1", f: "build-the-sentence" }));

  it("unitDecayed needs enough recent evidence before a dip counts", () => {
    expect(unitDecayed(undefined)).toBe(false);
    expect(unitDecayed(marks("00000"))).toBe(false); // 5 marks < REVIEW_MIN_EVIDENCE — no verdict yet
    expect(unitDecayed(marks("000000"))).toBe(true); // 6 marks at 0% — decayed
  });

  it("flags a sub-threshold window and clears at/above it", () => {
    expect(unitDecayed(marks("1010001000"))).toBe(true); // 3/10 = 30%
    expect(unitDecayed(marks("1111110000"))).toBe(false); // 6/10 = 60% — at the threshold, healthy
    expect(unitDecayed(marks("1111100000"))).toBe(true); // 5/10 = 50% — under it
  });

  it("judges only the rolling window — ancient misses age out", () => {
    // 10 old misses followed by 10 fresh correct answers: the window is the fresh ten.
    expect(unitDecayed([...marks("0000000000"), ...marks("1111111111")])).toBe(false);
  });

  it("a passed recert run replaces the window and clears the flag by construction", () => {
    // The recert spans the whole evidence window, so the quiz marks ARE the window afterward;
    // the worst passing run (exactly RECERT_MAX_MISSES misses) must read healthy again.
    expect(RECERT_ITEMS).toBe(MASTERY_WINDOW);
    const worstPass = marks("1".repeat(RECERT_ITEMS - RECERT_MAX_MISSES) + "0".repeat(RECERT_MAX_MISSES));
    expect(recertPassed(RECERT_MAX_MISSES)).toBe(true);
    expect(unitDecayed(worstPass)).toBe(false);
    expect(recertFailedNow(RECERT_MAX_MISSES)).toBe(false);
    expect(recertFailedNow(RECERT_MAX_MISSES + 1)).toBe(true);
  });

  it("listening formats never count as hard mastery evidence (comprehension ≠ production)", () => {
    expect(GUESSABLE_FORMATS.has("listen-and-answer")).toBe(true);
    expect(GUESSABLE_FORMATS.has("listen-and-retell")).toBe(true);
  });
});
