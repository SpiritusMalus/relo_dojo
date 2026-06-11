import { DAILY_HOUR, LATEST_ESCALATION_HOUR, plannedHours } from "../notifications";

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
