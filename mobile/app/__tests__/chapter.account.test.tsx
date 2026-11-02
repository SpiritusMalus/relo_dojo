import AsyncStorage from "@react-native-async-storage/async-storage";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { TextInput } from "react-native";
import ChapterScreen from "../chapter";
import Button from "../../components/ui/Button";
import ExerciseCard from "../../components/ExerciseCard";
import { ThemeProvider } from "../../theme/theme";
import { request, setAuthToken } from "../../services/api";
import { captureAccountScope } from "../../store/accountScope";
import { chapterDraftKey, type ChapterRun, type ChapterFeedback } from "../../services/chapters";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockRoomRefresh = jest.fn(async () => {});
const mockAcceptSnapshot = jest.fn();
const mockReset = jest.fn();
const mockBeginAttempt = jest.fn();
const mockCheck = jest.fn();
const mockExplain = jest.fn();
const mockMarkHint = jest.fn();
let mockToken: string | null = null;
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ id: "introduction" }), useRouter: () => ({ back: mockBack, push: mockPush, replace: mockReplace }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("../../store/i18n", () => ({ useI18n: () => ({ lang: "en", t: (key: string) => key }) }));
jest.mock("../../store/auth", () => ({ useAuth: () => ({ token: mockToken }) }));
jest.mock("../../store/progress", () => {
  const actual = jest.requireActual("../../store/progress");
  return { ...actual, useProgress: () => ({ progress: actual.DEFAULT_PROGRESS }) };
});
jest.mock("../../store/useExerciseCheck", () => ({ useExerciseCheck: () => ({
  result: null, checking: false, error: null, reset: mockReset, beginAttempt: mockBeginAttempt, check: mockCheck,
  doExplain: mockExplain, markHintUsed: mockMarkHint,
}) }));
jest.mock("../../store/dojoRoom", () => ({ useDojoRoom: () => ({ refresh: mockRoomRefresh, acceptSnapshot: mockAcceptSnapshot }) }));
jest.mock("../../services/api", () => ({ ...jest.requireActual("../../services/api"), request: jest.fn() }));
jest.mock("../../components/ui/Sensei", () => () => null);
jest.mock("../../components/ui/DojoItemArtwork", () => () => null);
jest.mock("../../components/ExerciseCard", () => () => null);
jest.mock("../../components/ResultPanel", () => () => null);

const member = (id: string) => `header.${Buffer.from(JSON.stringify({ sub: id })).toString("base64url")}.signature`;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const approved: ChapterFeedback = { completed: true, requirements: [], explanation: "A useful introduction.", example: "", tip: "" };
const declined: ChapterFeedback = { completed: false, requirements: [{ id: "interest", met: false }], explanation: "Mention something you enjoy.", example: "I enjoy cooking.", tip: "" };
let run: ChapterRun;
let renderer: ReactTestRenderer | undefined;
let finalRequests: number;
function makeRun(): ChapterRun {
  return { id: "run-a", chapter_id: "introduction", manifest_version: 1, preparation_count: 3, graded_count: 3,
    completed: false, exercise: null, final_prompt: "Introduce yourself.", requirements: [], feedback: null,
    feedback_submission_id: null, pending_submission_id: null, receipt_id: null };
}
async function mount() { await act(async () => { renderer = TestRenderer.create(<ThemeProvider><ChapterScreen /></ThemeProvider>); }); }
function button(label: string) { return renderer!.root.findAll((node) => node.type === Button).find((node) => node.props.label === label)!; }
async function type(text: string) { await act(async () => { renderer!.root.findAll((node) => node.type === TextInput)[0].props.onChangeText(text); }); }
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear(); mockToken = member("a"); setAuthToken(mockToken); run = makeRun(); finalRequests = 0;
  jest.mocked(request).mockImplementation(async (path, body) => {
    if (path === "/chapters") return { version: 1, chapters: [{ id: "introduction", version: 1, keepsake_id: "dojo_display_introduction", preparation_count: 3, completed: run.completed, run_id: run.id }] } as any;
    if (path.endsWith("/final")) {
      finalRequests++;
      run = { ...run, feedback: declined, feedback_submission_id: (body as any).submission_id };
      return { run: { ...run }, feedback: declined, dojo: null } as any;
    }
    return { ...run } as any;
  });
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; mockToken = null; setAuthToken(null); });

it("shows an honest guest sign-in path without starting a run or granting an item", async () => {
  mockToken = null; setAuthToken(null); await mount();
  expect(JSON.stringify(renderer!.toJSON())).toContain("save your progress");
  expect(button("Sign in")).toBeDefined(); expect(request).not.toHaveBeenCalled();
  expect(renderer!.root.findAll((node) => node.type === TextInput)).toHaveLength(0); expect(mockAcceptSnapshot).not.toHaveBeenCalled();
});

