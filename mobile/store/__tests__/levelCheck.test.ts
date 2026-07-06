import {
  daysBetween,
  levelCheckDue,
  FIRST_CHECK_MIN_ATTEMPTS,
  LEVEL_CHECK_INTERVAL_DAYS,
} from "../levelCheck";
import { DEFAULT_PROGRESS, type Progress } from "../progress";

const TODAY = "2026-07-06";

function learner(overrides: Partial<Progress> = {}): Progress {
  return { ...DEFAULT_PROGRESS, onboarded: true, ...overrides };
}

/** Spread `n` attempts over one topic — enough signal for the first-check gate. */
function withAttempts(n: number, overrides: Partial<Progress> = {}): Progress {
  return learner({ topics: { articles: { attempts: n, correct: n } }, ...overrides });
}

describe("daysBetween", () => {
  it("counts whole local days, sign follows order", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysBetween("2026-07-06", "2026-07-06")).toBe(0);
    expect(daysBetween("2026-01-31", "2026-01-01")).toBe(-30);
  });

  it("handles month/leap boundaries (calendar math, not 30-day months)", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2); // 2024 is a leap year
    expect(daysBetween("2026-03-31", "2026-06-29")).toBe(90);
  });
});

describe("levelCheckDue", () => {
  it("never fires before onboarding", () => {
    expect(levelCheckDue({ ...DEFAULT_PROGRESS, onboarded: false }, TODAY)).toBeNull();
  });

  it("invites the FIRST full test only once real practice has accumulated", () => {
    expect(levelCheckDue(withAttempts(FIRST_CHECK_MIN_ATTEMPTS - 1), TODAY)).toBeNull();
    expect(levelCheckDue(withAttempts(FIRST_CHECK_MIN_ATTEMPTS), TODAY)).toBe("first");
  });

  it("goes quiet after a test, then fires the QUARTERLY re-check at the interval", () => {
    const dayBefore = "2026-04-08"; // 89 days before TODAY
    const onTime = "2026-04-07"; // exactly 90 days before TODAY
    expect(
      levelCheckDue(withAttempts(100, { lastLevelTestDate: dayBefore }), TODAY)
    ).toBeNull();
    expect(levelCheckDue(withAttempts(100, { lastLevelTestDate: onTime }), TODAY)).toBe(
      "quarterly"
    );
    // sanity: the fixture dates really encode 89/90 days
    expect(daysBetween(dayBefore, TODAY)).toBe(LEVEL_CHECK_INTERVAL_DAYS - 1);
    expect(daysBetween(onTime, TODAY)).toBe(LEVEL_CHECK_INTERVAL_DAYS);
  });

  it("a recent test silences the card even for a heavy practicer", () => {
    expect(levelCheckDue(withAttempts(500, { lastLevelTestDate: TODAY }), TODAY)).toBeNull();
  });
});
