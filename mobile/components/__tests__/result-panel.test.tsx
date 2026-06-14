// Render tests for ResultPanel — the post-answer feedback shared by Practice and Story. The i18n and
// progress stores are mocked (they pull in the Auth→SecureStore provider chain that's irrelevant
// here), so the component renders under just ThemeProvider and we test its own branch logic: the
// correct answer on a miss, and whether the on-demand "Explain" affordance shows.
import { createElement, type ReactElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import ResultPanel from "../ResultPanel";
import { ThemeProvider } from "../../theme/theme";
import type { Exercise, ExplainResult } from "../../services/api";
import type { Result } from "../../store/useExerciseCheck";

jest.mock("../../store/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
jest.mock("../../store/progress", () => ({
  useProgress: () => ({ progress: { currentCorrectRun: 0 } }),
  XP_PER_CORRECT: 10,
}));

function ex(over: Partial<Exercise> = {}): Exercise {
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

// ResultPanel's only Pressable is "Explain"; find it on the composite (carries the onPress handler).
const explainButtons = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function");

const base = {
  exercise: ex(),
  levelUp: null,
  explained: null as ExplainResult | null,
  explainLoading: false,
};

describe("ResultPanel", () => {
  it("on a miss shows the correct answer and offers Explain (fires onExplain)", () => {
    const onExplain = jest.fn();
    const result: Result = { correct: false, correct_answer: "I go home" };
    const r = render(<ResultPanel {...base} result={result} onExplain={onExplain} />);

    expect(JSON.stringify(r.toJSON())).toContain("I go home");
    const btns = explainButtons(r);
    expect(btns).toHaveLength(1);
    act(() => btns[0].props.onPress());
    expect(onExplain).toHaveBeenCalledTimes(1);
  });

  it("celebrates the first-win and combo koku bonuses on a correct answer", () => {
    const result: Result = { correct: true, correct_answer: "ok", first_win_bonus: 10, combo_bonus: 8 };
    const r = render(<ResultPanel {...base} result={result} onExplain={jest.fn()} />);
    const out = JSON.stringify(r.toJSON());
    expect(out).toContain("result.firstWin"); // i18n key (mock passes keys through)
    expect(out).toContain("result.combo");
  });

  it("on a correct answer shows no Explain affordance", () => {
    const result: Result = { correct: true, correct_answer: "I go home" };
    const r = render(<ResultPanel {...base} result={result} onExplain={jest.fn()} />);
    expect(explainButtons(r)).toHaveLength(0);
  });

  it("hides Explain once an explanation already exists", () => {
    const result: Result = { correct: false, correct_answer: "x" };
    const explained: ExplainResult = { explanation: "Use 'at' for places.", tip: "Keep going." };
    const r = render(<ResultPanel {...base} result={result} explained={explained} onExplain={jest.fn()} />);
    expect(explainButtons(r)).toHaveLength(0);
    expect(JSON.stringify(r.toJSON())).toContain("Use 'at' for places.");
  });
});
