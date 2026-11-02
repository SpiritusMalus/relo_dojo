import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError, request, setAuthToken } from "../api";
import { captureAccountScope } from "../../store/accountScope";
import {
  ChapterPendingError, chapterDraftKey, chapterErasureKey, createChapterSession, purgeChapterDrafts,
  type ChapterRun, type ChapterCatalog, type ChapterFeedback,
} from "../chapters";

jest.mock("../api", () => ({ ...jest.requireActual("../api"), request: jest.fn() }));
const member = (id: string) => `header.${Buffer.from(JSON.stringify({ sub: id })).toString("base64url")}.signature`;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const approved: ChapterFeedback = { completed: true, requirements: [{ id: "identity", met: true }], explanation: "You introduced yourself.", example: "", tip: "" };
const declined: ChapterFeedback = { completed: false, requirements: [{ id: "interest", met: false }], explanation: "Add something you enjoy.", example: "I enjoy cycling.", tip: "" };
const makeRun = (): ChapterRun => ({ id: "run-a", chapter_id: "introduction", manifest_version: 1, preparation_count: 3,
  graded_count: 3, completed: false, exercise: null, final_prompt: "Introduce yourself.", requirements: [], feedback: null,
  feedback_submission_id: null, pending_submission_id: null, receipt_id: null });
let run: ChapterRun;
let exists: boolean;
let finalRequests: { submission_id: string; text: string }[];
function catalog(): ChapterCatalog {
  return { version: 1, chapters: [{ id: "introduction", version: 1, keepsake_id: "dojo_display_introduction", preparation_count: 3,
    completed: run.completed, run_id: exists ? run.id : null }] };
}
function complete(id: string) { run = { ...run, completed: true, feedback: approved, feedback_submission_id: id, receipt_id: "receipt-a", pending_submission_id: null }; }
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear(); setAuthToken(member("a")); run = makeRun(); exists = true; finalRequests = [];
  jest.mocked(request).mockImplementation(async (path, body, method) => {
    if (path === "/chapters") return catalog() as any;
    if (path.endsWith("/start")) { exists = true; return { ...run } as any; }
    if (path.endsWith("/final")) {
      const answer = body as { submission_id: string; text: string }; finalRequests.push(answer); complete(answer.submission_id);
      return { run: { ...run }, feedback: approved, dojo: null } as any;
    }
    if (method === "GET") return { ...run } as any;
    throw new Error("Unexpected chapter request");
  });
});
afterEach(() => setAuthToken(null));
async function opened() {
  const session = createChapterSession(captureAccountScope(), "introduction", "en"); await session.open(); return session;
}

test("resumes the server run and local owner draft without creating a replacement", async () => {
  const first = await opened(); await first.saveText("Hi, I'm Alex. I study. I enjoy chess."); first.dispose();
  const resumed = await opened();
  expect(resumed.snapshot()?.draft.text).toContain("Alex");
  expect(jest.mocked(request).mock.calls.some(([path]) => path.endsWith("/start"))).toBe(false);
});

test("an uncertain start is recovered through the catalog without another POST", async () => {
  exists = false;
  jest.mocked(request).mockImplementation(async (path) => {
    if (path === "/chapters") return catalog() as any;
    if (path.endsWith("/start")) { exists = true; throw new Error("response lost"); }
    return { ...run } as any;
  });
  const session = await opened();
  expect(session.snapshot()?.run.id).toBe("run-a");
  expect(jest.mocked(request).mock.calls.filter(([path]) => path.endsWith("/start"))).toHaveLength(1);
});

test("double submit sends one request and only canonical completion clears the draft", async () => {
  const session = await opened(); await session.saveText("Hi, I'm Alex. I work in a shop. I enjoy art.");
  const [one, two] = await Promise.all([session.submit(), session.submit()]);
  expect(one.run.completed).toBe(true); expect(two).toEqual(one); expect(finalRequests).toHaveLength(1);
  expect(session.snapshot()?.draft).toMatchObject({ pending: null, text: "" });
});

test("a committed final with a lost response is recovered by GET without a second grading call", async () => {
  const session = await opened(); await session.saveText("Hi, I'm Alex. I study art. I enjoy cycling.");
  jest.mocked(request).mockImplementation(async (path, body) => {
    if (path.endsWith("/final")) { const answer = body as { submission_id: string; text: string }; finalRequests.push(answer); complete(answer.submission_id); throw new Error("response lost"); }
    return { ...run } as any;
  });
  const result = await session.submit();
  expect(result.run.completed).toBe(true); expect(result.dojo).toBeNull(); expect(finalRequests).toHaveLength(1);
});

