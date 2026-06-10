import {
  BOOST_MINUTES,
  BOOST_MULTIPLIER,
  COMBO_BONUS_XP,
  COMBO_EVERY,
  DEFAULT_PROGRESS,
  XP_PER_CORRECT,
  boostActive,
  mergeProgress,
  recordAnswer,
} from "../progress";

const NOW = new Date(2026, 5, 10, 12, 0, 0);

describe("combo XP", () => {
  test("every COMBO_EVERY-th correct in a row drops the bonus", () => {
    let p = { ...DEFAULT_PROGRESS };
    for (let i = 0; i < COMBO_EVERY - 1; i++) p = recordAnswer(p, "articles", true, NOW);
    expect(p.xp).toBe((COMBO_EVERY - 1) * XP_PER_CORRECT); // no bonus yet
    p = recordAnswer(p, "articles", true, NOW); // the 5th
    expect(p.currentCorrectRun).toBe(COMBO_EVERY);
    expect(p.xp).toBe(COMBO_EVERY * XP_PER_CORRECT + COMBO_BONUS_XP);
  });

  test("a wrong answer resets the run — the combo is a stake", () => {
    let p = { ...DEFAULT_PROGRESS, currentCorrectRun: COMBO_EVERY - 1 };
    p = recordAnswer(p, "articles", false, NOW);
    expect(p.currentCorrectRun).toBe(0);
    expect(p.xp).toBe(0);
  });
});

describe("kensei boost", () => {
  const active = new Date(NOW.getTime() + BOOST_MINUTES * 60000).toISOString();
  const expired = new Date(NOW.getTime() - 1000).toISOString();

  test("boostActive respects the timer", () => {
    expect(boostActive({ ...DEFAULT_PROGRESS, boostUntil: active }, NOW)).toBe(true);
    expect(boostActive({ ...DEFAULT_PROGRESS, boostUntil: expired }, NOW)).toBe(false);
    expect(boostActive({ ...DEFAULT_PROGRESS }, NOW)).toBe(false);
  });

  test("XP doubles while the boost runs (base and combo alike)", () => {
    const p = { ...DEFAULT_PROGRESS, boostUntil: active };
    const next = recordAnswer(p, "articles", true, NOW);
    expect(next.xp).toBe(XP_PER_CORRECT * BOOST_MULTIPLIER);
    // 5th-in-a-row under boost: (base + bonus) * mult
    const primed = { ...DEFAULT_PROGRESS, boostUntil: active, currentCorrectRun: COMBO_EVERY - 1 };
    const combo = recordAnswer(primed, "articles", true, NOW);
    expect(combo.xp).toBe((XP_PER_CORRECT + COMBO_BONUS_XP) * BOOST_MULTIPLIER);
  });

  test("merge keeps the later boost expiry", () => {
    const a = { ...DEFAULT_PROGRESS, boostUntil: active };
    const b = { ...DEFAULT_PROGRESS, boostUntil: expired };
    expect(mergeProgress(a, b).boostUntil).toBe(active);
    expect(mergeProgress(b, a).boostUntil).toBe(active);
  });
});
