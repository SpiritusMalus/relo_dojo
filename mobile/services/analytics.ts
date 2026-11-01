// Analytics — the client side of the north-star instrumentation (Day-7 retention).
//
// Design: a tiny buffered tracker. Screens call `track(name, props)`; events are buffered and flushed in
// batches by the app shell (on app background / interval / login). The network sender and the
// anonymous id are injected via `configure()` from the app root — this module stays pure.
//
// Identity: each queued event retains its original local owner. Pre-login events are only sent
// anonymously; a signed-in queue is only sent during a session belonging to that same user. Tracking is
// always best-effort: a failed flush re-queues (capped) and is retried later; nothing throws.
import { captureAccountScope, isCurrentAccountScope, type AccountScope } from "../store/accountScope";

export type AnalyticsEvent = { name: string; props: Record<string, unknown>; ts: number };
export type EventBatch = { anon_id: string | null; events: AnalyticsEvent[] };
export type Sender = (batch: EventBatch, scope: AccountScope) => Promise<void>;

// Keep the buffer bounded so an offline stretch can't grow it without limit (drop oldest).
export const MAX_QUEUE = 200;
// Flush at most this many per batch (must stay ≤ backend MAX_EVENTS_PER_BATCH = 50).
export const MAX_BATCH = 50;

type OwnedEvent = { owner: string; event: AnalyticsEvent };
let queue: OwnedEvent[] = [];
let anonId: string | null = null;
let sender: Sender | null = null;
let flushing = false;

/** Wire the network sender and anonymous id (called once from the app root). */
export function configure(opts: { sender: Sender; anonId: string | null }): void {
  sender = opts.sender;
  anonId = opts.anonId;
}

export function setAnonId(id: string | null): void {
  anonId = id;
}

/** Record an event. Cheap and synchronous; never throws. Oldest events drop past MAX_QUEUE. */
export function track(name: string, props: Record<string, unknown> = {}): void {
  const { owner } = captureAccountScope();
  if (owner === null) return; // An unresolved account must not borrow the previous user's identity.
  queue.push({ owner, event: { name, props, ts: Date.now() } });
  if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
}

/** Number of buffered events not yet flushed (exposed for tests / debugging). */
export function pending(): number {
  const { owner } = captureAccountScope();
  return queue.filter((item) => item.owner === owner).length;
}

// ---------------------------------------------------------------------------
// Named funnel events — the D7-retention contract in one place.
//
// Screens never spell event names by hand; they call these helpers. That keeps the analytics
// namespace stable (no "paywallView" vs "paywall_view" drift) and the prop shape consistent, so
// the funnel stays queryable. Undefined props are dropped so the event bag stays flat and clean.
// Each helper is pure over `track`, so the contract is unit-tested without any screen mounting.

function clean(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (v !== undefined) out[k] = v;
  return out;
}

/** A single graded answer (the core engagement signal; finer-grained than session_complete). */
export function trackExerciseAnswered(p: {
  topic: string;
  correct: boolean;
  level?: string;
  mode?: string;
}): void {
  track("exercise_answered", clean({ topic: p.topic, correct: p.correct, level: p.level, mode: p.mode ?? "practice" }));
}

/** A monetization surface was shown (limit sheet / shop / premium pitch) — top of the pay funnel. */
export function trackPaywallView(p: { kind: "limit" | "shop" | "premium"; belt?: string }): void {
  track("paywall_view", clean({ kind: p.kind, belt: p.belt }));
}

/** The streak just snapped (loss-aversion moment; precedes the repair offer). */
export function trackStreakBreak(p: { streak: number }): void {
  track("streak_break", clean({ streak: p.streak }));
}

/** The end-of-session reward scroll was opened (variable-reward engagement). */
export function trackScrollOpen(p: { mode?: string } = {}): void {
  track("scroll_open", clean({ mode: p.mode ?? "practice" }));
}

/** "Review my text" was submitted — a high-intent feature-adoption signal. */
export function trackReviewSubmitted(p: { chars: number; issues?: number }): void {
  track("review_submitted", clean({ chars: p.chars, issues: p.issues }));
}

/** The weekly "Review my text" hook card was tapped — top of the killer-feature funnel (which
 *  rotating prompt drove the tap → review_submitted). */
export function trackReviewHookTap(p: { prompt: string }): void {
  track("review_hook_tap", clean({ prompt: p.prompt }));
}

/** A daily contract was claimed — the daily-return + earning signal (engagement v2). */
export function trackContractClaimed(p: { id: string; reward: number }): void {
  track("contract_claimed", clean({ id: p.id, reward: p.reward }));
}

/** The learner advanced their relocation-journey stage — the niche's retention signal (does the
 *  event-need → recurring-need hand-off actually happen?). Pairs with D7 for relocation cohorts. */
export function trackJourneyAdvanced(p: { from: string; to: string }): void {
  track("journey_advanced", clean({ from: p.from, to: p.to }));
}

/** Flush buffered events in one batch. Best-effort: on failure the batch is re-queued for later. */
export async function flush(): Promise<void> {
  if (flushing || queue.length === 0 || sender === null) return;
  const scope = captureAccountScope();
  if (scope.owner === null) return;
  const batch = queue.filter((item) => item.owner === scope.owner).slice(0, MAX_BATCH);
  if (batch.length === 0) return;
  flushing = true;
  const selected = new Set(batch);
  queue = queue.filter((item) => !selected.has(item));
  try {
    if (!isCurrentAccountScope(scope)) throw new Error("session_changed");
    // The sender must pass this scope to postEvents' request guard. It must never use a later
    // account's bearer token for an earlier queue, including retries after a failed request.
    await sender({ anon_id: anonId, events: batch.map((item) => item.event) }, scope);
  } catch {
    // Retain the original ownership on failure. B can flush only B's events; A's stay private
    // until A returns (or fall out of the bounded, in-memory queue).
    queue = [...batch, ...queue].slice(0, MAX_QUEUE);
  } finally {
    flushing = false;
  }
}

/** Test hook: reset all module state. */
export function _reset(): void {
  queue = [];
  anonId = null;
  sender = null;
  flushing = false;
}
