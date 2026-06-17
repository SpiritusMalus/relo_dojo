// FOMO offer engine (monetization branch 7). Honest scarcity: every offer is a ONE-SHOT window
// tied to a real trigger (finished onboarding / first limit hit), with a real redeemable discount
// in koku. The countdown never lies — once it expires, that offer id is gone for good. (A fake
// perpetual "today only" is the one FOMO trick we skip: store policy + refunds risk.)
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "relo_dojo/offers/v1";

export type OfferId = "starter24" | "limit48";

export type OfferRecord = {
  expiresAt: string; // ISO — the one and only window
  redeemed?: boolean;
  dismissed?: boolean;
};

export type OfferState = Partial<Record<OfferId, OfferRecord>>;

// Catalog: window length + the discounted shop item each offer unlocks.
export const OFFERS: Record<OfferId, { hours: number; item: "omamori_promo" | "extra_pack_promo"; price: number }> = {
  starter24: { hours: 24, item: "omamori_promo", price: 75 }, // half-price charm after onboarding
  limit48: { hours: 48, item: "extra_pack_promo", price: 50 }, // double pack, regular price
};

export async function loadOffers(): Promise<OfferState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OfferState) : {};
  } catch {
    return {};
  }
}

async function save(state: OfferState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // best-effort
  }
}

/** Open the offer window once (no-op if the id ever existed — one shot means one shot). */
export async function ensureOffer(id: OfferId, now: Date = new Date()): Promise<OfferState> {
  const state = await loadOffers();
  if (state[id]) return state;
  const expiresAt = new Date(now.getTime() + OFFERS[id].hours * 3600000).toISOString();
  const next = { ...state, [id]: { expiresAt } };
  await save(next);
  return next;
}

export async function markOffer(id: OfferId, patch: Partial<OfferRecord>): Promise<OfferState> {
  const state = await loadOffers();
  const rec = state[id];
  if (!rec) return state;
  const next = { ...state, [id]: { ...rec, ...patch } };
  await save(next);
  return next;
}

/** Pure: is this offer currently showable? */
export function offerActive(rec: OfferRecord | undefined, now: Date = new Date()): boolean {
  if (!rec || rec.redeemed || rec.dismissed) return false;
  return now.toISOString() < rec.expiresAt;
}

/** Pure: ms left on the clock (0 when over). */
export function offerMsLeft(rec: OfferRecord | undefined, now: Date = new Date()): number {
  if (!rec) return 0;
  return Math.max(0, new Date(rec.expiresAt).getTime() - now.getTime());
}

/** Pure: "23:59:01"-style countdown string. */
export function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
