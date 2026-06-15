import { consume, remaining, DEFAULT_GUEST_LIMIT, GUEST_DAILY_LIMIT } from "../guestLimit";

const TODAY = "2026-06-15";
const TOMORROW = "2026-06-16";

describe("guest daily cap", () => {
  test("fresh state has the full allowance", () => {
    expect(remaining(DEFAULT_GUEST_LIMIT, TODAY)).toBe(GUEST_DAILY_LIMIT);
  });

  test("consume decrements and allows up to the cap, then blocks", () => {
    let s = DEFAULT_GUEST_LIMIT;
    for (let i = 0; i < GUEST_DAILY_LIMIT; i++) {
      const r = consume(s, TODAY);
      expect(r.allowed).toBe(true);
      s = r.state;
    }
    expect(remaining(s, TODAY)).toBe(0);
    const blocked = consume(s, TODAY);
    expect(blocked.allowed).toBe(false);
    expect(blocked.state.used).toBe(GUEST_DAILY_LIMIT); // not incremented past the cap
  });

  test("the counter resets on a new local day", () => {
    const maxed = { day: TODAY, used: GUEST_DAILY_LIMIT };
    expect(remaining(maxed, TOMORROW)).toBe(GUEST_DAILY_LIMIT);
    const r = consume(maxed, TOMORROW);
    expect(r.allowed).toBe(true);
    expect(r.state).toEqual({ day: TOMORROW, used: 1 });
  });

  test("consume is pure (no mutation)", () => {
    const s = { day: TODAY, used: 3 };
    consume(s, TODAY);
    expect(s.used).toBe(3);
  });
});
