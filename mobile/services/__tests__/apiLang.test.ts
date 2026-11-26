// getExercise / getStory must carry the UI language so the backend can write LLM-generated task
// instructions (transform-the-sentence) in the learner's language. The other LLM endpoints already
// send `lang`; these two were the gap (explanation-lang-ru).
import { fetch as expoFetch } from "expo/fetch";
import { assessWriting, getExercise, getStory, setApiLang } from "../api";

describe("getExercise / getStory send the UI lang", () => {
  let lastBody: Record<string, unknown>;

  beforeEach(() => {
    lastBody = {};
    const receive = (body: unknown) => {
      lastBody = JSON.parse(typeof body === "string" ? body : "{}");
      return { ok: true, status: 200, json: async () => ({}) };
    };
    jest.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => receive(init?.body) as Response);
    jest.mocked(expoFetch).mockImplementation(async (_url, init) => receive(init?.body) as Awaited<ReturnType<typeof expoFetch>>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it("carries the topic's persisted practice index to generation", async () => {
    await getExercise({ topic: "word order", level: "A2", practice_index: 7 });
    expect(lastBody.practice_index).toBe(7);
    expect(lastBody.topic).toBe("word order");
  });

  it("getStory sends lang", async () => {
    setApiLang("ru");
    await getStory({ id: "arc-1" });
    expect(lastBody.lang).toBe("ru");
    expect(lastBody.id).toBe("arc-1");
  });

  it("assessWriting sends the text, prompt and lang", async () => {
    setApiLang("ru");
    await assessWriting("My answer here.", "Describe your weekend.");
    expect(lastBody.text).toBe("My answer here.");
    expect(lastBody.prompt).toBe("Describe your weekend.");
    expect(lastBody.lang).toBe("ru");
  });
});