it("keeps a rejected reply editable and shows actionable feedback without claiming the keepsake", async () => {
  await mount(); await type("I'm Alex. I study.");
  await act(async () => { await button("Check").props.onPress(); });
  expect(JSON.stringify(renderer!.toJSON())).toContain("Mention something you enjoy.");
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("Chapter completed");
  expect(renderer!.root.findAll((node) => node.type === TextInput)[0].props.editable).toBe(true);
  expect(renderer!.root.findAll((node) => node.type === TextInput)[0].props.value).toBe("I'm Alex. I study.");
  expect(mockAcceptSnapshot).not.toHaveBeenCalled(); expect(finalRequests).toBe(1);
});

it("remounts immediately on account replacement and ignores A's pending completion", async () => {
  await mount(); await type("Private introduction A. I study. I enjoy art.");
  const old = deferred<any>(); const original = jest.mocked(request).getMockImplementation()!;
  jest.mocked(request).mockImplementation(async (path, body, method) => path.endsWith("/final") ? old.promise : original(path, body, method));
  act(() => { button("Check").props.onPress(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(renderer!.root.findAll((node) => node.type === TextInput)[0].props.editable).toBe(false);
  await act(async () => { mockToken = member("b"); setAuthToken(mockToken); });
  expect(renderer!.root.findAll((node) => node.type === TextInput)[0].props.value).toBe("");
  expect(renderer!.root.findAll((node) => node.type === TextInput)[0].props.editable).toBe(true);
  expect(button("Check").props.disabled).toBe(true); // Empty B draft, not an inherited busy flag.
  await type("B's independent draft"); expect(button("Check").props.disabled).toBe(false);
  await act(async () => { old.resolve({ run: { ...run, completed: true, feedback: approved, receipt_id: "receipt-a" }, feedback: approved, dojo: { owned: ["dojo_display_introduction"] } }); });
  expect(mockAcceptSnapshot).not.toHaveBeenCalled();
  expect(renderer!.root.findAll((node) => node.type === TextInput)[0].props.value).toBe("B's independent draft");
  expect(button("Check").props.disabled).toBe(false);
});

it("does not publish an unmounted final response", async () => {
  await mount(); await type("Hi, I'm Alex. I work in a shop. I enjoy art.");
  const old = deferred<any>(); const original = jest.mocked(request).getMockImplementation()!;
  jest.mocked(request).mockImplementation(async (path, body, method) => path.endsWith("/final") ? old.promise : original(path, body, method));
  act(() => { button("Check").props.onPress(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  act(() => renderer!.unmount()); renderer = undefined;
  await act(async () => { old.resolve({ run: { ...run, completed: true, feedback: approved, receipt_id: "receipt-a" }, feedback: approved, dojo: { owned: ["dojo_display_introduction"] } }); });
  expect(mockAcceptSnapshot).not.toHaveBeenCalled();
});

it("shows the owner's local draft after an offline open without a check or completion action", async () => {
  const scope = captureAccountScope();
  await AsyncStorage.setItem(chapterDraftKey(scope, "introduction"), JSON.stringify({ clientId: "550e8400-e29b-41d4-a716-446655440000", runId: "run-a", text: "My recoverable local draft", pending: null }));
  jest.mocked(request).mockRejectedValue(new Error("offline")); await mount();
  expect(renderer!.root.findAll((node) => node.type === TextInput)[0].props.value).toBe("My recoverable local draft");
  expect(button("Check")).toBeUndefined(); expect(button("Try again")).toBeDefined();
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("Chapter completed");
  expect(mockAcceptSnapshot).not.toHaveBeenCalled();
});

it("renews an expired preparation token without skipping the ungraded step", async () => {
  run = { ...makeRun(), graded_count: 1, exercise: { type: "multiple-choice", token: "expired", text: "A task" } as any };
  await mount();
  const card = () => renderer!.root.findAll((node) => node.type === ExerciseCard)[0];
  act(() => card().props.onChange("answer", "answer"));
  mockCheck.mockImplementationOnce(async () => {
    run = { ...run, exercise: { ...run.exercise!, token: "renewed" } };
    return null;
  });
  await act(async () => { button("Check").props.onPress(); });
  expect(card().props.exercise.token).toBe("renewed");
  expect(JSON.stringify(renderer!.toJSON())).toContain("Preparation · 2 of 3");
  expect(mockAcceptSnapshot).not.toHaveBeenCalled();
});
