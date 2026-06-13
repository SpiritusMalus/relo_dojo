// Daily contracts — pure client helpers (engagement v2, Phase 2). The contract list itself is
// server-authoritative (services/contracts.py); this is just display math for the Home daily ring.
import type { Contract } from "../services/api";

export type ContractsSummary = { done: number; total: number; pct: number; claimable: number };

/** Summarize today's contracts for the daily-goal ring: how many are complete + how many are
 *  finished-but-unclaimed (a nudge to tap). pct is completion 0..100. */
export function contractsSummary(contracts: Contract[]): ContractsSummary {
  const total = contracts.length;
  const done = contracts.filter((c) => c.done).length;
  const claimable = contracts.filter((c) => c.done && !c.claimed).length;
  return { done, total, pct: total ? Math.round((100 * done) / total) : 0, claimable };
}
