// Tap-to-translate client: sends the word + context + UI lang, trims the result, and caches per
// (lang, word, context) so a repeat tap on the same word makes no second request.
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

import { setApiLang, translate } from "../api";

describe("translate()", () => {
  let calls: Array<Record<string, unknown>>;

  beforeEach(() => {
    calls = [];
    global.fetch = jest.fn(async (_url: unknown, init: { body?: string }) => {
      calls.push(JSON.parse(init.body ?? "{}"));
      return { ok: true, status: 200, json: async () => ({ translation: "  развёртывание  " }) } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  it("sends the word, context and lang, and trims the translation", async () => {
    setApiLang("ru");
    const out = await translate("deployment", "The midnight deployment failed.");
    expect(out).toBe("развёртывание");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      text: "deployment",
      context: "The midnight deployment failed.",
      lang: "ru",
    });
  });

  it("caches by word+context+lang: a repeat tap makes no second request", async () => {
    setApiLang("ru");
    await translate("cache-me", "ctx");
    await translate("cache-me", "ctx");
    expect(calls).toHaveLength(1);
  });

  it("does not reuse the cache across a different UI language", async () => {
    setApiLang("ru");
    await translate("bank", "the river bank");
    setApiLang("en");
    await translate("bank", "the river bank");
    expect(calls).toHaveLength(2);
    expect(calls[1].lang).toBe("en");
  });

  it("returns empty for blank input without calling the backend", async () => {
    const out = await translate("   ");
    expect(out).toBe("");
    expect(calls).toHaveLength(0);
  });
});
