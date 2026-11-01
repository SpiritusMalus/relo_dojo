import { AttemptClock } from "../answerAttempt";

describe("foreground solve clock", () => {
  it("excludes grading latency and background time, preserving real thinking across a retry", () => {
    let now = 0;
    const clock = new AttemptClock(() => now);
    now = 12_000;
    clock.pause(); // first submission
    now = 102_000; // slow failed network request
    expect(clock.elapsedMs()).toBe(12_000);
    clock.resume(); // learner corrects/retries
    now = 107_000;
    clock.pause(); // app leaves foreground
    now = 707_000;
    clock.resume();
    now = 710_000;
    expect(clock.elapsedMs()).toBe(20_000);
  });

  it("starts paused when the app is inactive and pause/resume are idempotent", () => {
    let now = 0;
    const clock = new AttemptClock(() => now, false);
    now = 20_000;
    clock.pause();
    expect(clock.elapsedMs()).toBe(0);
    clock.resume();
    now = 25_000;
    clock.resume();
    expect(clock.elapsedMs()).toBe(5000);
  });
});
