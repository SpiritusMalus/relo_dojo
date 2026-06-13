// Cosmetics — the client mirror of the server catalog (engagement v2: koku desire sink).
//
// Ownership is SERVER-authoritative (services/cosmetics.py); this module is pure and exists for two
// jobs: (1) render — it holds each cosmetic's display name + visual spec; (2) UI gating — cheap
// pure prechecks (owned? affordable? buyable?) that mirror the server rules so the Wardrobe can grey
// out / label items without a round-trip. The server still enforces price + gate on every buy.
//
// Ids and prices MUST match backend services/cosmetics.py CATALOG.

export type Slot = "sensei" | "knot";
export type Gate = "starter" | "buy" | "achievement";

// Visual override for the Sensei mascot skin. Empty = the default (classic) look.
export type SenseiVisual = {
  hair?: string;
  skinTone?: string;
  skinEdge?: string;
  accessory?: "beard" | "scar" | "sakura";
};

// Visual override for the belt-knot icon. Empty = the default fold.
export type KnotVisual = {
  foldColor?: string; // overrides the fold accent (belt colour itself stays progress-driven)
  ornament?: "bead_gold" | "bead_jade" | "tassel";
};

export type CosmeticVisual = SenseiVisual & KnotVisual;

export type CosmeticDef = {
  id: string;
  slot: Slot;
  gate: Gate;
  price: number;
  season?: string;
  name: { en: string; ru: string };
  blurb: { en: string; ru: string };
  visual: CosmeticVisual;
};

export const CATALOG: Record<string, CosmeticDef> = {
  sensei_classic: {
    id: "sensei_classic",
    slot: "sensei",
    gate: "starter",
    price: 0,
    name: { en: "Classic Sensei", ru: "Классический Сэнсэй" },
    blurb: { en: "The master you started with.", ru: "Мастер, с которого всё началось." },
    visual: {},
  },
  sensei_sage: {
    id: "sensei_sage",
    slot: "sensei",
    gate: "buy",
    price: 200,
    name: { en: "Sage", ru: "Мудрец" },
    blurb: { en: "Silver hair, calm eyes.", ru: "Седина и спокойный взгляд." },
    visual: { hair: "#D9D9D2", accessory: "beard" },
  },
  sensei_ronin: {
    id: "sensei_ronin",
    slot: "sensei",
    gate: "buy",
    price: 250,
    name: { en: "Ronin", ru: "Ронин" },
    blurb: { en: "A wanderer with a past.", ru: "Странник с прошлым." },
    visual: { hair: "#16161B", skinTone: "#E9C49E", skinEdge: "#D2A877", accessory: "scar" },
  },
  sensei_sakura: {
    id: "sensei_sakura",
    slot: "sensei",
    gate: "buy",
    price: 300,
    season: "spring",
    name: { en: "Sakura", ru: "Сакура" },
    blurb: { en: "Petals of the spring festival.", ru: "Лепестки весеннего фестиваля." },
    visual: { hair: "#3A2A30", accessory: "sakura" },
  },
  // Belt-knot styles.
  knot_classic: {
    id: "knot_classic",
    slot: "knot",
    gate: "starter",
    price: 0,
    name: { en: "Classic knot", ru: "Классический узел" },
    blurb: { en: "A plain, honest fold.", ru: "Простой честный узел." },
    visual: {},
  },
  knot_gold: {
    id: "knot_gold",
    slot: "knot",
    gate: "buy",
    price: 150,
    name: { en: "Gold bead", ru: "Золотая бусина" },
    blurb: { en: "A glint of merit.", ru: "Блеск заслуг." },
    visual: { foldColor: "#D8A82A", ornament: "bead_gold" },
  },
  knot_jade: {
    id: "knot_jade",
    slot: "knot",
    gate: "buy",
    price: 180,
    name: { en: "Jade bead", ru: "Нефритовая бусина" },
    blurb: { en: "Calm and rare.", ru: "Спокойствие и редкость." },
    visual: { ornament: "bead_jade" },
  },
  knot_tassel: {
    id: "knot_tassel",
    slot: "knot",
    gate: "buy",
    price: 220,
    name: { en: "Tassel", ru: "Кисть" },
    blurb: { en: "A master's flourish.", ru: "Росчерк мастера." },
    visual: { ornament: "tassel" },
  },
};

export const SLOTS: Slot[] = ["sensei", "knot"];

// Seasonal windows (northern-hemisphere months) — mirrors backend services/cosmetics.py. A scarcity
// mechanic: seasonal items are only buyable while their season is active. Server enforces too.
export const SEASON_MONTHS: Record<string, number[]> = {
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  autumn: [9, 10, 11],
  winter: [12, 1, 2],
};

export function isSeasonActive(season: string | undefined, now: Date = new Date()): boolean {
  if (!season) return true;
  const months = SEASON_MONTHS[season];
  if (!months) return true; // unknown tag → fail open
  return months.includes(now.getMonth() + 1);
}

export function defOf(id: string): CosmeticDef | undefined {
  return CATALOG[id];
}

export function catalogForSlot(slot: Slot): CosmeticDef[] {
  return Object.values(CATALOG).filter((c) => c.slot === slot);
}

export function starterFor(slot: Slot): string {
  const s = Object.values(CATALOG).find((c) => c.slot === slot && c.gate === "starter");
  return s ? s.id : "";
}

export function isOwned(owned: string[] | undefined, id: string): boolean {
  const def = CATALOG[id];
  if (!def) return false;
  if (def.gate === "starter") return true; // starters are always owned
  return !!owned && owned.includes(id);
}

export function canAfford(coins: number, id: string): boolean {
  const def = CATALOG[id];
  return !!def && coins >= def.price;
}

export type BuyCheck = {
  ok: boolean;
  reason: "buyable" | "owned" | "not_for_sale" | "too_poor" | "out_of_season" | "unknown";
};

/** Pure UI precheck mirroring the server's buy rules (the server still enforces). */
export function buyCheck(
  coins: number,
  owned: string[] | undefined,
  id: string,
  now: Date = new Date()
): BuyCheck {
  const def = CATALOG[id];
  if (!def) return { ok: false, reason: "unknown" };
  if (def.gate !== "buy") return { ok: false, reason: "not_for_sale" };
  if (isOwned(owned, id)) return { ok: false, reason: "owned" };
  if (!isSeasonActive(def.season, now)) return { ok: false, reason: "out_of_season" };
  if (coins < def.price) return { ok: false, reason: "too_poor" };
  return { ok: true, reason: "buyable" };
}

/** The cheapest buyable, in-season, not-yet-owned cosmetic the user can afford right now.
 *  Drives the peak-end pitch — surface a reachable reward at the emotional high of finishing. */
export function firstAffordableUnowned(
  coins: number,
  owned: string[] | undefined,
  now: Date = new Date()
): CosmeticDef | undefined {
  return Object.values(CATALOG)
    .filter((c) => buyCheck(coins, owned, c.id, now).ok)
    .sort((a, b) => a.price - b.price)[0];
}

/** The visual spec for the equipped Sensei skin, falling back to the classic default. */
export function senseiVisual(equipped: Record<string, string> | undefined): SenseiVisual {
  const id = (equipped && equipped.sensei) || starterFor("sensei");
  return CATALOG[id]?.visual ?? {};
}

/** The visual spec for the equipped belt-knot style, falling back to the classic default. */
export function knotVisual(equipped: Record<string, string> | undefined): KnotVisual {
  const id = (equipped && equipped.knot) || starterFor("knot");
  return CATALOG[id]?.visual ?? {};
}
