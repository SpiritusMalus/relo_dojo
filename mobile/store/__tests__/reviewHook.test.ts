import {
  weekIndex,
  weekKey,
  promptForWeek,
  shouldShowHook,
  dismissForWeek,
  REVIEW_PROMPTS,
  DEFAULT_REVIEW_HOOK,
} from "../reviewHook";

const DAY = 24 * 60 * 60 * 1000;
const base = new Date(Date.UTC(2026, 0, 15, 9, 0)); // arbitrary mid-week moment
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

describe("review-hook weekly bucket", () => {
  test("weekIndex is stable within a week and increments across 7 days", () => {
    expect(weekIndex(plusDays(base, 1))).toBe(weekIndex(base)); // same week
    expect(weekIndex(plusDays(base, 7))).toBe(weekIndex(base) + 1); // next week
  });

  test("weekKey tracks weekIndex", () => {
    expect(weekKey(base)).toBe(`w${weekIndex(base)}`);
    expect(weekKey(plusDays(base, 7))).not.toBe(weekKey(base));
  });
});

describe("review-hook prompt rotation", () => {
  test("prompt is always one of the curated set", () => {
    for (let w = 0; w < 20; w++) {
      expect(REVIEW_PROMPTS).toContain(promptForWeek(plusDays(base, w * 7)));
    }
  });

  test("prompt is stable within a week", () => {
    expect(promptForWeek(plusDays(base, 3))).toBe(promptForWeek(base));
  });

  test("prompt advances week to week and cycles through the whole set", () => {
    const seen = new Set<string>();
    for (let w = 0; w < REVIEW_PROMPTS.length; w++) seen.add(promptForWeek(plusDays(base, w * 7)));
    expect(seen.size).toBe(REVIEW_PROMPTS.length); // every prompt appears across a full cycle
  });
});

describe("review-hook show / dismiss", () => {
  test("shows by default", () => {
    expect(shouldShowHook(DEFAULT_REVIEW_HOOK, base)).toBe(true);
  });

  test("dismiss hides it for the current week only", () => {
    const s = dismissForWeek(DEFAULT_REVIEW_HOOK, base);
    expect(shouldShowHook(s, base)).toBe(false); // same week → hidden
    expect(shouldShowHook(s, plusDays(base, 7))).toBe(true); // next week → returns
  });

  test("dismissForWeek is pure (no mutation)", () => {
    const s = { dismissedWeek: null };
    dismissForWeek(s, base);
    expect(s.dismissedWeek).toBeNull();
  });
});
