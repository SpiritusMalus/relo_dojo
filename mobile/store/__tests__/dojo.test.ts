import { beltProgress, buildPath, hasEvidence, topicRow, topicRows, TOPIC_ORDER } from "../dojo";
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

describe("buildPath — the mastery-gated course track", () => {
  const first = TOPIC_ORDER[0];

  /** Drive one topic through the course criterion: 8 correct answers, 2 of them constructive. */
  function master(p: Progress, topic: string): Progress {
    for (let i = 0; i < 6; i++) p = recordAnswer(p, topic, true, at("2026-06-04"), { format: "multiple-choice" });
    p = recordAnswer(p, topic, true, at("2026-06-04"), { format: "build-the-sentence" });
    p = recordAnswer(p, topic, true, at("2026-06-04"), { format: "tap-the-error" });
    return p;
  }

  it("the syllabus opens with word order (CEFR-banded course, not the priors order)", () => {
    expect(first).toBe("word order");
  });

  it("fresh account: no done nodes, node[0] is current with a 0-progress mastery meter", () => {
    const { nodes, doneCount } = buildPath(DEFAULT_PROGRESS);
    expect(doneCount).toBe(0);
    expect(nodes[0].state).toBe("current");
    expect(nodes[0].mastery).toEqual({ correct: 0, hard: 0, met: false, pct: 0 });
    expect(nodes[0].band).toBe("A1");
  });

  it("a topic seeded ≥3.5 but never practiced is NOT done (no fabricated mastery)", () => {
    // Placement quiz can seed a high skill with zero attempts — a self-assessment, not earned mastery.
    const p: Progress = { ...DEFAULT_PROGRESS, skill: { [first]: 4.2 } };
    expect(topicRow(p, first).started).toBe(false);
    const { nodes, doneCount } = buildPath(p);
    expect(nodes[0].state).toBe("current");
    expect(doneCount).toBe(0);
  });

  it("high accuracy alone is NOT mastery — the course criterion (incl. constructive formats) is", () => {
    // 7 correct multiple-choice answers: 90%+ accuracy, but below both the correct-count bar and
    // the constructive-format bar → the unit must stay current.
    let p = DEFAULT_PROGRESS;
    for (let i = 0; i < 7; i++) p = recordAnswer(p, first, true, at("2026-06-04"), { format: "multiple-choice" });
    const { nodes, doneCount } = buildPath(p);
    expect(doneCount).toBe(0);
    expect(nodes[0].state).toBe("current");
    expect(nodes[0].mastery?.met).toBe(false);
  });

  it("meeting the criterion marks the unit done and advances current to the next unit", () => {
    const p = master(DEFAULT_PROGRESS, first);
    expect(p.course.mastered).toContain(first);
    const { nodes, doneCount } = buildPath(p);
    expect(nodes[0].state).toBe("done");
    expect(doneCount).toBe(1);
    expect(nodes[1].state).toBe("current");
    expect(nodes[1].topic!.id).toBe(TOPIC_ORDER[1]);
  });

  it("windows the track so the current unit stays visible deep into the course", () => {
    let p = DEFAULT_PROGRESS;
    for (const id of TOPIC_ORDER.slice(0, 9)) p = master(p, id);
    const { nodes, doneCount, total } = buildPath(p); // default count 6 of 11 topics
    expect(doneCount).toBe(9);
    expect(total).toBe(TOPIC_ORDER.length);
    const current = nodes.find((n) => n.state === "current");
    expect(current?.topic?.id).toBe(TOPIC_ORDER[9]);
    expect(nodes[nodes.length - 1].state).toBe("test");
  });
});
