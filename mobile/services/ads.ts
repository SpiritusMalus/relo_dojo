// Ads abstraction — a provider-agnostic seam, NOT an SDK. No ad network is bundled here; the real
// one (Google AdMob / AppLovin MAX, etc.) plugs in via `configureAds()` at app start in a dev build
// (ads need native modules — they can't run in Expo Go). Until a provider is installed, the noop
// keeps every call safe, so screens can be wired now and "just work" once the SDK lands.
//
// Two ad types, two monetization roles:
//  - interstitial: full-screen ad shown between lessons to FREE users. The `no_ads` premium feature
//    (store/access.ts) removes them — a Black Belt perk. Pure client concern; never hits the server.
//  - rewarded: opt-in video that credits koku. The grant is SERVER-authoritative (postAdReward →
//    /ads/reward), never trusted from the client. Enable server-side + add SSV before prod
//    (see backend/app/services/ads.py).
import { postAdReward, type AdReward } from "./api";

export type AdsProvider = {
  /** Show a full-screen interstitial. Resolves when it's dismissed. */
  showInterstitial: () => Promise<void>;
  /** Show a rewarded video. Resolves true only if watched to the reward point. */
  showRewarded: () => Promise<boolean>;
};

// Default: do nothing (and never reward). Replaced by configureAds() when a real SDK is present.
const noop: AdsProvider = {
  showInterstitial: async () => {},
  showRewarded: async () => false,
};

let provider: AdsProvider = noop;

/** Install the real ad provider (e.g. an AdMob adapter). Call once at startup in a dev build. */
export function configureAds(p: AdsProvider): void {
  provider = p;
}

/** Lessons between interstitials on the free tier. */
export const INTERSTITIAL_EVERY = 3;

/** Pure: should an interstitial show after `finishedLessons`? Never for no-ads (premium) users;
 *  otherwise on every Nth finished lesson (the first lesson is never interrupted). */
export function shouldShowInterstitial(
  finishedLessons: number,
  opts: { noAds: boolean; every?: number }
): boolean {
  const every = opts.every ?? INTERSTITIAL_EVERY;
  if (opts.noAds || every <= 0) return false;
  return finishedLessons > 0 && finishedLessons % every === 0;
}

/** Show an interstitial via the active provider, but only when the gate allows it. No-ops for
 *  premium (no_ads) users and when no provider is installed. Best-effort: never throws. */
export async function maybeShowInterstitial(finishedLessons: number, noAds: boolean): Promise<void> {
  if (!shouldShowInterstitial(finishedLessons, { noAds })) return;
  try {
    await provider.showInterstitial();
  } catch {
    // an ad failing to load must never block the lesson flow
  }
}

/** Show a rewarded video; on a real completion, credit koku server-side and return the result.
 *  Returns null if the ad wasn't completed or the grant failed (e.g. feature disabled / offline). */
export async function watchRewardedForKoku(): Promise<AdReward | null> {
  let watched = false;
  try {
    watched = await provider.showRewarded();
  } catch {
    return null;
  }
  if (!watched) return null;
  try {
    return await postAdReward();
  } catch {
    return null; // server disabled / capped / offline — the koku just isn't granted
  }
}
