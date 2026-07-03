// The standards layer: syllabus integrity + the mastery criterion (store/curriculum.ts).
import {
  CURRICULUM,
  GUESSABLE_FORMATS,
  masteryOf,
  MASTERY_MIN_CORRECT,
  MASTERY_MIN_HARD,
  MASTERY_WINDOW,
  RULE_CARDS,
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
