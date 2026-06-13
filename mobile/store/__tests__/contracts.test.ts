import { contractsSummary } from "../contracts";
import type { Contract } from "../../services/api";

const c = (over: Partial<Contract>): Contract => ({
  id: "x",
  metric: "answered",
  target: 5,
  reward: 10,
  progress: 0,
  done: false,
  claimed: false,
  ...over,
});

describe("contractsSummary", () => {
  test("empty list is zeroed", () => {
    expect(contractsSummary([])).toEqual({ done: 0, total: 0, pct: 0, claimable: 0 });
  });

  test("counts done, claimable, and completion pct", () => {
    const list = [
      c({ done: true, claimed: true }), // done + already claimed
      c({ done: true, claimed: false }), // done + claimable
      c({ done: false }), // in progress
    ];
    expect(contractsSummary(list)).toEqual({ done: 2, total: 3, pct: 67, claimable: 1 });
  });
});
