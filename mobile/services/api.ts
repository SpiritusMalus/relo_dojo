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
    // Backend returns {detail: "..."} for errors (e.g. 503 when Ollama is down).
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

export type Exercise = {
  type: string;
  text: string;
  options: string[];
  topic: string;
};

export type CheckResult = {
  correct: boolean;
  correct_answer: string;
  explanation: string;
  tip: string;
};

export async function postChat(message: string): Promise<string> {
  const data = await request<{ reply: string }>("/chat", { message });
  return data.reply;
}

export function getExercise(): Promise<Exercise> {
  return request<Exercise>("/exercise", {});
}

export function checkAnswer(exercise: Exercise, userAnswer: string): Promise<CheckResult> {
  return request<CheckResult>("/check-answer", {
    type: exercise.type,
    text: exercise.text,
    options: exercise.options,
    user_answer: userAnswer,
  });
}
