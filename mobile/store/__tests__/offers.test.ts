import { formatCountdown, offerActive, offerMsLeft, OFFERS } from "../offers";

const NOW = new Date("2026-06-10T12:00:00Z");

describe("offer engine (pure)", () => {
  test("active only inside the window and while untouched", () => {
    const live = { expiresAt: "2026-06-10T13:00:00Z" };
    expect(offerActive(live, NOW)).toBe(true);
    expect(offerActive({ expiresAt: "2026-06-10T11:00:00Z" }, NOW)).toBe(false); // expired = gone
    expect(offerActive({ ...live, redeemed: true }, NOW)).toBe(false);
    expect(offerActive({ ...live, dismissed: true }, NOW)).toBe(false);
    expect(offerActive(undefined, NOW)).toBe(false);
  });

  test("msLeft floors at zero", () => {
    expect(offerMsLeft({ expiresAt: "2026-06-10T12:00:30Z" }, NOW)).toBe(30000);
    expect(offerMsLeft({ expiresAt: "2026-06-10T11:00:00Z" }, NOW)).toBe(0);
  });

  test("countdown formats hh:mm:ss", () => {
    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(61000)).toBe("00:01:01");
    expect(formatCountdown(25 * 3600000)).toBe("25:00:00");
  });

  test("catalog: both offers are real discounts, not fiction", () => {
    expect(OFFERS.starter24.price).toBeLessThan(150); // cheaper than the shop omamori
    expect(OFFERS.limit48.item).toBe("extra_pack_promo"); // double size, regular price
  });
});
