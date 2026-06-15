import { countLesson, dismiss, shouldShowWall, DEFAULT_WALL, WALL_AFTER_LESSONS } from "../registerWall";

describe("register wall (soft save-progress prompt)", () => {
  test("does not show before the lesson threshold", () => {
    let s = DEFAULT_WALL;
    for (let i = 0; i < WALL_AFTER_LESSONS - 1; i++) s = countLesson(s);
    expect(shouldShowWall(s, false)).toBe(false);
  });

  test("shows for anonymous users at/after the threshold", () => {
    let s = DEFAULT_WALL;
    for (let i = 0; i < WALL_AFTER_LESSONS; i++) s = countLesson(s);
    expect(shouldShowWall(s, false)).toBe(true);
  });

  test("never shows once the user has an account", () => {
    let s = DEFAULT_WALL;
    for (let i = 0; i < WALL_AFTER_LESSONS + 5; i++) s = countLesson(s);
    expect(shouldShowWall(s, true)).toBe(false);
  });

  test("dismiss closes it for good", () => {
    let s = DEFAULT_WALL;
    for (let i = 0; i < WALL_AFTER_LESSONS; i++) s = countLesson(s);
    s = dismiss(s);
    expect(shouldShowWall(s, false)).toBe(false);
  });

  test("countLesson is pure (no mutation)", () => {
    const s = DEFAULT_WALL;
    countLesson(s);
    expect(s.lessons).toBe(0);
  });
});
