import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError, request, type Exercise } from "./api";
import type { DojoSnapshot } from "./dojo";
import { isCurrentAccountScope, type AccountScope } from "../store/accountScope";

export const CHAPTER_IDS = ["introduction", "experience", "clarification"] as const;
export type ChapterId = typeof CHAPTER_IDS[number];
export const CHAPTER_TEXT_LIMIT = 1000;
export function isChapterId(value: unknown): value is ChapterId {
  return CHAPTER_IDS.includes(value as ChapterId);
}
export type ChapterSummary = {
  id: ChapterId; version: 1; keepsake_id: string; preparation_count: number;
  completed: boolean; run_id: string | null;
};
export type ChapterCatalog = { version: 1; chapters: ChapterSummary[] };
export type ChapterFeedback = {
  completed: boolean; requirements: { id: string; met: boolean }[];
  explanation: string; example: string; tip: string;
};
export type ChapterRun = {
  id: string; chapter_id: ChapterId; manifest_version: 1; preparation_count: number;
  graded_count: number; completed: boolean; exercise: Exercise | null;
  final_prompt: string; requirements: string[]; feedback: ChapterFeedback | null;
  feedback_submission_id: string | null; pending_submission_id: string | null; receipt_id: string | null;
};
export type ChapterFinalResult = { run: ChapterRun; feedback: ChapterFeedback; dojo: DojoSnapshot | null };
export function getChapters(_lang?: string): Promise<ChapterCatalog> {
  return request("/chapters", undefined, "GET", 12000);
}
export function startChapter(id: ChapterId, clientId: string, lang: string): Promise<ChapterRun> {
  return request(`/chapters/${id}/start`, { client_id: clientId, lang }, "POST", 12000);
}
export function getChapterRun(id: string): Promise<ChapterRun> {
  return request(`/chapters/runs/${encodeURIComponent(id)}`, undefined, "GET", 12000);
}
export function finishChapter(id: string, submissionId: string, text: string): Promise<ChapterFinalResult> {
  return request(`/chapters/runs/${encodeURIComponent(id)}/final`, { submission_id: submissionId, text }, "POST", 90000);
}

type PendingFinal = { id: string; text: string };
export type ChapterDraft = { clientId: string; runId: string | null; text: string; pending: PendingFinal | null };
export type ChapterSessionState = { run: ChapterRun; draft: ChapterDraft };
const queues = new Map<string, Promise<unknown>>();
const ownerGenerations = new Map<string, number>();
const purgingOwners = new Set<string>();
const purges = new Map<string, Promise<void>>();
const ownerGeneration = (scope: AccountScope) => ownerGenerations.get(scope.owner ?? "") ?? 0;
const ERASURE_PREFIX = "relo_dojo/chapters-erasure/v1/";
export const chapterErasureKey = (owner: string) => `${ERASURE_PREFIX}${encodeURIComponent(owner)}`;
const ownerPrefix = (owner: string) => `relo_dojo/chapters/v1/${encodeURIComponent(owner)}/`;

/** Successful account deletion also removes raw local drafts. Block old controllers immediately,
 * then wait behind already-started writes so a delayed native write cannot resurrect the text. */
