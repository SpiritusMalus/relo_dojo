// Render tests for the audio-first listening cards (Listen.tsx): the answer variant reuses the
// multiple-choice interaction under an audio card; the retell variant reports typed text (or a
// transcribed voice take behind the double voice gate); and the degrade path (expo-speech throwing
// on an un-rebuilt client) reveals the transcript instead of leaving a dead card. Same harness as
// exercises2.test.tsx.
import { createElement, type ReactElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import * as Speech from "expo-speech";

// i18n store mocked (key-passthrough) — components render localized instruction keys.
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));

// Voice consent store mocked (no provider in the test tree); tests flip `granted` per case.
const mockConsent = { ready: true, granted: false, accept: jest.fn(), revoke: jest.fn() };
jest.mock("../../store/voiceConsent", () => ({ useVoiceConsent: () => mockConsent }));

// VoiceConsentSheet pulls safe-area insets; there's no provider under the test renderer.
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Build flag flippable per test (real gate logic otherwise).
jest.mock("../../services/voice", () => {
  const actual = jest.requireActual("../../services/voice");
  return { ...actual, voiceFeatureEnabled: jest.fn(() => false) };
});

// Mic capture + STT: never touch native audio / network under jest.
jest.mock("../../services/voiceCapture", () => ({
  requestMicPermission: jest.fn(async () => true),
  startRecording: jest.fn(async () => ({})),
  stopRecording: jest.fn(async () => ({ uri: "file://take.m4a" })),
  uriToBase64: jest.fn(async () => "QUJD"),
}));
jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return { ...actual, transcribeAudio: jest.fn(async () => ({ transcript: "she painted it green" })) };
});

import ExerciseCard from "../ExerciseCard";
import { ThemeProvider } from "../../theme/theme";
import { voiceFeatureEnabled } from "../../services/voice";
import { transcribeAudio, type Exercise } from "../../services/api";

const PASSAGE = "Anna painted the door green last weekend.";

function ex(over: Partial<Exercise>): Exercise {
  return {
    type: "listen-and-answer",
    topic: "articles",
    level: "B1",
    text: "What color did Anna paint the door?",
    prompt: "",
    options: ["Green", "Red", "Blue"],
    tiles: [],
    tokens: [],
    left: [],
    right: [],
    blankOptions: [],
    speak: PASSAGE,
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
  const target = r.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function"
  )[0];
  act(() => target.props.onPress());
};

const texts = (r: ReactTestRenderer): string[] =>
  r.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);

// Press the (chunky) Button whose label text is `label` — Button doesn't forward an
// accessibilityLabel, so find the innermost pressable whose subtree renders that text.
const findPressableByText = (r: ReactTestRenderer, label: string) => {
  const owners = r.root
    .findAll((n) => typeof n.props.onPress === "function")
    .filter((n) => n.findAll((m) => m.props.children === label).length > 0);
  const node = owners[owners.length - 1]; // innermost
  if (!node) throw new Error(`no pressable with label "${label}"`);
  return node;
};

const pressByText = (r: ReactTestRenderer, label: string) => {
  const node = findPressableByText(r, label);
  act(() => node.props.onPress());
};

afterEach(() => {
  (Speech.speak as jest.Mock).mockReset();
  (Speech.stop as jest.Mock).mockReset();
  (voiceFeatureEnabled as jest.Mock).mockReturnValue(false);
  mockConsent.granted = false;
  mockConsent.accept.mockClear();
});

describe("Listen — listen-and-answer", () => {
  it("auto-plays the hidden passage and reports the tapped option", () => {
    const onChange = jest.fn();
    const r = render(createElement(ExerciseCard, { exercise: ex({}), locked: false, onChange }));
    // The passage went to TTS, not to the screen.
    expect(Speech.speak).toHaveBeenCalledWith(PASSAGE, expect.objectContaining({ language: "en-US" }));
    expect(texts(r)).not.toContain(PASSAGE);
    // The question + options are a plain multiple-choice interaction.
    press(r, "Green");
    expect(onChange).toHaveBeenCalledWith("Green", "Green");
  });

  it("degrades to a visible transcript when TTS is unavailable (un-rebuilt client)", () => {
    (Speech.speak as jest.Mock).mockImplementation(() => {
      throw new Error("native module missing");
    });
    const r = render(createElement(ExerciseCard, { exercise: ex({}), locked: false, onChange: jest.fn() }));
    // The card must stay solvable: the passage is revealed as text.
    expect(texts(r)).toContain(PASSAGE);
  });
});

describe("Listen — listen-and-retell", () => {
  const retellEx = () => ex({ type: "listen-and-retell", text: "", options: [] });

  it("reports the typed retelling and nulls out an emptied one", () => {
    const onChange = jest.fn();
    const r = render(createElement(ExerciseCard, { exercise: retellEx(), locked: false, onChange }));
    const input = r.root.findAll((n) => typeof n.props.onChangeText === "function")[0];
    act(() => input.props.onChangeText("she painted the door green"));
    expect(onChange).toHaveBeenLastCalledWith("she painted the door green", "she painted the door green");
    act(() => input.props.onChangeText("   "));
    expect(onChange).toHaveBeenLastCalledWith(null, "");
  });

  it("locks the input once the answer is checked", () => {
    const r = render(createElement(ExerciseCard, { exercise: retellEx(), locked: true, onChange: jest.fn() }));
    const input = r.root.findAll((n) => n.props.editable !== undefined)[0];
    expect(input.props.editable).toBe(false);
  });
});

describe("Listen — voice retell (double-gated mic)", () => {
  const retellEx = () => ex({ type: "listen-and-retell", text: "", options: [] });

  const pressAsync = async (r: ReactTestRenderer, label: string) => {
    const node = findPressableByText(r, label);
    await act(async () => {
      await node.props.onPress();
    });
  };

  it("keeps the mic dormant while the build flag is off", () => {
    const r = render(createElement(ExerciseCard, { exercise: retellEx(), locked: false, onChange: jest.fn() }));
    expect(texts(r)).not.toContain("ex.retellSpeak");
  });

  it("asks for the specific voice consent on the first mic tap", async () => {
    (voiceFeatureEnabled as jest.Mock).mockReturnValue(true);
    const r = render(createElement(ExerciseCard, { exercise: retellEx(), locked: false, onChange: jest.fn() }));
    await pressAsync(r, "ex.retellSpeak");
    // No capture happened — the consent sheet is up instead.
    expect(texts(r)).toContain("voice.consentTitle");
    pressByText(r, "voice.consentAccept");
    expect(mockConsent.accept).toHaveBeenCalled();
  });

  it("records, transcribes, and lands the take in the editable retell", async () => {
    (voiceFeatureEnabled as jest.Mock).mockReturnValue(true);
    mockConsent.granted = true;
    const onChange = jest.fn();
    const r = render(createElement(ExerciseCard, { exercise: retellEx(), locked: false, onChange }));
    await pressAsync(r, "ex.retellSpeak"); // start recording
    expect(texts(r)).toContain("voice.recording");
    await pressAsync(r, "voice.recording"); // stop → STT → input
    expect(transcribeAudio).toHaveBeenCalledWith("QUJD", "audio/m4a", "en");
    expect(onChange).toHaveBeenLastCalledWith("she painted it green", "she painted it green");
    // The transcript is editable text — the learner can still fix a word before checking.
    const input = r.root.findAll((n) => typeof n.props.onChangeText === "function")[0];
    expect(input.props.value).toBe("she painted it green");
  });
});
