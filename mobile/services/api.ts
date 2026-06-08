// API client for the Grammar Dojo backend.
//
// The backend runs on the same machine (Mac) that serves the Expo bundle, on port 8000.
// To avoid hardcoding the Mac's LAN IP (it changes between networks), we derive it from the
// Expo dev host (the address Metro is served from) and just swap the port.
//
// Fallback IP is used if the host can't be detected (e.g. tunnel mode or a production build) —
// update it, or set EXPO_PUBLIC_API_URL, when needed.
import Constants from "expo-constants";
import type { Progress } from "../store/progress";

const FALLBACK_HOST = "192.168.1.9";
const PORT = 8000;

function resolveBaseUrl(): string {
  // Explicit override always wins (handy for tunnel / staging / prod).
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override;

  // e.g. "192.168.1.9:8081" — the LAN IP Metro is served from.
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(":")[0];
  // Only use it if it looks like an IP/host, not a tunnel URL.
  if (host && /^[\d.]+$/.test(host)) {
    return `http://${host}:${PORT}`;
  }
  return `http://${FALLBACK_HOST}:${PORT}`;
}

export const BASE_URL = resolveBaseUrl();

// Bearer token for authenticated calls. Held in a module var and set by the auth store.
let authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  authToken = token;
}

type Method = "GET" | "POST" | "PUT";

// LLM calls (/explain) can be slow on a cold model, but never hang forever — fail clearly instead.
const REQUEST_TIMEOUT_MS = 90000;
// A mini-story generates 3 exercises in sequence (each may retry), so it needs more headroom.
const STORY_TIMEOUT_MS = 180000;

async function request<T>(
  path: string,
  body?: unknown,
  method: Method = "POST",
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("The server took too long to respond. Is the backend running?");
    }
    throw new Error("Can't reach the backend. Check it's running and on the same network.");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Errors carry {detail: "..."} (string) or, for 422 validation, {detail: [{msg, ...}]}.
    let detail = `Backend error ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: unknown };
      const d = data?.detail;
      if (typeof d === "string") {
        detail = d;
      } else if (Array.isArray(d)) {
        detail = d.map((e) => (e && typeof e === "object" && "msg" in e ? (e as any).msg : String(e))).join("; ");
      }
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export type MatchItem = { id: number; text: string };

export type ExerciseType =
  | "multiple-choice"
  | "build-the-sentence"
  | "match-pairs"
  | "tap-the-error"
  | "odd-one-out"
  | "multiple-blanks"
  | "order-the-dialog"
  | "free-text";

export type Exercise = {
  type: ExerciseType;
  topic: string;
  level: string; // effective CEFR served (A1..C1); drives difficulty-aware scoring
  text: string;
  prompt: string; // source line for translation exercises (e.g. the Russian sentence)
  options: string[];
  tiles: string[];
  tokens: string[];
  left: MatchItem[];
  right: MatchItem[];
  blankOptions: string[][]; // multiple-blanks: choices per blank, left-to-right
  token: string | null; // sealed answer for interactive types; null for free-text
};

// The user's answer, shape depends on the exercise type:
//  - multiple-choice / build-the-sentence / odd-one-out / free-text: string
//  - tap-the-error: number (tapped index)
//  - match-pairs: { [leftId]: rightId }
//  - multiple-blanks: string[] (pick per blank); order-the-dialog: string[] (lines in chosen order)
export type ResponseValue = string | number | Record<string, number> | string[];

export type CheckResult = {
  correct: boolean;
  correct_answer: string;
  score?: number; // fraction right (0..1); partial credit for multi-element types
  detail?: string; // e.g. "2/3" for multi-element answers; "" otherwise
};
export type ExplainResult = { explanation: string; tip: string };
export type TextCheckResult = CheckResult & ExplainResult;

export async function postChat(message: string): Promise<string> {
  const data = await request<{ reply: string }>("/chat", { message });
  return data.reply;
}

// Optional adaptive steering: topic / CEFR level / exercise type (all optional; backend falls back).
export function getExercise(params?: {
  topic?: string;
  level?: string;
  type?: string;
  context?: string;
}): Promise<Exercise> {
  return request<Exercise>("/exercise", params ?? {});
}

// A themed mini-story: a curated narrative wrapping a sequence of linked exercises.
export type StoryBeat = { narration: string; exercise: Exercise };
export type StorySet = {
  id: string;
  title: string;
  intro: string;
  level: string; // effective CEFR served across the set
  beats: StoryBeat[];
};

// Generate a mini-story. `level` locks CEFR across the set; `context` overrides scenario flavor.
// Three exercises are generated server-side in sequence, so this needs a longer timeout.
export function getStory(params?: { level?: string; context?: string }): Promise<StorySet> {
  return request<StorySet>("/story", params ?? {}, "POST", STORY_TIMEOUT_MS);
}

// Onboarding: map a free-text "what's hard for me" to canonical grammar topics.
export function analyzePain(text: string): Promise<{ topics: string[] }> {
  return request<{ topics: string[] }>("/profile/analyze", { text });
}

// Deterministic, instant grade for interactive exercises (no LLM).
export function checkInteractive(token: string, response: ResponseValue): Promise<CheckResult> {
  return request<CheckResult>("/check", { token, response });
}

// LLM grade for free-text answers (includes an explanation).
export function checkFreeText(text: string, userAnswer: string): Promise<TextCheckResult> {
  return request<TextCheckResult>("/check-answer", { text, user_answer: userAnswer });
}

// On-demand teaching note for an interactive miss.
export function explain(
  text: string,
  correctAnswer: string,
  userResponse: string
): Promise<ExplainResult> {
  return request<ExplainResult>("/explain", {
    text,
    correct_answer: correctAnswer,
    user_response: userResponse,
  });
}

// --- accounts & progress sync (Phase 4) ---
export type AuthUser = { id: string; email: string };
type TokenResp = { access_token: string; token_type: string };

export function register(email: string, password: string): Promise<TokenResp> {
  return request<TokenResp>("/auth/register", { email, password });
}

export function login(email: string, password: string): Promise<TokenResp> {
  return request<TokenResp>("/auth/login", { email, password });
}

export function getMe(): Promise<AuthUser> {
  return request<AuthUser>("/auth/me", undefined, "GET");
}

export function getProgress(): Promise<Progress> {
  return request<Progress>("/progress", undefined, "GET");
}

export function putProgress(p: Progress): Promise<Progress> {
  return request<Progress>("/progress", p, "PUT");
}
