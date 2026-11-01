import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import * as Speech from "expo-speech";
import LevelTestScreen from "../level-test";
import { ThemeProvider } from "../../theme/theme";
import Button from "../../components/ui/Button";
import type { CalItem, CalSkill } from "../../store/calibrationBank";

const mockSave = jest.fn();
const mockBack = jest.fn();
const mockBank: CalItem[] = Array.from({ length: 16 }, (_, i) => {
  const skill = (["grammar", "vocab", "reading", "listening"] as CalSkill[])[i % 4];
  return { id: `q${i}`, topic: skill, skill, level: 2.5, text: `Question ${i}`, options: ["yes", "no"], answer: "yes",
    ...(skill === "listening" ? { speak: `Audio passage ${i}` } : {}),
    ...(skill === "reading" ? { passage: `Reading passage ${i}` } : {}),
  };
});

jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ lang: "en", t: (key: string) => key }) }));
jest.mock("../../store/progress", () => {
  const actual = jest.requireActual("../../store/progress");
  return { ...actual, useProgress: () => ({ progress: { ...actual.DEFAULT_PROGRESS, listening: { level: 4, attempts: 100 } }, applyLevelTest: mockSave }) };
});
jest.mock("../../store/calibrationBank", () => {
  const actual = jest.requireActual("../../store/calibrationBank");
  return { ...actual, pickItem: (_level: number, used: Set<string>, skill?: CalSkill) =>
    mockBank.find((item) => !used.has(item.id) && (!skill || item.skill === skill)) ?? null };
});
jest.mock("../../components/ui/Sensei", () => () => null);
jest.mock("../../components/ui/Confetti", () => () => null);
jest.mock("../../components/ExerciseCard", () => {
  const { Pressable: NativePressable } = require("react-native");
  return ({ locked, onChange }: { locked: boolean; onChange: (value: string) => void }) =>
    <NativePressable accessibilityLabel="choose-answer" disabled={locked} onPress={() => onChange("yes")} />;
});

function button(r: ReactTestRenderer, label: string) {
  return r.root.findAll((node) => node.type === Button && node.props.label === label)[0];
}
async function press(r: ReactTestRenderer, label: string) {
  await act(async () => { button(r, label).props.onPress(); });
}
async function answer(r: ReactTestRenderer) {
  await act(async () => { r.root.findAll((node) => node.props.accessibilityLabel === "choose-answer")[0].props.onPress(); });
  await press(r, "action.check");
}
async function reachListening(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<ThemeProvider><LevelTestScreen /></ThemeProvider>); });
  await press(r, "lt.start");
  for (let i = 0; i < 3; i++) { await answer(r); await press(r, "action.continue"); }
  return r;
}

beforeEach(() => { jest.clearAllMocks(); jest.mocked(Speech.stop).mockResolvedValue(); });

it("cannot score an unheard passage; asynchronous failure can retry and a completed playback unlocks it", async () => {
  const callbacks: Speech.SpeechOptions[] = [];
  jest.mocked(Speech.speak).mockImplementation((_text, options) => { callbacks.push(options!); });
  const r = await reachListening();
  expect(button(r, "action.check").props.disabled).toBe(true);
  expect(r.root.findAll((node) => node.props.accessibilityLabel === "choose-answer")[0].props.disabled).toBe(true);
  await act(async () => { callbacks[0].onError?.(new Error("no voice")); });
  expect(button(r, "lt.retryAudio")).toBeTruthy();
  expect(button(r, "action.check").props.disabled).toBe(true);
  // Even a queued tap/callback bypassing the disabled UI cannot grade an unheard question.
  await answer(r);
  expect(button(r, "action.continue")).toBeUndefined();
  await act(async () => { callbacks[0].onDone?.(); }); // late native event after failure
  expect(button(r, "action.check").props.disabled).toBe(true);
  await press(r, "lt.retryAudio");
  await act(async () => { callbacks[1].onDone?.(); });
  await act(async () => { r.root.findAll((node) => node.props.accessibilityLabel === "choose-answer")[0].props.onPress(); });
  expect(button(r, "action.check").props.disabled).toBe(false);
  await press(r, "action.check");
  expect(button(r, "action.continue")).toBeTruthy();
  act(() => r.unmount());
});

it("a synchronous TTS failure has an explicit skip path and saves only the actually assessed skills", async () => {
  jest.mocked(Speech.speak).mockImplementation(() => { throw new Error("missing TTS"); });
  const r = await reachListening();
  expect(button(r, "lt.retryAudio")).toBeTruthy();
  await press(r, "lt.skipAudio");
  let guard = 0;
  while (!button(r, "lt.writingSkip") && guard++ < 20) {
    await answer(r);
    await press(r, "action.continue");
  }
  expect(Speech.speak).toHaveBeenCalledTimes(1); // remaining listening was excluded
  await press(r, "lt.writingSkip");
  expect(JSON.stringify(r.toJSON())).toContain("lt.partialResult");
  await press(r, "lt.save");
  const snapshot = mockSave.mock.calls[0][3];
  expect(snapshot.partial).toBe(true);
  expect(snapshot.skills.listening).toBeUndefined(); // not filled with old practice-only ability
  expect(Object.keys(snapshot.skills).sort()).toEqual(["grammar", "reading", "vocab"]);
  act(() => r.unmount());
});

it("a TTS engine that never calls back times out into retry and skip, never a dead Check button", async () => {
  jest.useFakeTimers();
  let r: ReactTestRenderer | undefined;
  try {
    jest.mocked(Speech.speak).mockImplementation(() => {});
    r = await reachListening();
    expect(button(r, "action.check").props.disabled).toBe(true);
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(button(r, "lt.retryAudio")).toBeTruthy();
    expect(button(r, "lt.skipAudio")).toBeTruthy();
    expect(button(r, "action.check").props.disabled).toBe(true);
  } finally {
    if (r) act(() => r!.unmount());
    jest.useRealTimers();
  }
});
