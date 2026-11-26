import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import StoryScreen from "../story";
import Button from "../../components/ui/Button";
import { ThemeProvider } from "../../theme/theme";
import { buyContent, getStory, getStoryCatalog, retryStoryBeat, type Exercise, type StoryCatalog } from "../../services/api";
import { setAccountToken } from "../../store/accountScope";

const mockRefresh = jest.fn(async () => {});
const mockReset = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ lang: "en", t: (key: string) => key }) }));
jest.mock("../../store/progress", () => {
  const actual = jest.requireActual("../../store/progress");
  return { ...actual, useProgress: () => ({ progress: actual.DEFAULT_PROGRESS }) };
});
jest.mock("../../store/wallet", () => ({ useWallet: () => ({ coins: 999, refresh: mockRefresh }) }));
jest.mock("../../store/useExerciseCheck", () => ({ useExerciseCheck: () => ({
  reset: mockReset, beginAttempt: jest.fn(), check: jest.fn(), doExplain: jest.fn(), markHintUsed: jest.fn(),
}) }));
jest.mock("../../services/api", () => ({
  ...jest.requireActual("../../services/api"), buyContent: jest.fn(), getStory: jest.fn(), getStoryCatalog: jest.fn(), retryStoryBeat: jest.fn(),
}));
jest.mock("../../components/ui/Sensei", () => () => null);
jest.mock("../../components/ui/Confetti", () => () => null);
jest.mock("../../components/ui/ActivationBanner", () => () => null);
jest.mock("../../components/ExerciseCard", () => () => null);
jest.mock("../../components/ResultPanel", () => () => null);

const catalog: StoryCatalog = { featured_id: "arc", arcs: [
  { id: "arc", title: "Synthetic arc", intro: "A day", locked: true, owned: false, price: 10, featured: true },
] };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
let renderer: ReactTestRenderer | undefined;
async function mount() {
  await act(async () => { renderer = TestRenderer.create(<ThemeProvider><StoryScreen /></ThemeProvider>); });
}
function arcPress() {
  expect(JSON.stringify(renderer!.toJSON())).toContain("Synthetic arc");
  return renderer!.root.findAll((node) => typeof node.props.onPress === "function" &&
    node.findAll((child) => child.props.children === "Synthetic arc").length > 0)[0].props.onPress;
}
beforeEach(() => {
  jest.clearAllMocks();
  setAccountToken("story-session-a");
  jest.mocked(getStoryCatalog).mockResolvedValue(catalog);
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; setAccountToken(null); });

it("does not generate a B story when A's catalog fails after the account changes", async () => {
  const old = deferred<StoryCatalog>();
  jest.mocked(getStoryCatalog).mockReturnValueOnce(old.promise);
  await mount();
  setAccountToken("story-session-b");
  await act(async () => { old.reject(new Error("session_changed")); });
  expect(getStory).not.toHaveBeenCalled();
});

it("does not fall back to paid generation after the story screen has unmounted", async () => {
  const old = deferred<StoryCatalog>();
  jest.mocked(getStoryCatalog).mockReturnValueOnce(old.promise);
  await mount();
  act(() => renderer!.unmount()); renderer = undefined;
  await act(async () => { old.reject(new Error("offline")); });
  expect(getStory).not.toHaveBeenCalled();
});

it("does not refresh or generate for B after A's content purchase resolves", async () => {
  await mount();
  const old = deferred<{ owned: string[]; coins: number }>();
  jest.mocked(buyContent).mockReturnValueOnce(old.promise);
  let buying!: Promise<void>;
  act(() => { buying = arcPress()(); });
  expect(buyContent).toHaveBeenCalledTimes(1);
  setAccountToken("story-session-b");
  await act(async () => { old.resolve({ owned: ["arc"], coins: 989 }); await buying; });
  expect(mockRefresh).not.toHaveBeenCalled();
  expect(getStory).not.toHaveBeenCalled();
});

it("does not let an old A arc callback buy content with B's bearer", async () => {
  await mount();
  const oldPress = arcPress();
  setAccountToken("story-session-b");
  await act(async () => { await oldPress(); });
  expect(buyContent).not.toHaveBeenCalled();
  expect(getStory).not.toHaveBeenCalled();
});

it("retries only the unavailable story beat and preserves the rest of the run", async () => {
  const exercise: Exercise = {
    type: "multiple-choice", topic: "articles", level: "A1", text: "I bought ___ apple.",
    prompt: "", options: ["a", "an"], tiles: [], tokens: [], left: [], right: [], blankOptions: [], token: "fixture",
  };
  jest.mocked(getStoryCatalog).mockResolvedValueOnce({ ...catalog, arcs: [{ ...catalog.arcs[0], owned: true }] });
  jest.mocked(getStory).mockResolvedValueOnce({
    id: "arc", level: "A1", title: "Shared flat", intro: "At the market", resume_token: "resume-for-fixture",
    beats: [{ exercise: null, narration: "The first part needs a retry." }, { exercise, narration: "The next part is already here." }],
  });
  await mount();
  await act(async () => { await arcPress()(); });
  const action = (label: string) => renderer!.root.findAll((node) => node.type === Button && node.props.label === label)[0];
  expect(JSON.stringify(renderer!.toJSON())).toContain("The first part needs a retry.");
  const retry = deferred<Exercise>();
  jest.mocked(retryStoryBeat).mockReturnValueOnce(retry.promise);
  const press = action("action.tryAgain").props.onPress;
  act(() => { press(); press(); });
  expect(retryStoryBeat).toHaveBeenCalledTimes(1);
  expect(retryStoryBeat).toHaveBeenCalledWith("resume-for-fixture", 0, expect.objectContaining({ aborted: false }));
  expect(action("story.preparingBeat").props.disabled).toBe(true);
  await act(async () => { retry.resolve(exercise); });
  expect(action("action.check")).toBeDefined();
  expect(JSON.stringify(renderer!.toJSON())).toContain("The first part needs a retry.");
  expect(getStory).toHaveBeenCalledTimes(1);
});
