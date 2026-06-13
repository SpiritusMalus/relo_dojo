// Cosmetics — the client mirror of the server catalog (engagement v2: koku desire sink).
//
// Ownership is SERVER-authoritative (services/cosmetics.py); this module is pure and exists for two
// jobs: (1) render — it holds each cosmetic's display name + visual spec; (2) UI gating — cheap
// pure prechecks (owned? affordable? buyable?) that mirror the server rules so the Wardrobe can grey
// out / label items without a round-trip. The server still enforces price + gate on every buy.
//
// Ids and prices MUST match backend services/cosmetics.py CATALOG.

export type Slot = "sensei";
export type Gate = "starter" | "buy" | "achievement";

// Visual override for the Sensei mascot skin. Empty = the default (classic) look.
export type SenseiVisual = {
  hair?: string;
  skinTone?: string;
  skinEdge?: string;
  accessory?: "beard" | "scar" | "sakura";
};

export type CosmeticDef = {
  id: string;
  slot: Slot;
  gate: Gate;
  price: number;
  season?: string;
  name: { en: string; ru: string };
  blurb: { en: string; ru: string };
  visual: SenseiVisual;
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
};

export const SLOTS: Slot[] = ["sensei"];

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

export type BuyCheck = { ok: boolean; reason: "buyable" | "owned" | "not_for_sale" | "too_poor" | "unknown" };

/** Pure UI precheck mirroring the server's buy rules (the server still enforces). */
export function buyCheck(coins: number, owned: string[] | undefined, id: string): BuyCheck {
  const def = CATALOG[id];
  if (!def) return { ok: false, reason: "unknown" };
  if (def.gate !== "buy") return { ok: false, reason: "not_for_sale" };
  if (isOwned(owned, id)) return { ok: false, reason: "owned" };
  if (coins < def.price) return { ok: false, reason: "too_poor" };
  return { ok: true, reason: "buyable" };
}

/** The visual spec for the equipped Sensei skin, falling back to the classic default. */
export function senseiVisual(equipped: Record<string, string> | undefined): SenseiVisual {
  const id = (equipped && equipped.sensei) || starterFor("sensei");
  return CATALOG[id]?.visual ?? {};
}
