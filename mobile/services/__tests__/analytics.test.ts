import {
  _reset,
  configure,
  flush,
  MAX_BATCH,
  MAX_QUEUE,
  pending,
  track,
  type EventBatch,
} from "../analytics";

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
