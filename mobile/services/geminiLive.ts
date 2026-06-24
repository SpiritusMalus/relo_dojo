// Gemini Live (mode b) — realtime two-way voice with the sensei. This is a SEPARATE path from the
// backend's text generateContent (services/llm.py): a direct client↔Google WebSocket carrying raw
// PCM audio. Per the llm.py rule we RESOLVE the live model id from the model list rather than
// hardcoding a guess (see pickLiveModel in services/voice).
//
// Dormant unless EXPO_PUBLIC_VOICE_ENABLED=true AND voice consent is granted — enforced at the call
// site. The realtime key is an ephemeral/public Live key the owner provisions at flag-flip; it is NOT
// the backend's secret GEMINI_API_KEY.
import { GEMINI_LIVE_WSS, pickLiveModel } from "./voice";

const GEMINI_REST = "https://generativelanguage.googleapis.com/v1beta";

/** Realtime Live key (owner-provisioned, ephemeral). Empty until flag-flip → Live stays unavailable. */
export const LIVE_KEY = process.env.EXPO_PUBLIC_GEMINI_LIVE_KEY ?? "";

/** List available model ids from the Gemini API (used to resolve the live model — never hardcode). */
export async function listModels(key: string = LIVE_KEY): Promise<string[]> {
  const res = await fetch(`${GEMINI_REST}/models?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`Gemini model list failed: ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  return (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
}

/** Resolve the native-audio flash-live model id from the live list, or throw if none qualifies. */
export async function resolveLiveModel(key: string = LIVE_KEY): Promise<string> {
  const model = pickLiveModel(await listModels(key));
  if (!model) throw new Error("No Gemini live (flash native-audio) model available");
  return model;
}

export type LiveSession = {
  /** Send a chunk of raw PCM16 16 kHz audio (base64) to the model. */
  sendAudio: (base64Pcm: string) => void;
  /** Close the socket. */
  close: () => void;
};

export type LiveHandlers = {
  onText?: (text: string) => void; // transcript / correction text from the model
  onError?: (e: unknown) => void;
  onClose?: () => void;
};

/** Open a Gemini Live session. Resolves the model, opens the WebSocket, sends the setup frame, and
 *  wires inbound text to the handlers. Returns controls for streaming mic audio and closing. */
export async function openLiveSession(handlers: LiveHandlers, key: string = LIVE_KEY): Promise<LiveSession> {
  if (!key) throw new Error("Live voice key not configured");
  const model = await resolveLiveModel(key);
  const ws = new WebSocket(`${GEMINI_LIVE_WSS}?key=${encodeURIComponent(key)}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ setup: { model: `models/${model}` } }));
  };
  ws.onmessage = (ev: { data: unknown }) => {
    try {
      const msg = JSON.parse(String(ev.data)) as {
        serverContent?: { modelTurn?: { parts?: Array<{ text?: string }> } };
      };
      const parts = msg.serverContent?.modelTurn?.parts ?? [];
      for (const p of parts) if (p.text) handlers.onText?.(p.text);
    } catch (e) {
      handlers.onError?.(e);
    }
  };
  ws.onerror = (e: unknown) => handlers.onError?.(e);
  ws.onclose = () => handlers.onClose?.();

  return {
    sendAudio: (base64Pcm: string) => {
      ws.send(
        JSON.stringify({
          realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64Pcm }] },
        })
      );
    },
    close: () => ws.close(),
  };
}
