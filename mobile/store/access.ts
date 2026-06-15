// Central feature-access registry (client mirror of backend `services/access.py`).
//
// One source of truth for "who can use what". Add a feature to FEATURES once; every screen reads a
// boolean via `useAccess()` and never re-derives gating. The server is authoritative (it returns the
// computed map in /auth/me); this mirror covers anonymous users (no /auth/me) and works offline.
// A cross-language contract test (backend/tests/test_access.py) asserts this table matches the server.
//
// Extensibility: gating is data. Putting `challenge` behind the paywall later = flip its gate to
// `{ premium: true }` here (and in access.py) — no screen changes, because screens only read flags.
import { useMemo } from "react";
import { useAuth } from "./auth";
import { useWallet } from "./wallet";

export type Feature =
  | "sync"
  | "story"
  | "challenge"
  | "review"
  | "review_text"
  | "premium_unlimited"
  | "no_ads";

/** A feature's requirements. Omitted axis = not required. Empty = open to everyone (anon included). */
export type Gate = { account?: boolean; verified?: boolean; premium?: boolean };

export const FEATURES: Record<Feature, Gate> = {
  // The one thing an anonymous device genuinely can't do — what the soft register wall sells.
  sync: { account: true },
  // All learning content is open to everyone (Duo-style generous taste).
  story: {},
  challenge: {},
  review: {},
  review_text: {},
  // Convenience perks — the paywall surface.
  premium_unlimited: { premium: true }, // no daily exercise cap
  no_ads: { premium: true }, // subscription removes interstitial ads (rewarded stays opt-in)
};

export type AccessInput = { hasAccount: boolean; isVerified: boolean; isPremium: boolean };

/** Pure: can this user use `feature`? Mirrors access.can() on the server. */
export function can(feature: Feature, a: AccessInput): boolean {
  const g = FEATURES[feature];
  if (g.account && !a.hasAccount) return false;
  if (g.verified && !a.isVerified) return false;
  if (g.premium && !a.isPremium) return false;
  return true;
}

/** Pure: the full capability map. */
export function accessFor(a: AccessInput): Record<Feature, boolean> {
  const out = {} as Record<Feature, boolean>;
  (Object.keys(FEATURES) as Feature[]).forEach((f) => {
    out[f] = can(f, a);
  });
  return out;
}

/** Hook: the live capability map from auth + wallet state. Screens use `access.story` etc. */
export function useAccess(): Record<Feature, boolean> {
  const { token, user } = useAuth();
  const { isPremium } = useWallet();
  return useMemo(
    () => accessFor({ hasAccount: !!token, isVerified: !!user?.is_verified, isPremium }),
    [token, user?.is_verified, isPremium]
  );
}
