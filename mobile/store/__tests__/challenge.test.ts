import { BASE_POINTS, MAX_MULTIPLIER, comboMultiplier, scoreAnswer } from "../challenge";

describe("comboMultiplier", () => {
  it("is 1x at combo 0 and grows by 1x per consecutive correct", () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(1)).toBe(2);
    expect(comboMultiplier(3)).toBe(4);
  });

  it("caps at MAX_MULTIPLIER", () => {
    expect(comboMultiplier(10)).toBe(MAX_MULTIPLIER);
    expect(comboMultiplier(Infinity)).toBe(MAX_MULTIPLIER);
  });

  it("never goes below 1x for a negative combo", () => {
    expect(comboMultiplier(-3)).toBe(1);
  });
});

describe("scoreAnswer", () => {
  it("awards base points x multiplier and extends the combo on a correct answer", () => {
    expect(scoreAnswer(0, true)).toEqual({ points: BASE_POINTS, combo: 1, multiplier: 1 });
    // combo 2 -> 3x multiplier on the next answer
    expect(scoreAnswer(2, true)).toEqual({ points: BASE_POINTS * 3, combo: 3, multiplier: 3 });
  });

  it("resets the combo and scores nothing on a full miss", () => {
    expect(scoreAnswer(4, false, 0)).toEqual({ points: 0, combo: 0, multiplier: comboMultiplier(0) });
  });

  it("scores partial credit but still breaks the combo", () => {
    const step = scoreAnswer(2, false, 0.5);
    expect(step.combo).toBe(0); // partial credit does not keep the streak alive
    expect(step.points).toBe(Math.round(BASE_POINTS * 3 * 0.5)); // multiplier from the combo before the miss
  });

  it("respects the multiplier cap when scoring", () => {
    expect(scoreAnswer(20, true).points).toBe(BASE_POINTS * MAX_MULTIPLIER);
  });
});
