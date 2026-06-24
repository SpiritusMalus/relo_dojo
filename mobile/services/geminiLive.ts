// Gemini Live (mode b) — realtime two-way voice with the sensei. A SEPARATE path from the backend's
// text generateContent (services/llm.py): a direct client↔Google WebSocket carrying raw PCM audio.
//
// The credential is a SHORT-LIVED ephemeral token minted by OUR backend (POST /voice/live-token via
// api.getVoiceLiveToken) — the real GEMINI_API_KEY never ships in the app bundle. The model is
// resolved server-side (per the llm.py "resolve from the live list, don't hardcode" rule) and passed
// in. Dormant unless EXPO_PUBLIC_VOICE_ENABLED && voice consent — enforced at the call site.
import { GEMINI_LIVE_WSS } from "./voice";

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

/** Open a Gemini Live session with a backend-minted ephemeral `token` and a server-resolved `model`.
 *  Opens the WebSocket, sends the setup frame, and wires inbound text to the handlers. Returns
 *  controls for streaming mic audio and closing. The caller obtains {token, model} from
 *  api.getVoiceLiveToken() — this module never reads an embedded key. */
export async function openLiveSession(
  handlers: LiveHandlers,
  token: string,
  model: string
): Promise<LiveSession> {
  if (!token) throw new Error("Live voice token missing");
  const ws = new WebSocket(`${GEMINI_LIVE_WSS}?access_token=${encodeURIComponent(token)}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ setup: { model: model.startsWith("models/") ? model : `models/${model}` } }));
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