test("a lost rejection is matched to its submission and permits editing", async () => {
  const session = await opened(); await session.saveText("I'm Alex. I study.");
  jest.mocked(request).mockImplementation(async (path, body) => {
    if (path.endsWith("/final")) {
      const answer = body as { submission_id: string }; run = { ...run, feedback: declined, feedback_submission_id: answer.submission_id };
      throw new Error("response lost");
    }
    return { ...run } as any;
  });
  const result = await session.submit();
  expect(result.feedback.completed).toBe(false); expect(session.snapshot()?.draft.pending).toBeNull();
  await session.saveText("I'm Alex. I study. I enjoy music.");
  expect(session.snapshot()?.draft.text).toContain("music");
});

test("unknown results freeze the exact body; cold recovery reads first and retries the same identity", async () => {
  const first = await opened(); await first.saveText("I'm Alex. I study art. I enjoy music.");
  const initial = jest.mocked(request).getMockImplementation()!;
  jest.mocked(request).mockImplementation(async (path, body, method) => {
    if (path.endsWith("/final")) { finalRequests.push(body as any); throw new Error("offline"); }
    if (path.includes("/runs/")) throw new Error("offline");
    return initial(path, body, method);
  });
  await expect(first.submit()).rejects.toBeInstanceOf(ChapterPendingError);
  const pending = first.snapshot()!.draft.pending!;
  await first.saveText("Different reply"); expect(first.snapshot()?.draft.text).toContain("Alex"); first.dispose();
  jest.mocked(request).mockImplementation(async (path, body, method) => {
    if (path.endsWith("/final")) { finalRequests.push(body as any); complete(pending.id); return { run, feedback: approved, dojo: null } as any; }
    return initial(path, body, method);
  });
  const resumed = await opened();
  const before = jest.mocked(request).mock.calls.length;
  await resumed.submit();
  const recoveryCalls = jest.mocked(request).mock.calls.slice(before);
  expect(recoveryCalls[0][2]).toBe("GET");
  expect(finalRequests).toEqual([{ submission_id: pending.id, text: pending.text }, { submission_id: pending.id, text: pending.text }]);
});

test("an in-flight 409 keeps the request id instead of creating a new attempt", async () => {
  const session = await opened(); await session.saveText("I'm Alex. I study art. I enjoy music.");
  jest.mocked(request).mockImplementation(async (path, body) => {
    if (path.endsWith("/final")) { finalRequests.push(body as any); throw new ApiError("Checking", 409, "chapter_submission_pending"); }
    return { ...run } as any;
  });
  await expect(session.submit()).rejects.toBeInstanceOf(ChapterPendingError);
  expect(session.snapshot()?.draft.pending?.id).toBe(finalRequests[0].submission_id);
});

test("account changes reject stale callbacks and prevent the old draft from entering the new account", async () => {
  const first = await opened(); await first.saveText("Private draft A"); const ownerA = captureAccountScope();
  setAuthToken(member("b"));
  expect(() => first.submit()).toThrow(ApiError);
  expect(finalRequests).toHaveLength(0);
  const second = await opened(); expect(second.snapshot()?.draft.text).toBe("");
  const ownerB = captureAccountScope();
  expect(chapterDraftKey(ownerA, "introduction")).not.toBe(chapterDraftKey(ownerB, "introduction"));
});

test("an old in-flight response cannot publish a receipt or write with the new owner", async () => {
  const session = await opened(); await session.saveText("Hi, I'm Alex. I study art. I enjoy music.");
  const response = deferred<any>(); jest.mocked(request).mockImplementation(async () => response.promise);
  const submitting = session.submit();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  setAuthToken(member("b"));
  response.resolve({ run: { ...run, completed: true, feedback: approved, receipt_id: "receipt-a" }, feedback: approved, dojo: null });
  await expect(submitting).rejects.toMatchObject({ code: "session_changed" });
  expect(session.snapshot()).toBeNull();
});

test("an unready run and guest scope cannot claim completion", async () => {
  run.graded_count = 2; const session = await opened(); await session.saveText("Arbitrary local answers");
  await expect(session.submit()).rejects.toMatchObject({ code: "chapter_not_ready" }); expect(finalRequests).toHaveLength(0);
  setAuthToken(null); const guest = createChapterSession(captureAccountScope(), "introduction", "en");
  expect(() => guest.open()).toThrow(ApiError);
});

test("malformed cache cannot provide a pending result or completed chapter", async () => {
  const scope = captureAccountScope();
  await AsyncStorage.setItem(chapterDraftKey(scope, "introduction"), JSON.stringify({ clientId: "forged", text: "", pending: { id: "forged" }, completed: true }));
  const session = await opened(); expect(session.snapshot()?.run.completed).toBe(false); expect(session.snapshot()?.draft.pending).toBeNull();
});


