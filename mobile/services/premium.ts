// Black Belt perks — the single source of truth shared by the full paywall
// (premium.tsx) and the shop upsell card (shop.tsx). Every perk here is already
// enforced server-side, so the pitch contains no fiction. `key` is an i18n key.
export const PREMIUM_PERKS = [
  { icon: "♾️", key: "premium.perkUnlimited" },
  { icon: "🌾", key: "premium.perkKoku" },
  { icon: "📜", key: "premium.perkScrolls" },
] as const;
