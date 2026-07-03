// Render tests for the remaining tap-based exercise components (BuildSentence, MatchPairs,
// OrderDialog) — completes the per-type coverage started in exercises.test.tsx. Same approach:
// render under a real ThemeProvider, drive the labeled buttons, assert the reported answer.
import { createElement, type ReactElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

// i18n store mocked (key-passthrough) — components render localized instruction keys; see exercises.test.
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

import BuildSentence from "../BuildSentence";
import ExerciseCard from "../ExerciseCard";
import MatchPairs from "../MatchPairs";
import OrderDialog from "../OrderDialog";
import { ThemeProvider } from "../../theme/theme";
import type { Exercise } from "../../services/api";

function ex(over: Partial<Exercise>): Exercise {
  return {
    type: "build-the-sentence",
    topic: "word order",
    level: "A2",
    text: "",
    prompt: "",
    options: [],
    tiles: [],
    tokens: [],
    left: [],
    right: [],
    blankOptions: [],
    token: "sealed",
    ...over,
  };
}

function render(node: ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(createElement(ThemeProvider, null, node));
  });
  return r;
}

const press = (r: ReactTestRenderer, label: string) => {
  const composite = r.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function"
  )[0];
  act(() => composite.props.onPress());
};

describe("BuildSentence", () => {
  it("places tiles in tap order and reports the assembled sentence only when complete", () => {
    const onChange = jest.fn();
    const r = render(
      <BuildSentence exercise={ex({ tiles: ["I", "am", "here"] })} locked={false} onChange={onChange} />
    );
    press(r, "I");
    expect(onChange).toHaveBeenLastCalledWith(null, "I"); // incomplete
    press(r, "am");
    press(r, "here");
    expect(onChange).toHaveBeenLastCalledWith("I am here", "I am here"); // all placed
  });

  // Distractor traps (e.g. the preposition a transform discarded) live in the bank but not in the
  // answer: submittable once ENOUGH words are placed, so the traps are meant to stay unused —
  // without them a correction card arrives visibly pre-corrected (prod screenshot 2026-07-03).
  it("banks distractors and submits with the traps left over", () => {
    const onChange = jest.fn();
    const r = render(
      <BuildSentence
        exercise={ex({
          type: "transform-the-sentence",
          instruction: "Fix the preposition",
          prompt: "We meet on 10 am.",
          tiles: ["We", "meet", "at", "10", "am."],
          distractors: ["on"],
        })}
        locked={false}
        onChange={onChange}
      />
    );
    // The trap renders as a tappable bank tile alongside the real words.
    expect(
      r.root.findAll((n) => n.props.accessibilityLabel === "on" && typeof n.props.onPress === "function").length
    ).toBeGreaterThan(0);
    for (const w of ["We", "meet", "at", "10"]) press(r, w);
    expect(onChange).toHaveBeenLastCalledWith(null, "We meet at 10"); // 4 of 5 → not submittable yet
    press(r, "am.");
    // 5 placed = the full answer length → submittable while "on" stays in the bank.
    expect(onChange).toHaveBeenLastCalledWith("We meet at 10 am.", "We meet at 10 am.");
  });

  it("lets the learner place a trap — a submittable wrong answer, not a dead end", () => {
    const onChange = jest.fn();
    const r = render(
      <BuildSentence
        exercise={ex({
          type: "transform-the-sentence",
          tiles: ["We", "meet", "at", "10", "am."],
          distractors: ["on"],
        })}
        locked={false}
        onChange={onChange}
      />
    );
    for (const w of ["We", "meet", "on", "10", "am."]) press(r, w);
    // Enough words placed (the trap among them) → submittable; the server grades it wrong.
    expect(onChange).toHaveBeenLastCalledWith("We meet on 10 am.", "We meet on 10 am.");
  });
});

describe("MatchPairs", () => {
  it("links a left item to a right item and reports the map when complete", () => {
    const onChange = jest.fn();
    const r = render(
      <MatchPairs
        exercise={ex({
          type: "match-pairs",
          left: [{ id: 1, text: "cat" }],
          right: [{ id: 2, text: "gato" }],
        })}
        locked={false}
        onChange={onChange}
      />
    );
    press(r, "cat");
    press(r, "gato");
    expect(onChange).toHaveBeenLastCalledWith({ "1": 2 }, expect.any(String));
  });
});

describe("OrderDialog", () => {
  it("appends lines in tap order and reports them only when all are placed", () => {
    const onChange = jest.fn();
    const r = render(
      <OrderDialog
        exercise={ex({ type: "order-the-dialog", tiles: ["Hi", "How are you?"] })}
        locked={false}
        onChange={onChange}
      />
    );
    press(r, "Hi");
    expect(onChange).toHaveBeenLastCalledWith(null, "Hi"); // incomplete
    press(r, "How are you?");
    expect(onChange).toHaveBeenLastCalledWith(["Hi", "How are you?"], "Hi → How are you?");
  });

  it("renders and reorders an 8-line dialog, reporting all lines in order", () => {
    const onChange = jest.fn();
    const lines = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];
    // Present them shuffled; the learner taps them back into the correct order.
    const shuffled = ["L3", "L1", "L8", "L5", "L2", "L7", "L4", "L6"];
    const r = render(
      <OrderDialog
        exercise={ex({ type: "order-the-dialog", tiles: shuffled })}
        locked={false}
        onChange={onChange}
      />
    );
    lines.forEach((l) => press(r, l));
    expect(onChange).toHaveBeenLastCalledWith(lines, lines.join(" → "));
  });
});

describe("ExerciseCard routing", () => {
  it("renders transform-the-sentence via the build-the-sentence tile UI and reports the joined answer", () => {
    const onChange = jest.fn();
    const tiles = ["She", "did", "not", "call", "me"];
    const r = render(
      <ExerciseCard
        exercise={ex({
          type: "transform-the-sentence",
          instruction: "Make it negative",
          prompt: "She called me",
          text: "Rewrite the sentence:",
          tiles,
        })}
        locked={false}
        onChange={onChange}
      />
    );
    // The transform instruction is surfaced in the prompt header.
    expect(r.root.findAll((n) => n.props.children === "Make it negative").length).toBeGreaterThan(0);
    // Tapping the tiles builds the sentence (same answer shape as build-the-sentence).
    tiles.forEach((w) => press(r, w));
    expect(onChange).toHaveBeenLastCalledWith("She did not call me", "She did not call me");
  });
});
