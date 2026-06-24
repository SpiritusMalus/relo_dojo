import { beltProgress, hasEvidence, topicRow, topicRows, TOPIC_ORDER } from "../dojo";
import { DEFAULT_PROGRESS, recordAnswer, type Progress } from "../progress";
import { selectNext } from "../adaptive";

const at = (s: string) => new Date(`${s}T12:00:00`);

function answer(p: Progress, topic: string, correct: boolean, day = "2026-06-04"): Progress {
  return recordAnswer(p, topic, correct, at(day));
}

describe("display honesty — no fabricated progress before evidence", () => {
  it("a fresh account has no evidence", () => {
    expect(hasEvidence(DEFAULT_PROGRESS)).toBe(false);
  });

  it("fresh account: worn belt is White (idx 0), pctToNext 0, not started", () => {
    const bp = beltProgress(DEFAULT_PROGRESS);
    expect(bp.belt.idx).toBe(0);
    expect(bp.belt.id).toBe("white");
    expect(bp.pctToNext).toBe(0);
    expect(bp.started).toBe(false);
    // The seeded skill estimate is kept for difficulty selection — it just can't show as an earned belt.
    expect(bp.cefr).toBeTruthy();
  });

  it("fresh account: every topic row is not-started with acc 0 (no skill/5 estimate)", () => {
    const rows = topicRows(DEFAULT_PROGRESS);
    expect(rows).toHaveLength(TOPIC_ORDER.length);
    for (const r of rows) {
      expect(r.started).toBe(false);
      expect(r.acc).toBe(0);
      expect(r.weak).toBe(false);
      // skill/cefr stay populated for internal callers.
      expect(r.skill).toBeGreaterThan(0);
    }
  });

  it("after ≥1 attempt the topic shows a real ratio and the worn belt can rise", () => {
    let p = DEFAULT_PROGRESS;
    p = answer(p, "articles", true);
    p = answer(p, "articles", false);

    const row = topicRow(p, "articles");
    expect(row.started).toBe(true);
    expect(row.attempts).toBe(2);
    expect(row.acc).toBe(50); // 1/2 — a real ratio, not skill/5

    const bp = beltProgress(p);
    expect(bp.started).toBe(true);
    expect(bp.belt.idx).toBeGreaterThanOrEqual(0); // belt is now skill-derived (may rise above White)
  });

  it("untouched topics stay not-started even when a sibling topic has evidence", () => {
    const p = answer(DEFAULT_PROGRESS, "articles", true);
    const other = topicRow(p, "prepositions");
    expect(other.started).toBe(false);
    expect(other.acc).toBe(0);
  });

  it("beltEarned forces the worn belt even with zero attempts", () => {
    const p: Progress = { ...DEFAULT_PROGRESS, beltEarned: 2 };
    expect(hasEvidence(p)).toBe(true);
    const bp = beltProgress(p);
    expect(bp.started).toBe(true);
    expect(bp.belt.idx).toBe(2); // earned is authoritative
  });

  it("difficulty selection is unaffected — selectNext still works on a fresh account", () => {
    // The seeded skill (≈A2) must keep driving item difficulty; the display fix must not touch it.
    const choice = selectNext(DEFAULT_PROGRESS);
    expect(choice).toBeTruthy();
    expect(choice.topic).toBeTruthy();
  });
});
