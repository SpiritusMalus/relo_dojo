import { createRef, useEffect, useState, type ReactElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Platform, Text, TextInput, View } from "react-native";
import FontScaleText from "../ui/FontScaleText";
import Txt from "../ui/Txt";
import Button from "../ui/Button";
import TranslatableText from "../ui/TranslatableText";
import FreeText from "../FreeText";
import { ThemeProvider } from "../../theme/theme";
import type { Exercise } from "../../services/api";

let mockDimensions = { width: 360, height: 800, scale: 3, fontScale: 1 };
const mockTranslateAt = jest.fn();
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({ __esModule: true, default: () => mockDimensions }));
jest.mock("../ui/TranslationPopover", () => ({ useTranslator: () => ({ translateAt: mockTranslateAt }) }));
jest.mock("../ui/DataGuard", () => () => null);
type Renderer = ReactTestRenderer & { update(element: ReactElement): void };
let screen: Renderer | undefined;
const originalOS = Platform.OS;
function mount(element: ReactElement) { act(() => { screen = TestRenderer.create(element) as Renderer; }); }
function update(element: ReactElement, dimensions: Partial<typeof mockDimensions>) {
  mockDimensions = { ...mockDimensions, ...dimensions }; act(() => screen!.update(element));
}
const text = (id: string) => screen!.root.findAll((item) => item.type === "Text" && item.props.testID === id)[0];
const input = () => screen!.root.findAll((item) => item.type === TextInput)[0];
beforeEach(() => {
  mockDimensions = { width: 360, height: 800, scale: 3, fontScale: 1 };
  Object.defineProperty(Platform, "OS", { configurable: true, value: "android" }); jest.clearAllMocks();
});
afterEach(() => {
  if (screen) act(() => screen!.unmount()); screen = undefined;
  Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
});

it("replaces retained Android text in both font-size directions while keeping ordinary width changes stable", () => {
  const node = () => <FontScaleText testID="copy">A retained label</FontScaleText>;
  mount(node()); const initial = text("copy");
  update(node(), { width: 320 }); expect(text("copy")).toBe(initial);
  update(node(), { fontScale: 1.3 }); const large = text("copy"); expect(large).not.toBe(initial);
  expect(large.props.children).toBe("A retained label"); expect(large.props.allowFontScaling).not.toBe(false);
  update(node(), { fontScale: 1 }); expect(text("copy")).not.toBe(large);
});

it("leaves iOS text mounted through its system font-size change", () => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  const node = () => <FontScaleText testID="copy">Native scaling</FontScaleText>;
  mount(node()); const initial = text("copy"); update(node(), { fontScale: 1.3 }); expect(text("copy")).toBe(initial);
});

it("forwards the caller's accessibility, text actions, native ref and scaling limit after replacement", () => {
  const ref = createRef<Text>(); const press = jest.fn(); const longPress = jest.fn();
  const node = () => <FontScaleText ref={ref} testID="copy" accessibilityLabel="Read this" selectable
    onPress={press} onLongPress={longPress} maxFontSizeMultiplier={2}>Interactive text</FontScaleText>;
  mount(node()); const oldRef = ref.current; update(node(), { fontScale: 1.3 });
  expect(text("copy").props).toMatchObject({ accessibilityLabel: "Read this", selectable: true, maxFontSizeMultiplier: 2 });
  act(() => { text("copy").props.onPress(); text("copy").props.onLongPress(); });
  expect(press).toHaveBeenCalledTimes(1); expect(longPress).toHaveBeenCalledTimes(1);
  expect(ref.current).not.toBeNull(); expect(ref.current).not.toBe(oldRef);
});

it("preserves the surrounding form, input identity, draft, focus state and selection", () => {
  const unmount = jest.fn(); const submit = jest.fn();
  function Form() {
    const [draft, setDraft] = useState(""); const [focused, setFocused] = useState(false);
    const [selection, setSelection] = useState({ start: 0, end: 0 });
    useEffect(() => () => unmount(), []);
    return <View><Txt testID="heading">Your reply</Txt>
      <TextInput value={draft} onChangeText={setDraft} selection={selection}
        onSelectionChange={(e) => setSelection(e.nativeEvent.selection)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
      <Txt testID="focus">{focused ? "Focused" : "Blurred"}</Txt>
      <Button label="Keep reply" onPress={() => submit(draft)} /></View>;
  }
  const node = () => <ThemeProvider><Form /></ThemeProvider>;
  mount(node()); const editor = input(); const heading = text("heading");
  act(() => { editor.props.onChangeText("My unsent answer"); editor.props.onFocus(); editor.props.onSelectionChange({ nativeEvent: { selection: { start: 3, end: 8 } } }); });
  for (const fontScale of [1.3, 1]) {
    update(node(), { fontScale }); expect(input()).toBe(editor);
    expect(editor.props).toMatchObject({ value: "My unsent answer", selection: { start: 3, end: 8 } });
    expect(text("focus").props.children).toBe("Focused"); expect(unmount).not.toHaveBeenCalled();
  }
  expect(text("heading")).not.toBe(heading);
  act(() => screen!.root.findAll((item) => item.type === Button)[0].props.onPress()); expect(submit).toHaveBeenCalledWith("My unsent answer");
});

it("keeps inline translation usable after replacing its outer paragraph", () => {
  const node = () => <ThemeProvider><TranslatableText text="Hello, new neighbour." /></ThemeProvider>;
  mount(node()); update(node(), { fontScale: 1.3 });
  const word = screen!.root.findAll((item) => item.props.children === "neighbour." && typeof item.props.onLongPress === "function")[0];
  act(() => word.props.onLongPress({ nativeEvent: { pageX: 45, pageY: 120 } }));
  expect(mockTranslateAt).toHaveBeenCalledWith("neighbour.", { x: 45, y: 120 }, "Hello, new neighbour.");
});

it("retains FreeText answers without remounting or resubmitting its editor", () => {
  const change = jest.fn(); const exercise = { text: "Tell us about your day." } as Exercise;
  const node = () => <FreeText exercise={exercise} locked={false} onChange={change} />;
  mount(node()); const editor = input(); act(() => editor.props.onChangeText("  I worked in the garden.  "));
  for (const fontScale of [1.3, 1]) { update(node(), { fontScale }); expect(input()).toBe(editor); expect(editor.props.value).toBe("  I worked in the garden.  "); }
  expect(change).toHaveBeenCalledTimes(1); expect(change).toHaveBeenCalledWith("I worked in the garden.", "I worked in the garden.");
});
