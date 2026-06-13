// Analytics — the client side of the north-star instrumentation (Day-7 retention).
//
// Design: a tiny buffered tracker with NO external imports, so it unit-tests in isolation and can
// never crash a screen. Screens call `track(name, props)`; events are buffered and flushed in
// batches by the app shell (on app background / interval / login). The network sender and the
// anonymous id are injected via `configure()` from the app root — this module stays pure.
//
// Identity: pre-login events carry an anonymous id (stable across launches, persisted by the
// caller); once the user logs in the backend attributes events to the user id instead. Tracking is
// always best-effort: a failed flush re-queues (capped) and is retried later; nothing throws.

export type AnalyticsEvent = { name: string; props: Record<string, unknown>; ts: number };
export type EventBatch = { anon_id: string | null; events: AnalyticsEvent[] };
export type Sender = (batch: EventBatch) => Promise<void>;

// Keep the buffer bounded so an offline stretch can't grow it without limit (drop oldest).
export const MAX_QUEUE = 200;
// Flush at most this many per batch (must stay ≤ backend MAX_EVENTS_PER_BATCH = 50).
export const MAX_BATCH = 50;

let queue: AnalyticsEvent[] = [];
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
  queue.push({ name, props, ts: Date.now() });
  if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
}

/** Number of buffered events not yet flushed (exposed for tests / debugging). */
export function pending(): number {
  return queue.length;
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

/** A daily contract was claimed — the daily-return + earning signal (engagement v2). */
export function trackContractClaimed(p: { id: string; reward: number }): void {
  track("contract_claimed", clean({ id: p.id, reward: p.reward }));
}

/** Flush buffered events in one batch. Best-effort: on failure the batch is re-queued for later. */
export async function flush(): Promise<void> {
  if (flushing || queue.length === 0 || sender === null) return;
  flushing = true;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(batch.length);
  try {
    await sender({ anon_id: anonId, events: batch });
  } catch {
    // Re-queue at the front so order is preserved, then stop (retry on the next flush).
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
