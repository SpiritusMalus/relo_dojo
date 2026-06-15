import { shouldShowInterstitial, INTERSTITIAL_EVERY } from "../ads";

describe("interstitial cadence", () => {
  test("never shows for premium (no_ads) users", () => {
    for (let n = 0; n <= 10; n++) {
      expect(shouldShowInterstitial(n, { noAds: true })).toBe(false);
    }
  });

  test("shows on every Nth finished lesson for free users", () => {
    expect(shouldShowInterstitial(0, { noAds: false })).toBe(false); // never interrupt the first
    expect(shouldShowInterstitial(INTERSTITIAL_EVERY, { noAds: false })).toBe(true);
    expect(shouldShowInterstitial(INTERSTITIAL_EVERY + 1, { noAds: false })).toBe(false);
    expect(shouldShowInterstitial(INTERSTITIAL_EVERY * 2, { noAds: false })).toBe(true);
  });

  test("every<=0 disables interstitials", () => {
    expect(shouldShowInterstitial(9, { noAds: false, every: 0 })).toBe(false);
  });
});
