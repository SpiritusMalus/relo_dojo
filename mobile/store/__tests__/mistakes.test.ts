import {
  dueMistakes,
  MAX_MISTAKE_HINTS,
  MISTAKES_CAP,
  mistakeHintsForTopic,
  mistakeId,
  nextDueAt,
  promoteMistake,
  SRS_INTERVALS_D,
  upsertMistake,
  type Mistake,
} from "../mistakes";
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

describe("SRS ladder (Leitner)", () => {
  const now = "2026-07-04T10:00:00.000Z";
  const dayLater = (iso: string, days: number) => {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  };

  it("a fresh miss enters the learning phase: box 0, due immediately", () => {
    const next = upsertMistake([], ex(), now);
    expect(next[0].box).toBe(0);
    expect(next[0].due).toBe(now);
    expect(dueMistakes(next, now)).toHaveLength(1);
  });

  it("correct answers climb 1/3/7/21 days, then the item graduates off the deck", () => {
    let list = upsertMistake([], ex(), now);
    const id = list[0].id;
    let clock = now;
    for (let i = 0; i < SRS_INTERVALS_D.length; i++) {
      list = promoteMistake(list, id, clock);
      expect(list[0].box).toBe(i + 1);
      expect(list[0].due).toBe(dayLater(clock, SRS_INTERVALS_D[i]));
      expect(dueMistakes(list, clock)).toHaveLength(0); // scheduled out — not due today
      clock = list[0].due!; // arrive exactly at the next review
      expect(dueMistakes(list, clock)).toHaveLength(1); // due again on its date
    }
    list = promoteMistake(list, id, clock); // correct past the last interval
    expect(list).toHaveLength(0); // graduated — proven across every spaced gap
  });

  it("a miss resets a climbed item back to box 0, due immediately", () => {
    let list = upsertMistake([], ex(), now);
    const id = list[0].id;
    list = promoteMistake(list, id, now); // box 1, due +1d
    list = upsertMistake(list, ex(), dayLater(now, 1)); // missed again on its review day
    expect(list[0].id).toBe(id);
    expect(list[0].box).toBe(0);
    expect(list[0].due).toBe(dayLater(now, 1));
  });

  it("legacy items without SRS fields are due immediately and sort first", () => {
    const legacy: Mistake = { ...upsertMistake([], ex({ text: "Old ___ one." }), now)[0] };
    delete legacy.box;
    delete legacy.due;
    const scheduled = promoteMistake(upsertMistake([], ex(), now), mistakeId(ex()), now)[0];
    const due = dueMistakes([scheduled, legacy], dayLater(now, 2));
    expect(due.map((m) => m.id)).toEqual([legacy.id, scheduled.id]); // legacy first, then overdue by date
  });

  it("nextDueAt reports the earliest upcoming review, or null when nothing is scheduled", () => {
    let list = upsertMistake([], ex(), now);
    expect(nextDueAt(list, now)).toBeNull(); // due now = not upcoming
    list = promoteMistake(list, list[0].id, now);
    expect(nextDueAt(list, now)).toBe(dayLater(now, 1));
  });
});
