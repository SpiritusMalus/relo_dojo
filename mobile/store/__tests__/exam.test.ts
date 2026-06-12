// theme/theme.ts pulls google-font packages whose deep deps (expo-asset) aren't needed for these
// pure derivations — mock the font modules so the suite runs anywhere.
jest.mock("@expo-google-fonts/zen-maru-gothic", () => ({}));
jest.mock("@expo-google-fonts/hanken-grotesk", () => ({}));
jest.mock("@expo-google-fonts/jetbrains-mono", () => ({}));

import { DEFAULT_PROGRESS, mergeProgress, type Progress } from "../progress";
import { canAttemptToday, examFailedNow, examOffer, examPassed } from "../exam";
import { beltProgress, skillBeltIdx } from "../dojo";
import { TOPIC_PRIORS } from "../adaptive";

const TODAY = "2026-06-12";

// Uniform per-topic skill → predictable skill belt (skill 2.x → belt idx 2, etc.).
function withSkill(level: number, over: Partial<Progress> = {}): Progress {
  const skill: Record<string, number> = {};
  for (const t of Object.keys(TOPIC_PRIORS)) skill[t] = level;
  return { ...DEFAULT_PROGRESS, onboarded: true, skill, ...over };
}

describe("examOffer", () => {
  it("offers the next belt when skill outgrew the earned one", () => {
    const p = withSkill(2.2, { beltEarned: 1 });
    expect(skillBeltIdx(p)).toBe(2);
    expect(examOffer(p)).toEqual({ target: 2, confirm: false });
  });
  it("is quiet when the worn belt matches the skill", () => {
    expect(examOffer(withSkill(2.2, { beltEarned: 2 }))).toBeNull();
  });
  it("offers a confirmation exam to legacy accounts (no beltEarned)", () => {
    expect(examOffer(withSkill(2.2))).toEqual({ target: 2, confirm: true });
  });
  it("never offers anything to a white-belt legacy account or before onboarding", () => {
    expect(examOffer(withSkill(0.4))).toBeNull();
    expect(examOffer({ ...withSkill(2.2), onboarded: false })).toBeNull();
  });
  it("steps one belt at a time even when skill jumped two", () => {
    expect(examOffer(withSkill(3.5, { beltEarned: 1 }))).toEqual({ target: 2, confirm: false });
  });
});

describe("attempts and verdicts", () => {
  it("allows one attempt per day", () => {
    expect(canAttemptToday(withSkill(2, { lastExamDate: TODAY }), TODAY)).toBe(false);
    expect(canAttemptToday(withSkill(2, { lastExamDate: "2026-06-11" }), TODAY)).toBe(true);
  });
  it("passes with up to 2 misses, aborts on the 3rd", () => {
    expect(examPassed(2)).toBe(true);
    expect(examPassed(3)).toBe(false);
    expect(examFailedNow(2)).toBe(false);
    expect(examFailedNow(3)).toBe(true);
  });
});

describe("beltProgress with the exam cap", () => {
  it("wears the earned belt and shows a full bar while the exam is pending", () => {
    const bp = beltProgress(withSkill(2.2, { beltEarned: 1 }));
    expect(bp.belt.idx).toBe(1);
    expect(bp.pctToNext).toBe(100);
    expect(bp.cefr).toBe("B1"); // difficulty stays skill-derived
  });
  it("keeps legacy behavior when beltEarned is undefined", () => {
    const bp = beltProgress(withSkill(2.2));
    expect(bp.belt.idx).toBe(2);
    expect(bp.pctToNext).toBe(20);
  });
});

describe("mergeProgress exam fields", () => {
  it("keeps the highest earned belt and the later attempt date", () => {
    const a = withSkill(2, { beltEarned: 2, lastExamDate: "2026-06-10" });
    const b = withSkill(2, { beltEarned: 1, lastExamDate: "2026-06-12" });
    const m = mergeProgress(a, b);
    expect(m.beltEarned).toBe(2);
    expect(m.lastExamDate).toBe("2026-06-12");
  });
  it("adopts the defined side when one is legacy", () => {
    expect(mergeProgress(withSkill(2), withSkill(2, { beltEarned: 3 })).beltEarned).toBe(3);
  });
});
