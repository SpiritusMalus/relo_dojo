import {
  buyCheck,
  CATALOG,
  canAfford,
  catalogForSlot,
  defOf,
  firstAffordableUnowned,
  isOwned,
  isSeasonActive,
  knotVisual,
  senseiVisual,
  SLOTS,
  starterFor,
} from "../cosmetics";

describe("cosmetics pure layer", () => {
  test("starter is always owned, even with no owned list", () => {
    expect(isOwned(undefined, "sensei_classic")).toBe(true);
    expect(isOwned([], "sensei_classic")).toBe(true);
  });

  test("non-starter ownership comes from the owned list", () => {
    expect(isOwned([], "sensei_sage")).toBe(false);
    expect(isOwned(["sensei_sage"], "sensei_sage")).toBe(true);
    expect(isOwned(["sensei_sage"], "ghost")).toBe(false);
  });

  test("starterFor returns the slot's free default", () => {
    expect(starterFor("sensei")).toBe("sensei_classic");
    expect(CATALOG[starterFor("sensei")].gate).toBe("starter");
  });

  test("canAfford compares against the catalog price", () => {
    expect(canAfford(199, "sensei_sage")).toBe(false);
    expect(canAfford(200, "sensei_sage")).toBe(true);
  });

  test("buyCheck mirrors the server rules", () => {
    expect(buyCheck(999, [], "ghost").reason).toBe("unknown");
    expect(buyCheck(999, [], "sensei_classic").reason).toBe("not_for_sale"); // starter
    expect(buyCheck(10, [], "sensei_sage").reason).toBe("too_poor");
    expect(buyCheck(999, ["sensei_sage"], "sensei_sage").reason).toBe("owned");
    expect(buyCheck(200, [], "sensei_sage")).toEqual({ ok: true, reason: "buyable" });
  });

  test("catalogForSlot returns every sensei skin", () => {
    const ids = catalogForSlot("sensei").map((c) => c.id);
    expect(ids).toContain("sensei_classic");
    expect(ids).toContain("sensei_sakura");
  });

  test("senseiVisual falls back to classic (empty) and honours equipped", () => {
    expect(senseiVisual(undefined)).toEqual({}); // classic = no overrides
    expect(senseiVisual({ sensei: "sensei_sage" })).toEqual(defOf("sensei_sage")!.visual);
    expect(senseiVisual({ sensei: "ghost" })).toEqual({}); // unknown → classic
  });

  test("knot slot has its own starter + buyable styles", () => {
    expect(SLOTS).toContain("knot");
    expect(starterFor("knot")).toBe("knot_classic");
    expect(catalogForSlot("knot").map((c) => c.id)).toContain("knot_tassel");
    expect(buyCheck(150, [], "knot_gold")).toEqual({ ok: true, reason: "buyable" });
  });

  test("knotVisual falls back to classic and honours equipped", () => {
    expect(knotVisual(undefined)).toEqual({});
    expect(knotVisual({ knot: "knot_tassel" })).toEqual(defOf("knot_tassel")!.visual);
  });

  test("isSeasonActive gates by month", () => {
    expect(isSeasonActive(undefined, new Date(2026, 5, 1))).toBe(true); // no season
    expect(isSeasonActive("spring", new Date(2026, 2, 1))).toBe(true); // March (month idx 2)
    expect(isSeasonActive("spring", new Date(2026, 5, 1))).toBe(false); // June
  });

  test("buyCheck blocks an out-of-season skin", () => {
    const june = new Date(2026, 5, 1);
    const march = new Date(2026, 2, 1);
    expect(buyCheck(999, [], "sensei_sakura", june).reason).toBe("out_of_season");
    expect(buyCheck(999, [], "sensei_sakura", march)).toEqual({ ok: true, reason: "buyable" });
  });

  test("firstAffordableUnowned picks the cheapest reachable item (peak-end pitch)", () => {
    const june = new Date(2026, 5, 1);
    expect(firstAffordableUnowned(0, [], june)).toBeUndefined(); // can't afford anything
    // 150 affords only knot_gold (cheapest buyable); sakura is out of season in June.
    expect(firstAffordableUnowned(150, [], june)?.id).toBe("knot_gold");
    // Already owns the cheapest → next cheapest reachable.
    expect(firstAffordableUnowned(999, ["knot_gold"], june)?.id).toBe("knot_jade");
  });
});