test("account deletion purges only that owner's chapter text across chapters and manifest versions", async () => {
  const owner = captureAccountScope();
  const session = await opened(); await session.saveText("Private draft to erase");
  const ownPrefix = chapterDraftKey(owner, "introduction").replace("introduction/1", "");
  await AsyncStorage.setItem(`${ownPrefix}experience/2`, "another private draft");
  await AsyncStorage.setItem("relo_dojo/chapters/v1/user%3Ab/introduction/1", "B's draft");
  await purgeChapterDrafts(owner);
  expect((await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(ownPrefix))).toEqual([]);
  expect(await AsyncStorage.getItem("relo_dojo/chapters/v1/user%3Ab/introduction/1")).toBe("B's draft");
  await expect(session.saveText("Late callback")).rejects.toMatchObject({ code: "chapter_account_deleted" });
});

test("purge waits behind an in-flight native write and prevents queued writes from resurrecting text", async () => {
  const owner = captureAccountScope(); const session = await opened();
  const nativeWrite = deferred<void>();
  const original = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key, value) => {
    await nativeWrite.promise; return original(key, value);
  });
  const saving = session.saveText("Sensitive text");
  await Promise.resolve(); await Promise.resolve();
  const queued = session.saveText("Even later text");
  const queuedResult = queued.catch((error) => error);
  const removed = purgeChapterDrafts(owner);
  nativeWrite.resolve();
  await saving.catch(() => {}); await removed;
  expect(await queuedResult).toMatchObject({ code: "chapter_account_deleted" });
  expect(await AsyncStorage.getItem(chapterDraftKey(owner, "introduction"))).toBeNull();
  jest.mocked(AsyncStorage.setItem).mockImplementation(original);
});

test("relogin after deletion cannot reuse a deleted controller or its draft", async () => {
  const old = await opened(); await old.saveText("Deleted account's raw answer");
  await purgeChapterDrafts(captureAccountScope()); setAuthToken(null); setAuthToken(member("a"));
  expect(() => old.submit()).toThrow(ApiError);
  const fresh = await opened(); expect(fresh.snapshot()?.draft.text).toBe("");
  await fresh.saveText("Fresh session text");
  expect(fresh.snapshot()?.draft.text).toBe("Fresh session text");
});


test("a failed native erase stays blocked and can retry without another server DELETE", async () => {
  const owner = captureAccountScope(); const session = await opened(); await session.saveText("Private text awaiting erasure");
  jest.mocked(AsyncStorage.multiRemove).mockRejectedValueOnce(new Error("native I/O"));
  await expect(purgeChapterDrafts(owner)).rejects.toThrow("native I/O");
  expect(await AsyncStorage.getItem(chapterErasureKey(owner.owner!))).toBe("pending");
  await expect(session.saveText("Resurrected text")).rejects.toMatchObject({ code: "chapter_account_deleted" });
  expect(session.snapshot()).toBeNull(); expect(session.draftSnapshot()).toBeNull();
  await AsyncStorage.setItem("relo_dojo/chapters/v1/user%3Ab/introduction/1", "B's untouched draft");
  setAuthToken(member("b"));
  await purgeChapterDrafts(owner); // Captured A cleanup remains safe after sign-out or B login.
  expect(await AsyncStorage.getItem(chapterDraftKey(owner, "introduction"))).toBeNull();
  expect(await AsyncStorage.getItem(chapterErasureKey(owner.owner!))).toBeNull();
  expect(await AsyncStorage.getItem("relo_dojo/chapters/v1/user%3Ab/introduction/1")).toBe("B's untouched draft");
});

test("a failed key enumeration is retried before the owner's next draft read", async () => {
  const owner = captureAccountScope(); const session = await opened(); await session.saveText("Text that must not reopen");
  jest.mocked(AsyncStorage.getAllKeys).mockRejectedValueOnce(new Error("enumeration failed"));
  await expect(purgeChapterDrafts(owner)).rejects.toThrow("enumeration failed");
  expect(await AsyncStorage.getItem(chapterErasureKey(owner.owner!))).toBe("pending");
  const resumed = await opened();
  expect(resumed.snapshot()?.draft.text).toBe("");
  expect(await AsyncStorage.getItem(chapterErasureKey(owner.owner!))).toBeNull();
});

test("a durable erasure marker is handled before any cached answer or server run is opened", async () => {
  setAuthToken(member("marker-owner")); const owner = captureAccountScope();
  await AsyncStorage.setItem(chapterDraftKey(owner, "introduction"), JSON.stringify({ clientId: "550e8400-e29b-41d4-a716-446655440000", runId: "run-a", text: "Old deleted text", pending: null }));
  await AsyncStorage.setItem(chapterErasureKey(owner.owner!), "pending");
  jest.mocked(request).mockClear();
  const session = createChapterSession(owner, "introduction", "en");
  await expect(session.open()).rejects.toMatchObject({ code: "chapter_account_deleted" });
  expect(request).not.toHaveBeenCalled();
  expect(session.draftSnapshot()).toBeNull();
  expect(await AsyncStorage.getItem(chapterDraftKey(owner, "introduction"))).toBeNull();
});
