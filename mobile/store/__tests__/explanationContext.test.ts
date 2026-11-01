import type { Exercise } from "../../services/api";
import { explanationContext } from "../explanationContext";

const base: Exercise = {
  type: "multiple-choice", topic: "word order", level: "B2", text: "Choose a sentence.", prompt: "",
  options: [], tiles: [], tokens: [], left: [], right: [], blankOptions: [], token: "secret-sealed-token",
};

it("keeps all choices when an oversized question must share the 2000-character budget", () => {
  const options = ["Always we leave early.", "Seldom do we leave early.", "Never have we left late.", "Rarely did we stay."];
  const context = explanationContext({ ...base, text: "Long question ".repeat(2000), options });
  expect(context.length).toBeLessThanOrEqual(2000);
  expect(JSON.parse(context).options).toEqual(options);
  expect(context).not.toContain(base.token);
});

it("keeps matching sides, blank groups, and token positions without serializing hidden fields", () => {
  const context = JSON.parse(explanationContext({ ...base, tokens: ["She", "go", "home"],
    left: [{ id: 7, text: "take" }], right: [{ id: 9, text: "a break" }],
    blankOptions: [["has", "have"], ["gone", "went"]], correct_answer: "hidden-answer" } as Exercise));
  expect(context).toMatchObject({ tokens: ["She", "go", "home"], left: ["take"], right: ["a break"], blankOptions: [["has", "have"], ["gone", "went"]] });
  expect(context).not.toHaveProperty("token");
  expect(context).not.toHaveProperty("correct_answer");
});

it("describes a transform's visible bank without identifying traps, and preserves the source instruction", () => {
  const context = JSON.parse(explanationContext({ ...base, type: "transform-the-sentence", prompt: "She left.",
    instruction: "Make a question.", tiles: ["Did", "she", "leave", "?"], distractors: ["left"] }));
  expect(context.prompt).toBe("She left.");
  expect(context.instruction).toBe("Make a question.");
  expect(context.tiles).toEqual(expect.arrayContaining(["Did", "she", "leave", "?", "left"]));
  expect(context).not.toHaveProperty("distractors");
});

it("includes the listening passage for post-grade explanation and the given dialog opening", () => {
  const card = { ...base, type: "listen-and-answer" as const, speak: "The earlier train was cancelled.", anchor: "What happened?", tiles: ["The train was cancelled."] };
  expect(JSON.parse(explanationContext(card))).toMatchObject({ speak: card.speak, anchor: card.anchor, tiles: card.tiles });
  expect(JSON.parse(explanationContext({ ...card, type: "multiple-choice" }))).not.toHaveProperty("speak");
});

it("still bounds malformed lists whose structure alone exceeds the context limit", () => {
  const context = explanationContext({ ...base, options: Array.from({ length: 2000 }, (_, i) => String(i)) });
  expect(context.length).toBeLessThanOrEqual(2000);
  expect(context).toContain("[context truncated]");
});
