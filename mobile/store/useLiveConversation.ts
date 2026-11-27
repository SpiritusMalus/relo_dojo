import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { addNetworkStateListener, getNetworkStateAsync, NetworkStateType } from "expo-network";
import { conversationEnabled, openConversationSocket, readConversationEvent, type ConversationFeedback } from "../services/conversation";
import { requestLiveMicPermission, startLiveAudio, type LiveAudioSession } from "../services/liveAudio";
import { isCurrentAuthToken } from "../services/api";

type Phase = "idle" | "permission" | "connecting" | "preparing" | "listening" | "capturing" | "thinking" | "speaking" | "interrupting" | "ended" | "error";
type Turn = ConversationFeedback & { id: number; reply?: string };
type Session = {
  token: string;
  socket?: WebSocket;
  audio?: LiveAudioSession;
  abort: AbortController;
  cancelForegroundWait?: () => void;
  phase: Phase;
  timer?: ReturnType<typeof setTimeout>;
  playback: Promise<void>;
  playbackEpoch: number;
};

const CONNECT_MS = 8000;
const PERMISSION_MS = 45000;
const RELEASE_GRACE_MS = 750;
const FOREGROUND_MS = 6000;
const TURN_MS = 35000;
const INTERRUPT_MS = 5000;

// Native promises aren't guaranteed to settle after dismissal or platform failure.
function untilAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      resolve(undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    void task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function brieflyWaitForRelease(pending: Promise<void>, signal: AbortSignal): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<void>((resolve) => { timeout = setTimeout(resolve, RELEASE_GRACE_MS); });
  try {
    await untilAbort(Promise.race([pending, grace]), signal);
  } finally {
    clearTimeout(timeout);
  }
}

function waitForForeground(session: Session): Promise<boolean> {
  if (AppState.currentState === "active") return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (available: boolean) => {
      clearTimeout(timer);
      subscription.remove();
      session.cancelForegroundWait = undefined;
      resolve(available);
    };
    const timer = setTimeout(() => finish(false), FOREGROUND_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") finish(true);
    });
    session.cancelForegroundWait = () => finish(false);
    if (AppState.currentState === "active") finish(true);
  });
}

