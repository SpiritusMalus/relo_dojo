// Render tests for the tap-based exercise components (Phase 6: first app component tests).
// They render under a real ThemeProvider, assert the screen-reader contract added in the a11y pass
// (every option is a labeled button with a selected/disabled state), and that taps report the right
// answer value through onChange — and that `locked` suppresses input.
import { createElement, type ReactElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import MultipleChoice from "../MultipleChoice";
import TapError from "../TapError";
import MultipleBlanks from "../MultipleBlanks";
import { ThemeProvider } from "../../theme/theme";
import type { Exercise } from "../../services/api";

function ex(over: Partial<Exercise>): Exercise {
  return {
    type: "multiple-choice",
    topic: "prepositions",
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

// A Pressable shows up twice in the tree: the composite (carries the real onPress handler) and the
// host View it renders (carries the forwarded a11y props). Read a11y state from the host nodes;
// fire presses on the composite.
const buttons = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.props.accessibilityRole === "button" && typeof n.type === "string");

function press(r: ReactTestRenderer, label: string): void {
  const composite = r.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function"
  )[0];
  act(() => composite.props.onPress());
}

describe("MultipleChoice", () => {
  it("renders each option as a labeled button and reports the picked value", () => {
    const onChange = jest.fn();
    const r = render(
      <MultipleChoice exercise={ex({ text: "I ___ home", options: ["go", "goes"] })} locked={false} onChange={onChange} />
    );
    expect(buttons(r).map((b) => b.props.accessibilityLabel)).toEqual(["go", "goes"]);

    press(r, "go");
    expect(onChange).toHaveBeenCalledWith("go", "go");
    // After selection the chosen option exposes selected state for screen readers.
    expect(buttons(r)[0].props.accessibilityState.selected).toBe(true);
    expect(buttons(r)[1].props.accessibilityState.selected).toBe(false);
  });

  it("does not report when locked, and marks options disabled", () => {
    const onChange = jest.fn();
    const r = render(
      <MultipleChoice exercise={ex({ options: ["a", "b"] })} locked onChange={onChange} />
    );
    expect(buttons(r)[0].props.accessibilityState.disabled).toBe(true);
    press(r, "a");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("TapError", () => {
  it("labels each token and reports the tapped index", () => {
    const onChange = jest.fn();
    const r = render(
      <TapError exercise={ex({ type: "tap-the-error", tokens: ["He", "go", "home"] })} locked={false} onChange={onChange} />
    );
    const labels = buttons(r).map((b) => b.props.accessibilityLabel);
    expect(labels).toEqual(["Word: He", "Word: go", "Word: home"]);

    press(r, "Word: go");
    expect(onChange).toHaveBeenCalledWith(1, "go");
  });
});

describe("MultipleBlanks", () => {
  it("labels options per blank and only reports a complete answer", () => {
    const onChange = jest.fn();
    const r = render(
      <MultipleBlanks
        exercise={ex({ type: "multiple-blanks", text: "I ___ at ___", blankOptions: [["am", "is"], ["home", "work"]] })}
        locked={false}
        onChange={onChange}
      />
    );
    const labels = buttons(r).map((b) => b.props.accessibilityLabel);
    expect(labels).toContain("Blank 1, option am");
    expect(labels).toContain("Blank 2, option home");

    // First pick: incomplete → reports null answer.
    press(r, "Blank 1, option am");
    expect(onChange).toHaveBeenLastCalledWith(null, expect.any(String));
    // Second pick completes it → reports the ordered picks.
    press(r, "Blank 2, option home");
    expect(onChange).toHaveBeenLastCalledWith(["am", "home"], expect.any(String));
  });
});
