// Tap-to-translate interaction: long-pressing an English word inside an exercise fires the translate
// request and surfaces the result in the shared popover. Renders through ExerciseCard so the real
// TranslationProvider wraps the component (exactly as in the app).
import { createElement, type ReactElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

jest.mock("../../store/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

// Stub the network call: resolve on the microtask queue so we can flush it deterministically.
const mockTranslate = jest.fn(async (_word: string, _ctx?: string) => "развёртывание");
jest.mock("../../services/api", () => ({ translate: (w: string, c?: string) => mockTranslate(w, c) }));

import ExerciseCard from "../ExerciseCard";
import { ThemeProvider } from "../../theme/theme";
import type { Exercise } from "../../services/api";

function ex(over: Partial<Exercise>): Exercise {
  return {
    type: "multiple-choice",
    topic: "word order",
    level: "B1",
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

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

// All rendered strings in the tree (word spans, popover text, etc.).
const texts = (r: ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);

// Fire a long-press on the first node matching `pred` that carries an onLongPress handler.
const longPress = (r: ReactTestRenderer, pred: (n: any) => boolean) => {
  const node = r.root.findAll((n) => pred(n) && typeof n.props.onLongPress === "function")[0];
  act(() => node.props.onLongPress({ nativeEvent: { pageX: 100, pageY: 300 } }));
};
// Inline TranslatableText/MultipleBlanks word spans carry the handler on the word span itself.
const longPressWord = (r: ReactTestRenderer, word: string) =>
  longPress(r, (n) => n.props.children === word);
// Tile/token/option Pressables carry it alongside the a11y label.
const longPressButton = (r: ReactTestRenderer, label: string) =>
  longPress(r, (n) => n.props.accessibilityLabel === label);

beforeEach(() => { mockTranslate.mockReset(); mockTranslate.mockResolvedValue("развёртывание"); });

describe("tap-to-translate popover", () => {
  it("long-pressing a word in the English prompt requests + shows its translation", async () => {
    const r = render(
      <ExerciseCard
        exercise={ex({ type: "transform-the-sentence", prompt: "The deployment failed", tiles: ["The", "deployment", "failed"] })}
        locked={false}
        onChange={jest.fn()}
      />
    );

    longPressWord(r, "deployment");
    expect(mockTranslate).toHaveBeenCalledWith("deployment", "The deployment failed");
    // Popover shows the loading state immediately…
    expect(texts(r)).toContain("ex.translating");

    await flush();
    // …then the resolved translation.
    expect(texts(r)).toContain("развёртывание");
  });

  it("strips trailing punctuation before requesting a translation", async () => {
    const r = render(
      <ExerciseCard
        exercise={ex({ type: "tap-the-error", tokens: ["The", "deployment.", "failed"] })}
        locked={false}
        onChange={jest.fn()}
      />
    );
    longPressButton(r, "Word: deployment.");
    await flush();
    expect(mockTranslate).toHaveBeenCalledWith("deployment", "The deployment. failed");
  });

  it("records assistance only after a successful translation, never for a failed lookup", async () => {
    const hint = jest.fn();
    const r = render(<ExerciseCard exercise={ex({ text: "deployment" })} locked={false} onChange={jest.fn()} onHint={hint} />);
    longPressWord(r, "deployment");
    expect(hint).not.toHaveBeenCalled();
    await flush();
    expect(hint).toHaveBeenCalledTimes(1);
    mockTranslate.mockRejectedValueOnce(new Error("offline"));
    longPressWord(r, "deployment");
    await flush();
    expect(hint).toHaveBeenCalledTimes(1);
    act(() => r.unmount());
  });

  it("closed-book cards never request a translation or provide a hidden hint", async () => {
    const hint = jest.fn();
    const r = render(<ExerciseCard exercise={ex({ text: "deployment" })} locked={false} onChange={jest.fn()} onHint={hint} translationEnabled={false} />);
    longPressWord(r, "deployment");
    await flush();
    expect(mockTranslate).not.toHaveBeenCalled();
    expect(hint).not.toHaveBeenCalled();
    expect(texts(r)).not.toContain("ex.translating");
    act(() => r.unmount());
  });

  it("a previous card's late translation cannot mark the next attempt as assisted", async () => {
    let resolve!: (text: string) => void;
    mockTranslate.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const hint = jest.fn();
    const r = render(<ExerciseCard exercise={ex({ text: "deployment" })} locked={false} onChange={jest.fn()} onHint={hint} />);
    longPressWord(r, "deployment");
    act(() => r.unmount());
    await act(async () => { resolve("развёртывание"); });
    expect(hint).not.toHaveBeenCalled();
  });
});