export function purgeChapterDrafts(scope: AccountScope): Promise<void> {
  const owner = scope.owner;
  if (!owner || owner === "guest") return Promise.resolve();
  const existing = purges.get(owner);
  if (existing) return existing;
  if (!purgingOwners.has(owner)) ownerGenerations.set(owner, ownerGeneration(scope) + 1);
  purgingOwners.add(owner);
  const prefix = ownerPrefix(owner);
  let erased = false;
  const task = (async () => {
    await AsyncStorage.setItem(chapterErasureKey(owner), "pending");
    await Promise.allSettled([...queues].filter(([key]) => key.startsWith(prefix)).map(([, promise]) => promise));
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
    if (keys.length) await AsyncStorage.multiRemove(keys);
    await AsyncStorage.removeItem(chapterErasureKey(owner));
    erased = true;
  })();
  purges.set(owner, task);
  void task.finally(() => {
    if (erased) purgingOwners.delete(owner); // Failed erasure stays blocked and can be retried.
    if (purges.get(owner) === task) purges.delete(owner);
  }).catch(() => {});
  return task;
}
const uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
  const n = Math.floor(Math.random() * 16);
  return (letter === "x" ? n : (n & 3) | 8).toString(16);
});
const isUuid = (value: unknown): value is string => typeof value === "string" && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
export function chapterDraftKey(scope: AccountScope, chapterId: ChapterId): string {
  return `relo_dojo/chapters/v1/${encodeURIComponent(scope.owner!)}/${chapterId}/1`;
}
async function recoverOwnerErasure(scope: AccountScope): Promise<void> {
  assertOwner(scope);
  if (purgingOwners.has(scope.owner!) || await AsyncStorage.getItem(chapterErasureKey(scope.owner!)) !== null) {
    await purgeChapterDrafts(scope);
  }
  assertOwner(scope);
}
function emptyDraft(): ChapterDraft { return { clientId: uuid(), runId: null, text: "", pending: null }; }
function parseDraft(value: unknown): ChapterDraft | null {
  if (!value || typeof value !== "object") return null;
  const d = value as ChapterDraft;
  if (!isUuid(d.clientId) || !(d.runId === null || typeof d.runId === "string" && d.runId.length <= 100)
    || typeof d.text !== "string" || d.text.length > CHAPTER_TEXT_LIMIT) return null;
  if (d.pending !== null && (!d.pending || !isUuid(d.pending.id) || typeof d.pending.text !== "string"
    || d.pending.text !== d.text.trim() || d.pending.text.length > CHAPTER_TEXT_LIMIT)) return null;
  return { clientId: d.clientId, runId: d.runId, text: d.text, pending: d.pending };
}
function owned(scope: AccountScope): boolean {
  return !!scope.owner && scope.owner !== "guest" && isCurrentAccountScope(scope);
}
function assertOwner(scope: AccountScope): void {
  if (!owned(scope)) throw new ApiError("The signed-in account changed.", 409, "session_changed");
}
async function storageTask<T>(scope: AccountScope, chapterId: ChapterId, run: (key: string) => Promise<T>): Promise<T> {
  const generation = ownerGeneration(scope);
  const assertStorageOwner = () => {
    assertOwner(scope);
    if (purgingOwners.has(scope.owner!) || generation !== ownerGeneration(scope)) {
      throw new ApiError("The account's chapter drafts were removed.", 409, "chapter_account_deleted");
    }
  };
  assertStorageOwner();
  const key = chapterDraftKey(scope, chapterId);
  const task = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => {
    assertStorageOwner();
    return run(key);
  });
  queues.set(key, task);
  try { return await task; }
  finally { if (queues.get(key) === task) queues.delete(key); }
}
function assertRun(run: ChapterRun, chapterId: ChapterId): void {
  if (!run || run.chapter_id !== chapterId || run.manifest_version !== 1 || typeof run.id !== "string"
    || !Number.isInteger(run.graded_count) || !Number.isInteger(run.preparation_count)
    || run.graded_count < 0 || run.graded_count > run.preparation_count || run.preparation_count !== 3
    || run.completed && (!run.receipt_id || !run.feedback?.completed)) {
    throw new ApiError("The chapter could not load.", 502, "invalid_chapter");
  }
}
export class ChapterPendingError extends Error {
  constructor() { super("Check the saved result before sending another answer."); this.name = "ChapterPendingError"; }
}

/** Local drafts never confer completion. One immutable owner, run and submission identity survives
 * interrupted requests; GET recovers the server verdict before an explicit retry of the same POST. */
