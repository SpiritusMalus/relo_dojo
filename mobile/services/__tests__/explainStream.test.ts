// Unit tests for the /explain/stream consumer. expo/fetch is mocked so importing ../api doesn't pull
// the native fetch runtime under jest — we test the pure stream-draining logic with a fake reader.
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

import { consumeTextStream } from "../api";

// Build a ReadableStream-style reader that yields the given byte chunks, then { done: true }.
function fakeReader(chunks: Uint8Array[]) {
  let i = 0;
  return {
    read: async () =>
      i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
  };
}

const enc = (s: string) => new TextEncoder().encode(s);

describe("consumeTextStream", () => {
  it("accumulates chunks and reports the full text so far on each one", async () => {
    const seen: string[] = [];
    const final = await consumeTextStream(fakeReader([enc("Use "), enc("the "), enc("article.")]), (full) =>
      seen.push(full)
    );
    expect(seen).toEqual(["Use ", "Use the ", "Use the article."]);
    expect(final).toBe("Use the article.");
  });

  it("skips empty chunks without emitting", async () => {
    const seen: string[] = [];
    const final = await consumeTextStream(
      fakeReader([enc("a"), new Uint8Array(0), enc("b")]),
      (full) => seen.push(full)
    );
    expect(seen).toEqual(["a", "ab"]);
    expect(final).toBe("ab");
  });

  it("decodes a multi-byte char split across two chunks", async () => {
    // "é" is 0xC3 0xA9 in UTF-8 — split it so only stream-aware decoding produces the right glyph.
    const bytes = enc("café"); // ...0x63 0x61 0x66 0xC3 0xA9
    const final = await consumeTextStream(
      fakeReader([bytes.slice(0, bytes.length - 1), bytes.slice(bytes.length - 1)]),
      () => {}
    );
    expect(final).toBe("café");
  });

  it("throws on an empty stream so the caller can fall back", async () => {
    await expect(consumeTextStream(fakeReader([]), () => {})).rejects.toThrow("Empty explanation stream");
  });

  it("throws when the backend emits its inline unavailable marker", async () => {
    await expect(
      consumeTextStream(fakeReader([enc("\n[unavailable: model down]")]), () => {})
    ).rejects.toThrow("Explanation unavailable");
  });
});