export function useLiveConversation(token: string | null) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [retryUntil, setRetryUntil] = useState(0);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const active = useRef<Session | null>(null);
  const nextId = useRef(0);
  const release = useRef(Promise.resolve());
  const mounted = useRef(true);

  const detach = useCallback(() => {
    const session = active.current;
    if (!session) return;
    active.current = null;
    clearTimeout(session.timer);
    session.cancelForegroundWait?.();
    session.abort.abort();
    session.playbackEpoch += 1;
    try { session.socket?.close(); } catch { /* The underlying socket may already be gone. */ }
    if (session.audio) release.current = session.audio.stop().catch(() => undefined);
  }, []);

  const stop = useCallback(() => {
    detach();
    if (mounted.current) setPhase("ended");
  }, [detach]);

  const fail = useCallback((code: string, retryAfterSeconds = 0) => {
    detach();
    if (!mounted.current) return;
    setError(code);
    const seconds = Number.isFinite(retryAfterSeconds) ? Math.max(0, Math.min(3600, Math.ceil(retryAfterSeconds))) : 0;
    setRetryUntil(seconds ? Date.now() + seconds * 1000 : 0);
    setRetrySeconds(seconds);
    setPhase("error");
  }, [detach]);

  useEffect(() => {
    mounted.current = true;
    const appState = AppState.addEventListener("change", (value) => {
      // Android pauses the activity for its microphone permission dialog.
      // Before the socket exists there is no microphone or upstream session to stop.
      if (value === "background" && active.current?.socket) stop();
    });
    const network = conversationEnabled() ? addNetworkStateListener((state) => {
      if (state.type === NetworkStateType.NONE && active.current) fail("offline");
    }) : undefined;
    return () => {
      mounted.current = false;
      appState.remove();
      network?.remove();
      detach();
    };
  }, [detach, fail, stop]);

  useEffect(() => {
    if (active.current && active.current.token !== token) stop();
  }, [stop, token]);

  useEffect(() => {
    if (!retryUntil) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
      setRetrySeconds(seconds);
      if (!seconds) setRetryUntil(0);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [retryUntil]);

  const start = useCallback(async () => {
    if (!token || active.current || !mounted.current || retryUntil > Date.now()) return;
    const session: Session = {
      token, abort: new AbortController(), phase: "connecting", playback: Promise.resolve(), playbackEpoch: 0,
    };
    active.current = session;
    setError("");
    setPhase("connecting");
    const current = () => mounted.current && active.current === session && isCurrentAuthToken(token);
    const change = (next: Phase) => {
      session.phase = next;
      setPhase(next);
    };
    const deadline = (ms: number, code = "timeout") => {
      clearTimeout(session.timer);
      session.timer = setTimeout(() => { if (current()) fail(code); }, ms);
    };
    const resumeListening = (epoch: number) => {
      if (!current() || session.playbackEpoch !== epoch) return;
      clearTimeout(session.timer);
      change("listening");
    };

    try {
      const signal = session.abort.signal;
      deadline(CONNECT_MS, "startup_timeout");
      const network = await untilAbort(getNetworkStateAsync().catch(() => undefined), signal);
      if (!current()) return;
      if (network?.type === NetworkStateType.NONE) {
        fail("offline");
        return;
      }

      change("permission");
      deadline(PERMISSION_MS, "permission_timeout");
      const permission = await untilAbort(requestLiveMicPermission(), signal);
      if (!current()) return;
      if (!permission) {
        fail("microphone");
        return;
      }

      change("connecting");
      deadline(CONNECT_MS, "startup_timeout");
      const [foreground] = await Promise.all([
        waitForForeground(session),
        brieflyWaitForRelease(release.current, signal),
      ]);
      if (!current()) return;
      if (!foreground) {
        fail("startup_timeout");
        return;
      }

      const socket = openConversationSocket(token);
      session.socket = socket;
      socket.onopen = () => {
        if (!current()) return;
        try { socket.send(JSON.stringify({ type: "start", consent: "voice-conversation-v1" })); }
        catch { fail("connection"); }
      };
      socket.onmessage = (message) => {
        if (!current()) return;
        const event = readConversationEvent(message.data);
        if (!event) return;
        switch (event.type) {
          case "ready":
            if (session.phase !== "connecting") return;
            change("preparing");
            void startLiveAudio((data) => {
              if (current() && (session.phase === "listening" || session.phase === "capturing")
                && socket.readyState === WebSocket.OPEN) {
                if (socket.bufferedAmount > 96_000) {
                  fail("offline");
                  return;
                }
                try { socket.send(JSON.stringify({ type: "audio", data })); }
                catch { fail("connection"); }
              }
            }, () => { if (current()) fail("microphone"); }, session.abort.signal).then((audio) => {
              if (!current()) {
                void audio.stop().catch(() => undefined);
                return;
              }
              session.audio = audio;
              clearTimeout(session.timer);
              setTurns([]);
              change("listening");
            }).catch(() => { if (current()) fail("microphone"); });
            return;
          case "speech_start":
            change("capturing");
            return;
          case "thinking":
            change("thinking");
            deadline(TURN_MS);
            return;
          case "feedback":
            if (session.phase !== "interrupting") {
              const id = ++nextId.current;
              setTurns((previous) => [...previous, { ...event, id }]);
            }
            return;
          case "reply":
            if (session.phase !== "interrupting") {
              setTurns((previous) => previous.map((turn, index) =>
                index === previous.length - 1 ? { ...turn, reply: event.text } : turn));
            }
            return;
          case "audio": {
            if (session.phase === "interrupting" || !session.audio) return;
            if (session.phase !== "speaking") change("speaking");
            const epoch = session.playbackEpoch;
            const audio = session.audio;
            session.playback = session.playback.then(async () => {
              if (current() && epoch === session.playbackEpoch) await audio.play(event.data);
            }).catch(() => { if (current()) fail("playback"); });
            return;
          }
          case "done": {
            if (session.phase === "interrupting") return;
            const epoch = session.playbackEpoch;
            void session.playback.then(() => {
              if (current() && epoch === session.playbackEpoch) return session.audio?.finishPlayback();
              return undefined;
            }).then(() => resumeListening(epoch)).catch(() => { if (current()) fail("playback"); });
            return;
          }
          case "interrupted":
            if (session.phase === "interrupting") {
              const epoch = session.playbackEpoch;
              void session.playback.then(() => resumeListening(epoch));
            }
            return;
          case "error":
            fail(event.code, event.retryAfterSeconds);
            return;
        }
      };
      socket.onerror = () => { if (current()) fail("connection"); };
      socket.onclose = (event) => {
        if (!current()) return;
        if (event.code === 1000) stop();
        else {
          const code = event.code === 4401 ? "auth_required"
            : event.code === 4403 ? "consent_required"
            : event.code === 4429 ? "voice_busy" : "connection";
          fail(code);
        }
      };
    } catch {
      if (current()) fail("connection");
    }
  }, [fail, retryUntil, stop, token]);

  const interrupt = useCallback(() => {
    const session = active.current;
    if (!session?.socket || !["speaking", "thinking"].includes(session.phase)) return;
    session.phase = "interrupting";
    setPhase("interrupting");
    session.playbackEpoch += 1;
    const pendingPlayback = session.playback;
    session.playback = Promise.all([pendingPlayback, session.audio?.clearPlayback()]).then(() => undefined)
      .catch(() => { if (active.current === session) fail("playback"); });
    clearTimeout(session.timer);
    session.timer = setTimeout(() => { if (active.current === session) fail("timeout"); }, INTERRUPT_MS);
    try {
      session.socket.send(JSON.stringify({ type: "interrupt" }));
    } catch {
      fail("connection");
    }
  }, [fail]);

  return { phase, error, turns, retrySeconds, start, stop, interrupt };
}
