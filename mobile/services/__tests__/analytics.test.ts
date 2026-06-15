import {
  _reset,
  configure,
  flush,
  MAX_BATCH,
  MAX_QUEUE,
  pending,
  track,
  trackContractClaimed,
  trackExerciseAnswered,
  trackJourneyAdvanced,
  trackPaywallView,
  trackReviewSubmitted,
  trackScrollOpen,
  trackStreakBreak,
  type AnalyticsEvent,
  type EventBatch,
} from "../analytics";

// Drain the queue through a capturing sender so tests can assert the event contract (name + props).
async function captured(): Promise<AnalyticsEvent[]> {
  const sent: EventBatch[] = [];
  configure({ sender: async (b) => void sent.push(b), anonId: null });
  await flush();
  return sent.flatMap((b) => b.events);
}

describe("analytics buffered tracker", () => {
  beforeEach(() => _reset());

  test("track buffers events", () => {
    track("app_open");
    track("session_complete", { items: 5 });
    expect(pending()).toBe(2);
  });

  test("queue is bounded — oldest dropped past MAX_QUEUE", () => {
    for (let i = 0; i < MAX_QUEUE + 10; i++) track("e", { i });
    expect(pending()).toBe(MAX_QUEUE);
  });

  test("flush sends one batch and clears it", async () => {
    const sent: EventBatch[] = [];
    configure({ sender: async (b) => void sent.push(b), anonId: "anon-1" });
    track("app_open");
    track("session_complete", { items: 3 });
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].anon_id).toBe("anon-1");
    expect(sent[0].events.map((e) => e.name)).toEqual(["app_open", "session_complete"]);
    expect(pending()).toBe(0);
  });

  test("flush caps a batch at MAX_BATCH and leaves the rest queued", async () => {
    const sent: EventBatch[] = [];
    configure({ sender: async (b) => void sent.push(b), anonId: null });
    for (let i = 0; i < MAX_BATCH + 5; i++) track("e", { i });
    await flush();
    expect(sent[0].events).toHaveLength(MAX_BATCH);
    expect(pending()).toBe(5);
  });

  test("failed flush re-queues the batch for a later retry", async () => {
    configure({
      sender: async () => {
        throw new Error("offline");
      },
      anonId: "anon-1",
    });
    track("app_open");
    await flush();
    expect(pending()).toBe(1); // preserved, not lost

    // Recover: a working sender drains it.
    const sent: EventBatch[] = [];
    configure({ sender: async (b) => void sent.push(b), anonId: "anon-1" });
    await flush();
    expect(sent[0].events.map((e) => e.name)).toEqual(["app_open"]);
    expect(pending()).toBe(0);
  });

  test("flush is a no-op when unconfigured (never throws)", async () => {
    track("app_open");
    await expect(flush()).resolves.toBeUndefined();
    expect(pending()).toBe(1);
  });
});

describe("named funnel events (D7 contract)", () => {
  beforeEach(() => _reset());

  test("exercise_answered carries topic/correct/level and defaults mode", async () => {
    trackExerciseAnswered({ topic: "tenses", correct: true, level: "B1" });
    const [e] = await captured();
    expect(e.name).toBe("exercise_answered");
    expect(e.props).toEqual({ topic: "tenses", correct: true, level: "B1", mode: "practice" });
  });

  test("paywall_view records the surface kind and drops undefined belt", async () => {
    trackPaywallView({ kind: "shop" });
    const [e] = await captured();
    expect(e.name).toBe("paywall_view");
    expect(e.props).toEqual({ kind: "shop" });
    expect("belt" in e.props).toBe(false);
  });

  test("streak_break carries the lost streak length", async () => {
    trackStreakBreak({ streak: 12 });
    const [e] = await captured();
    expect(e.name).toBe("streak_break");
    expect(e.props).toEqual({ streak: 12 });
  });

  test("scroll_open defaults the mode", async () => {
    trackScrollOpen();
    const [e] = await captured();
    expect(e.name).toBe("scroll_open");
    expect(e.props).toEqual({ mode: "practice" });
  });

  test("review_submitted carries chars and issue count", async () => {
    trackReviewSubmitted({ chars: 240, issues: 3 });
    const [e] = await captured();
    expect(e.name).toBe("review_submitted");
    expect(e.props).toEqual({ chars: 240, issues: 3 });
  });

  test("undefined props are stripped so the event bag stays flat", async () => {
    trackReviewSubmitted({ chars: 10 });
    const [e] = await captured();
    expect(e.props).toEqual({ chars: 10 });
    expect("issues" in e.props).toBe(false);
  });

  test("contract_claimed carries the id and reward", async () => {
    trackContractClaimed({ id: "warmup", reward: 15 });
    const [e] = await captured();
    expect(e.name).toBe("contract_claimed");
    expect(e.props).toEqual({ id: "warmup", reward: 15 });
  });

  test("journey_advanced carries the from/to relocation stages", async () => {
    trackJourneyAdvanced({ from: "arrived", to: "settled" });
    const [e] = await captured();
    expect(e.name).toBe("journey_advanced");
    expect(e.props).toEqual({ from: "arrived", to: "settled" });
  });
});
