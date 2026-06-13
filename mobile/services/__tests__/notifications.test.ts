import {
  DAILY_HOUR,
  LATEST_ESCALATION_HOUR,
  RECAP_DOW,
  RECAP_HOUR,
  nextWeekday,
  plannedHours,
  recapHasContent,
} from "../notifications";
import type { DiaryRecap } from "../../store/diary";

describe("plannedHours", () => {
  it("defaults to 19:00 / 21:30", () => {
    expect(plannedHours(undefined)).toEqual({ daily: DAILY_HOUR, escalation: 21.5 });
  });
  it("follows the learner's chosen hour", () => {
    expect(plannedHours(8)).toEqual({ daily: 8, escalation: 10.5 });
  });
  it("caps the escalation before midnight for late reminders", () => {
    expect(plannedHours(22)).toEqual({ daily: 22, escalation: LATEST_ESCALATION_HOUR });
  });
  it("rejects out-of-range hours back to the default", () => {
    expect(plannedHours(42).daily).toBe(DAILY_HOUR);
    expect(plannedHours(-1).daily).toBe(DAILY_HOUR);
  });
});

describe("nextWeekday", () => {
  it("returns the upcoming Sunday at RECAP_HOUR from a mid-week day", () => {
    // 2026-06-10 is a Wednesday; next Sunday is 2026-06-14.
    const wed = new Date(2026, 5, 10, 9, 0, 0);
    const d = nextWeekday(RECAP_DOW, RECAP_HOUR, wed);
    expect(d.getDay()).toBe(RECAP_DOW);
    expect(d.getDate()).toBe(14);
    expect(d.getHours()).toBe(RECAP_HOUR);
    expect(d.getTime()).toBeGreaterThan(wed.getTime());
  });

  it("rolls to next week when today is the target day but the hour has passed", () => {
    // 2026-06-14 is a Sunday; 12:00 is past RECAP_HOUR (11) → jump to 2026-06-21.
    const sunAfternoon = new Date(2026, 5, 14, 12, 0, 0);
    const d = nextWeekday(RECAP_DOW, RECAP_HOUR, sunAfternoon);
    expect(d.getDay()).toBe(RECAP_DOW);
    expect(d.getDate()).toBe(21);
  });

  it("uses today when it's the target day and the hour is still ahead", () => {
    const sunMorning = new Date(2026, 5, 14, 8, 0, 0);
    const d = nextWeekday(RECAP_DOW, RECAP_HOUR, sunMorning);
    expect(d.getDate()).toBe(14);
    expect(d.getTime()).toBeGreaterThan(sunMorning.getTime());
  });
});

describe("recapHasContent", () => {
  const recap = (over: Partial<DiaryRecap> = {}): DiaryRecap => ({
    from: "2026-06-01",
    to: "2026-06-08",
    xp: 120,
    correct: 18,
    slips: 4,
    topTopic: "conditionals",
    ...over,
  });

  it("is true when the week saw practice", () => {
    expect(recapHasContent(recap())).toBe(true);
    expect(recapHasContent(recap({ correct: 0, slips: 3 }))).toBe(true);
  });

  it("is false for null/undefined or an idle week", () => {
    expect(recapHasContent(undefined)).toBe(false);
    expect(recapHasContent(null)).toBe(false);
    expect(recapHasContent(recap({ correct: 0, slips: 0 }))).toBe(false);
  });
});
