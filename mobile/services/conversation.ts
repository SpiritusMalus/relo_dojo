import { BASE_URL } from "./api";
import { liveAudioAvailable } from "./liveAudio";

export type Correction = { original: string; replacement: string; explanation: string };
export type ConversationFeedback = { transcript: string; corrected: string; corrections: Correction[] };
export type ConversationEvent =
  | { type: "ready" | "speech_start" | "thinking" | "done" | "interrupted" }
  | ({ type: "feedback" } & ConversationFeedback)
  | { type: "reply"; text: string }
  | { type: "audio"; data: string }
  | { type: "error"; code: string; retryAfterSeconds?: number };

export function conversationEnabled(): boolean {
  return process.env.EXPO_PUBLIC_LIVE_CONVERSATION_ENABLED === "true" && liveAudioAvailable();
}

export function openConversationSocket(token: string): WebSocket {
  const base = BASE_URL.replace(/\/$/, "");
  const url = base.replace(/^http(?=s?:)/, "ws") + "/voice/conversation";
  // React Native supports additional handshake headers via its constructor options.
  // Keep the account token out of URL/ingress logs.
  const NativeSocket = WebSocket as unknown as new (
    url: string,
    protocols: string[],
    options: { headers: Record<string, string> },
  ) => WebSocket;
  return new NativeSocket(url, [], { headers: { Authorization: `Bearer ${token}` } });
}

export function readConversationEvent(data: unknown): ConversationEvent | null {
  if (typeof data !== "string") return null;
  try {
    const event = JSON.parse(data) as ConversationEvent;
    switch (event.type) {
      case "ready":
      case "speech_start":
      case "thinking":
      case "done":
      case "interrupted":
        return event;
      case "reply":
        return typeof event.text === "string" ? event : null;
      case "audio":
        return typeof event.data === "string" ? event : null;
      case "error":
        if (typeof event.code !== "string") return null;
        return typeof event.retryAfterSeconds === "number" && Number.isFinite(event.retryAfterSeconds)
          ? event : { type: "error", code: event.code };
      case "feedback":
        return typeof event.transcript === "string"
          && typeof event.corrected === "string"
          && Array.isArray(event.corrections)
          && event.corrections.every((c) => c && typeof c.original === "string"
            && typeof c.replacement === "string" && typeof c.explanation === "string")
          ? event : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
