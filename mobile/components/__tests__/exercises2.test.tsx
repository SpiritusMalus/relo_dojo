// Render tests for the remaining tap-based exercise components (BuildSentence, MatchPairs,
// OrderDialog) — completes the per-type coverage started in exercises.test.tsx. Same approach:
// render under a real ThemeProvider, drive the labeled buttons, assert the reported answer.
import { createElement, type ReactElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import BuildSentence from "../BuildSentence";
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
});
