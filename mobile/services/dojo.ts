import { request } from "./api";

export type DojoSlot = "dojo_light" | "dojo_display" | "dojo_plant";
export type DojoCatalogItem = {
  id: string;
  slot: DojoSlot;
  gate: "starter" | "achievement" | "buy";
  price: number;
  practice_days?: number | null;
};
export type DojoReceipt = {
  id: string;
  item_id: string;
  rule_id: string;
  practice_days: number;
  granted_at: string;
};
export type DojoSnapshot = {
  version: 1;
  catalog_version: 1;
  slots: DojoSlot[];
  catalog: DojoCatalogItem[];
  owned: string[];
  equipped: Record<string, string>;
  selected_target: string | null;
  practice_days: number;
  next_milestone: number | null;
  receipts: DojoReceipt[];
};

export function getDojo(): Promise<DojoSnapshot> {
  return request<DojoSnapshot>("/dojo", undefined, "GET", 12000);
}
export function setDojoTarget(id: string | null): Promise<DojoSnapshot> {
  return request<DojoSnapshot>("/dojo/target", { id }, "POST", 12000);
}
export function acknowledgeDojoReceipt(id: string): Promise<DojoSnapshot> {
  return request<DojoSnapshot>(`/dojo/receipts/${encodeURIComponent(id)}/ack`, {}, "POST", 12000);
}

/** Cache data is untrusted. Do not turn malformed/older snapshots into earned progress. */
export function isDojoSnapshot(value: unknown): value is DojoSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as DojoSnapshot;
  const slots = ["dojo_light", "dojo_display", "dojo_plant"];
  return s.version === 1 && s.catalog_version === 1
    && Array.isArray(s.slots) && s.slots.length === 3 && slots.every((slot) => s.slots.includes(slot as DojoSlot))
    && Array.isArray(s.catalog) && s.catalog.length <= 32 && s.catalog.every((item) =>
      item && typeof item.id === "string" && slots.includes(item.slot)
      && ["starter", "achievement", "buy"].includes(item.gate)
      && Number.isFinite(item.price) && item.price >= 0
      && (item.practice_days == null || (Number.isInteger(item.practice_days) && item.practice_days > 0)))
    && Array.isArray(s.owned) && s.owned.length <= 256 && s.owned.every((id) => typeof id === "string")
    && !!s.equipped && typeof s.equipped === "object" && !Array.isArray(s.equipped)
    && Object.values(s.equipped).every((id) => typeof id === "string")
    && (s.selected_target === null || typeof s.selected_target === "string")
    && Number.isInteger(s.practice_days) && s.practice_days >= 0
    && (s.next_milestone === null || (Number.isInteger(s.next_milestone) && s.next_milestone > 0))
    && Array.isArray(s.receipts) && s.receipts.length <= 128 && s.receipts.every((r) =>
      r && typeof r.id === "string" && typeof r.item_id === "string" && typeof r.rule_id === "string"
      && Number.isInteger(r.practice_days) && r.practice_days >= 0 && typeof r.granted_at === "string");
}
