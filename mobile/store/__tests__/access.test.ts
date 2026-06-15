import { accessFor, can, FEATURES, type AccessInput } from "../access";

const anon: AccessInput = { hasAccount: false, isVerified: false, isPremium: false };
const account: AccessInput = { hasAccount: true, isVerified: false, isPremium: false };
const premium: AccessInput = { hasAccount: true, isVerified: true, isPremium: true };

describe("access registry", () => {
  test("content is open to everyone, including anonymous", () => {
    for (const f of ["story", "challenge", "review", "review_text"] as const) {
      expect(can(f, anon)).toBe(true);
      expect(can(f, account)).toBe(true);
    }
  });

  test("sync requires an account (any tier)", () => {
    expect(can("sync", anon)).toBe(false);
    expect(can("sync", account)).toBe(true); // even unverified
  });

  test("premium gate", () => {
    expect(can("premium_unlimited", anon)).toBe(false);
    expect(can("premium_unlimited", account)).toBe(false);
    expect(can("premium_unlimited", premium)).toBe(true);
  });

  test("accessFor covers exactly the registered features", () => {
    const m = accessFor(anon);
    expect(Object.keys(m).sort()).toEqual(Object.keys(FEATURES).sort());
    expect(m.sync).toBe(false);
    expect(m.story).toBe(true);
  });
});
