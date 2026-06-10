import {
  daysSinceActive,
  repairOpen,
  repairPrice,
  REPAIR_BASE,
  REPAIR_MAX,
  REPAIR_PER_DAY,
  streakStatus,
  yesterdayOf,
} from "../streak";
import { DEFAULT_PROGRESS, mergeProgress, recordAnswer } from "../progress";

const NOW = new Date(2026, 5, 10, 12, 0, 0); // 2026-06-10 local

describe("streak pure helpers", () => {
  test("daysSinceActive counts whole local days", () => {
    expect(daysSinceActive("2026-06-10", NOW)).toBe(0);
    expect(daysSinceActive("2026-06-09", NOW)).toBe(1);
    expect(daysSinceActive("2026-06-07", NOW)).toBe(3);
    expect(daysSinceActive("", NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  test("yesterdayOf crosses month boundaries", () => {
    expect(yesterdayOf(new Date(2026, 5, 1))).toBe("2026-05-31");
  });

  test("repairPrice grows with the lost streak and caps", () => {
    expect(repairPrice(3)).toBe(REPAIR_BASE + 3 * REPAIR_PER_DAY);
    expect(repairPrice(30)).toBe(REPAIR_BASE + 30 * REPAIR_PER_DAY);
    expect(repairPrice(1000)).toBe(REPAIR_MAX);
    expect(repairPrice(10)).toBeGreaterThan(repairPrice(3)); // longer loss = dearer rescue
  });

  test("streakStatus: alive today/yesterday is ok", () => {
    expect(streakStatus(5, "2026-06-10", NOW).kind).toBe("ok");
    expect(streakStatus(5, "2026-06-09", NOW).kind).toBe("ok");
  });

  test("streakStatus: a 2+ day gap breaks a repair-worthy streak", () => {
    expect(streakStatus(5, "2026-06-08", NOW)).toEqual({ kind: "broken", streak: 5 });
  });

  test("streakStatus: tiny streaks are not worth a break event", () => {
    expect(streakStatus(2, "2026-06-01", NOW).kind).toBe("ok");
    expect(streakStatus(0, "", NOW).kind).toBe("ok");
  });

  test("repairOpen respects the window", () => {
    expect(repairOpen({ streak: 5, date: "2026-06-10" }, NOW)).toBe(true);
    expect(repairOpen({ streak: 5, date: "2026-06-08" }, NOW)).toBe(true); // day 2 — last chance
    expect(repairOpen({ streak: 5, date: "2026-06-07" }, NOW)).toBe(false); // window closed
    expect(repairOpen(null, NOW)).toBe(false);
    expect(repairOpen({ streak: 2, date: "2026-06-10" }, NOW)).toBe(false); // too small
  });
});

describe("recordAnswer break capture", () => {
  test("a gap turns a repair-worthy streak into a break event (not a silent reset)", () => {
    const p = { ...DEFAULT_PROGRESS, dailyStreak: 7, lastActiveDate: "2026-06-05" };
    const next = recordAnswer(p, "articles", true, NOW);
    expect(next.dailyStreak).toBe(1); // restarted
    expect(next.brokenStreak).toEqual({ streak: 7, date: "2026-06-10" }); // loss made visible
  });

  test("a tiny streak still resets quietly", () => {
    const p = { ...DEFAULT_PROGRESS, dailyStreak: 2, lastActiveDate: "2026-06-05" };
    const next = recordAnswer(p, "articles", true, NOW);
    expect(next.dailyStreak).toBe(1);
    expect(next.brokenStreak).toBeNull();
  });

  test("an existing break event is not overwritten by further practice", () => {
    const p = {
      ...DEFAULT_PROGRESS,
      dailyStreak: 0,
      lastActiveDate: "2026-06-05",
      brokenStreak: { streak: 7, date: "2026-06-09" },
    };
    const next = recordAnswer(p, "articles", true, NOW);
    expect(next.brokenStreak).toEqual({ streak: 7, date: "2026-06-09" });
  });

  test("continuing a live streak leaves brokenStreak alone", () => {
    const p = { ...DEFAULT_PROGRESS, dailyStreak: 4, lastActiveDate: "2026-06-09" };
    const next = recordAnswer(p, "articles", true, NOW);
    expect(next.dailyStreak).toBe(5);
    expect(next.brokenStreak).toBeNull();
  });
});

describe("mergeProgress brokenStreak", () => {
  test("keeps the later break event across sync", () => {
    const a = { ...DEFAULT_PROGRESS, brokenStreak: { streak: 5, date: "2026-06-08" } };
    const b = { ...DEFAULT_PROGRESS, brokenStreak: { streak: 9, date: "2026-06-10" } };
    expect(mergeProgress(a, b).brokenStreak).toEqual({ streak: 9, date: "2026-06-10" });
    expect(mergeProgress(b, a).brokenStreak).toEqual({ streak: 9, date: "2026-06-10" });
    expect(mergeProgress(a, { ...DEFAULT_PROGRESS }).brokenStreak).toEqual(a.brokenStreak);
    expect(mergeProgress({ ...DEFAULT_PROGRESS }, { ...DEFAULT_PROGRESS }).brokenStreak).toBeNull();
  });
});
