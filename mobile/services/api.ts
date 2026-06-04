// API client for the Grammar Dojo backend.
//
// The backend runs on the same machine (Mac) that serves the Expo bundle, on port 8000.
// To avoid hardcoding the Mac's LAN IP (it changes between networks), we derive it from the
// Expo dev host (the address Metro is served from) and just swap the port.
//
// Fallback IP is used if the host can't be detected (e.g. tunnel mode or a production build) —
// update it, or set EXPO_PUBLIC_API_URL, when needed.
import Constants from "expo-constants";

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

async function request<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Backend returns {detail: "..."} for errors (e.g. 503 when Ollama is down, 400 expired token).
    let detail = `Backend error ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data?.detail) detail = data.detail;
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
  | "free-text";

export type Exercise = {
  type: ExerciseType;
  topic: string;
  text: string;
  prompt: string; // source line for translation exercises (e.g. the Russian sentence)
  options: string[];
  tiles: string[];
  tokens: string[];
  left: MatchItem[];
  right: MatchItem[];
  token: string | null; // sealed answer for interactive types; null for free-text
};

// The user's answer, shape depends on the exercise type:
//  - multiple-choice / build-the-sentence / free-text: string
//  - tap-the-error: number (tapped index)
//  - match-pairs: { [leftId]: rightId }
export type ResponseValue = string | number | Record<string, number>;

export type CheckResult = { correct: boolean; correct_answer: string };
export type ExplainResult = { explanation: string; tip: string };
export type TextCheckResult = CheckResult & ExplainResult;

export async function postChat(message: string): Promise<string> {
  const data = await request<{ reply: string }>("/chat", { message });
  return data.reply;
}

export function getExercise(): Promise<Exercise> {
  return request<Exercise>("/exercise", {});
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