export function createChapterSession(scope: AccountScope, chapterId: ChapterId, lang: string) {
  let draft: ChapterDraft | null = null;
  let run: ChapterRun | null = null;
  let opening: Promise<ChapterSessionState> | null = null;
  let submitting: Promise<ChapterFinalResult> | null = null;
  let active = true;
  const generation = ownerGeneration(scope);
  const visible = () => active && owned(scope) && generation === ownerGeneration(scope) && !purgingOwners.has(scope.owner!);
  const assertActive = () => {
    assertOwner(scope);
    if (purgingOwners.has(scope.owner!) || generation !== ownerGeneration(scope)) {
      throw new ApiError("The account's chapter drafts were removed.", 409, "chapter_account_deleted");
    }
    if (!active) throw new ApiError("The chapter is closed.", 409, "chapter_closed");
  };
  async function persist(next: ChapterDraft): Promise<void> {
    assertActive();
    draft = next;
    await storageTask(scope, chapterId, async (key) => { await AsyncStorage.setItem(key, JSON.stringify(next)); });
    assertActive();
  }
  async function adopt(next: ChapterRun): Promise<ChapterSessionState> {
    assertActive();
    assertRun(next, chapterId);
    run = next;
    const current = draft ?? emptyDraft();
    const differentRun = current.runId !== null && current.runId !== next.id;
    const pendingResolved = next.completed || !!current.pending && next.feedback_submission_id === current.pending.id;
    const nextDraft: ChapterDraft = {
      ...current, runId: next.id,
      text: next.completed || differentRun ? "" : current.text,
      pending: pendingResolved || differentRun ? null : current.pending,
    };
    await persist(nextDraft);
    return { run: next, draft: nextDraft };
  }
  async function refresh(): Promise<ChapterSessionState> {
    assertActive();
    if (!run) throw new ApiError("Open the chapter first.", 409, "chapter_not_open");
    return adopt(await getChapterRun(run.id));
  }
  function recoveredResult(next: ChapterRun): ChapterFinalResult | null {
    if (next.completed && next.feedback) return { run: next, feedback: next.feedback, dojo: null };
    if (draft?.pending && next.feedback_submission_id === draft.pending.id && next.feedback) {
      return { run: next, feedback: next.feedback, dojo: null };
    }
    return null;
  }
  async function sendFinal(retry: boolean): Promise<ChapterFinalResult> {
    assertActive();
    if (!run || !draft || run.graded_count < run.preparation_count) throw new ApiError("Finish the preparation first.", 409, "chapter_not_ready");
    if (run.completed && run.feedback) return { run, feedback: run.feedback, dojo: null };
    if (retry && draft.pending) {
      const canonical = await getChapterRun(run.id);
      assertActive();
      const recovered = recoveredResult(canonical);
      await adopt(canonical);
      if (recovered) return recovered;
    }
    assertActive();
    if (!draft.pending) {
      if (run.pending_submission_id) throw new ChapterPendingError();
      const text = draft.text.trim();
      if (!text) throw new ApiError("Write your answer first.", 422, "chapter_empty_answer");
      await persist({ ...draft, pending: { id: uuid(), text } });
    }
    const pending = draft.pending!;
    try {
      const result = await finishChapter(run.id, pending.id, pending.text);
      assertActive();
      await adopt(result.run);
      // A confirmed response resolves this request even on a server version without the recovery field.
      if (draft?.pending) await persist({ ...draft, pending: null });
      return result;
    } catch (error) {
      assertActive();
      try {
        const canonical = await getChapterRun(run.id);
        assertActive();
        const recovered = recoveredResult(canonical);
        await adopt(canonical);
        if (recovered) return recovered;
      } catch (readError) {
        assertActive();
        // A failed canonical read leaves the exact request in recovery. Never turn it into a new id.
      }
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status) && error.code !== "chapter_submission_pending") {
        if (draft) await persist({ ...draft, pending: null });
        throw error;
      }
      throw new ChapterPendingError();
    }
  }
  return {
    open(): Promise<ChapterSessionState> {
      // A failed erasure can be retried with its captured owner, before any raw draft is read.
      assertOwner(scope);
      if (!active) throw new ApiError("The chapter is closed.", 409, "chapter_closed");
      if (opening) return opening;
      opening = (async () => {
        await recoverOwnerErasure(scope);
        assertActive();
        const stored = await storageTask(scope, chapterId, async (key) => {
          try { return parseDraft(JSON.parse(await AsyncStorage.getItem(key) ?? "null")); }
          catch { return null; }
        });
        assertActive();
        draft = stored ?? emptyDraft();
        const catalog = await getChapters(lang);
        assertActive();
        const summary = catalog.chapters.find((chapter) => chapter.id === chapterId && chapter.version === 1);
        if (!summary) throw new ApiError("The chapter could not load.", 404, "chapter_unavailable");
        if (summary.run_id) return adopt(await getChapterRun(summary.run_id));
        await persist(draft);
        try { return await adopt(await startChapter(chapterId, draft.clientId, lang)); }
        catch (error) {
          assertActive();
          // Start may have committed. A catalog read finds it without creating a replacement run.
          const canonical = await getChapters(lang).catch(() => null);
          assertActive();
          const started = canonical?.chapters.find((chapter) => chapter.id === chapterId)?.run_id;
          if (started) return adopt(await getChapterRun(started));
          throw error;
        }
      })();
      return opening.finally(() => { opening = null; });
    },
    refresh,
    async saveText(text: string): Promise<void> {
      assertActive();
      if (!draft || draft.pending || run?.completed) return;
      await persist({ ...draft, text: text.slice(0, CHAPTER_TEXT_LIMIT) });
    },
    submit(): Promise<ChapterFinalResult> {
      assertActive();
      if (submitting) return submitting;
      const task = sendFinal(!!draft?.pending);
      submitting = task;
      void task.finally(() => { if (submitting === task) submitting = null; }).catch(() => {});
      return task;
    },
    snapshot(): ChapterSessionState | null { return visible() && run && draft ? { run, draft } : null; },
    draftSnapshot(): ChapterDraft | null { return visible() ? draft : null; },
    dispose(): void { active = false; },
  };
}
