// getExercise / getStory must carry the UI language so the backend can write LLM-generated task
// instructions (transform-the-sentence) in the learner's language. The other LLM endpoints already
// send `lang`; these two were the gap (explanation-lang-ru).
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

import { getExercise, getStory, setApiLang } from "../api";

describe("getExercise / getStory send the UI lang", () => {
  let lastBody: Record<string, unknown>;

  beforeEach(() => {
    lastBody = {};
    global.fetch = jest.fn(async (_url: unknown, init: { body?: string }) => {
      lastBody = JSON.parse(init.body ?? "{}");
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  it("getExercise puts lang in the request body alongside the steering params", async () => {
    setApiLang("ru");
    await getExercise({ topic: "articles" });
    expect(lastBody.lang).toBe("ru");
    expect(lastBody.topic).toBe("articles");
  });

  it("getExercise with no params still sends lang", async () => {
    setApiLang("en");
    await getExercise();
    expect(lastBody.lang).toBe("en");
  });

  it("getStory sends lang", async () => {
    setApiLang("ru");
    await getStory({ id: "arc-1" });
    expect(lastBody.lang).toBe("ru");
    expect(lastBody.id).toBe("arc-1");
  });
});
