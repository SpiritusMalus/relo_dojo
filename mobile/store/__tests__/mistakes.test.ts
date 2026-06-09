import { MAX_MISTAKE_HINTS, MISTAKES_CAP, mistakeHintsForTopic, mistakeId, upsertMistake, type Mistake } from "../mistakes";
import type { Exercise } from "../../services/api";

function ex(overrides: Partial<Exercise> = {}): Exercise {
  return {
    type: "multiple-choice",
    topic: "articles",
    level: "B1",
    text: "She is ___ engineer.",
    prompt: "",
    options: ["a", "an", "the"],
    tiles: [],
    tokens: [],
    left: [],
    right: [],
    blankOptions: [],
    token: "sealed",
    ...overrides,
  };
}

describe("mistakeId", () => {
  it("is stable for the same item and differs across content/type/topic", () => {
    expect(mistakeId(ex())).toBe(mistakeId(ex()));
    expect(mistakeId(ex())).not.toBe(mistakeId(ex({ text: "different" })));
    expect(mistakeId(ex())).not.toBe(mistakeId(ex({ topic: "conditionals" })));
    expect(mistakeId(ex())).not.toBe(mistakeId(ex({ type: "tap-the-error" })));
  });
});

describe("upsertMistake", () => {
  const now = "2026-06-08T10:00:00.000Z";

  it("adds a new mistake at the front with misses=1", () => {
    const next = upsertMistake([], ex(), now);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ topic: "articles", misses: 1, missedAt: now });
  });

  it("dedupes the same item and increments misses, moving it to the front", () => {
    const other: Mistake = { id: "x", exercise: ex({ text: "other" }), topic: "articles", missedAt: now, misses: 1 };
    const list = [other, { id: mistakeId(ex()), exercise: ex(), topic: "articles", missedAt: now, misses: 2 }];
    const next = upsertMistake(list, ex(), "2026-06-09T10:00:00.000Z");
    expect(next).toHaveLength(2);
    expect(next[0].id).toBe(mistakeId(ex()));
    expect(next[0].misses).toBe(3);
    expect(next[0].missedAt).toBe("2026-06-09T10:00:00.000Z");
  });

  it("caps the list at MISTAKES_CAP, dropping the oldest", () => {
    let list: Mistake[] = [];
    for (let i = 0; i < MISTAKES_CAP + 5; i++) list = upsertMistake(list, ex({ text: `q${i}` }), now);
    expect(list).toHaveLength(MISTAKES_CAP);
    // the most recent insert is at the front; the very first inserts were evicted
    expect(list[0].exercise.text).toBe(`q${MISTAKES_CAP + 4}`);
    expect(list.some((m) => m.exercise.text === "q0")).toBe(false);
  });
});

describe("mistakeHintsForTopic", () => {
  const now = "2026-06-08T10:00:00.000Z";
  const mk = (over: Partial<Exercise>): Mistake => {
    const e = ex(over);
    return { id: mistakeId(e), exercise: e, topic: e.topic, missedAt: now, misses: 1 };
  };

  it("returns only this topic's sentence-bearing texts, newest-first and capped", () => {
    const list: Mistake[] = [
      mk({ topic: "articles", text: "She is ___ engineer." }),
      mk({ topic: "articles", text: "I saw ___ owl." }),
      mk({ topic: "conditionals", text: "If it ___ I leave." }), // other topic
      mk({ topic: "articles", text: "He has ___ idea." }),
      mk({ topic: "articles", text: "We need ___ plan." }),
    ];
    const hints = mistakeHintsForTopic(list, "articles");
    expect(hints).toHaveLength(MAX_MISTAKE_HINTS);
    expect(hints[0]).toBe("She is ___ engineer.");
    expect(hints).not.toContain("If it ___ I leave.");
  });

  it("skips types whose text is a generic instruction (build/match/order)", () => {
    const list: Mistake[] = [
      mk({ topic: "articles", type: "build-the-sentence", text: "Translate into English:" }),
      mk({ topic: "articles", type: "match-pairs", text: "Match each item with its pair." }),
    ];
    expect(mistakeHintsForTopic(list, "articles")).toEqual([]);
  });

  it("dedupes identical sentences", () => {
    const list: Mistake[] = [mk({ text: "Same ___ here." }), mk({ text: "Same ___ here." })];
    expect(mistakeHintsForTopic(list, "articles")).toEqual(["Same ___ here."]);
  });
});
