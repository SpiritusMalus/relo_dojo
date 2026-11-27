import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";
import { PermissionsAndroid, Platform } from "react-native";

interface LiveAudioNativeModule {
  start(sessionId: number): Promise<void>;
  play(sessionId: number, base64Pcm: string): Promise<void>;
  clearPlayback(sessionId: number): Promise<void>;
  finishPlayback(sessionId: number): Promise<void>;
  stop(sessionId: number): Promise<void>;
  addListener(
    event: "microphoneChunk",
    listener: (payload: { sessionId: number; base64Pcm: string }) => void,
  ): EventSubscription;
  addListener(
    event: "audioError",
    listener: (payload: { sessionId: number; message: string }) => void,
  ): EventSubscription;
}

export interface LiveAudioSession {
  play(base64Pcm: string): Promise<void>;
  clearPlayback(): Promise<void>;
  finishPlayback(): Promise<void>;
  stop(): Promise<void>;
}

let nextSessionId = 0;

function getNativeAudio(): LiveAudioNativeModule | null {
  return Platform.OS === "android"
    ? requireOptionalNativeModule<LiveAudioNativeModule>("ReloLiveAudio")
    : null;
}

export function liveAudioAvailable(): boolean {
  return getNativeAudio() !== null;
}

export async function requestLiveMicPermission(): Promise<boolean> {
  if (!liveAudioAvailable()) return false;
  const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(permission)) return true;
  const result = await PermissionsAndroid.request(permission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function abortError(): Error {
  return Object.assign(new Error("Live audio was cancelled"), { name: "AbortError" });
}

export async function startLiveAudio(
  onChunk: (base64Pcm: string) => void,
  onError?: (error: Error) => void,
  signal?: AbortSignal,
): Promise<LiveAudioSession> {
  if (signal?.aborted) throw abortError();
  const native = getNativeAudio();
  if (!native) throw new Error("Live audio is unavailable on this device");

  const id = ++nextSessionId;
  let active = true;
  let startFailure: Error | undefined;
  let playbackGeneration = 0;
  let pendingWrites = Promise.resolve();
  let stopPromise: Promise<void> | undefined;
  let microphone: EventSubscription | undefined;
  let audioError: EventSubscription | undefined;
  let rejectStartup: ((error: Error) => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    rejectStartup = reject;
  });

  function detach() {
    if (!active) return;
    active = false;
    signal?.removeEventListener("abort", onAbort);
    microphone?.remove();
    audioError?.remove();
  }

  const stopNativeSession = async () => { await native.stop(id); };

  function stop() {
    detach();
    return stopPromise ??= stopNativeSession();
  }

  function onAbort() {
    startFailure = abortError();
    rejectStartup?.(startFailure);
    void stop().catch(() => undefined);
  }

  function scheduleWrite(write: () => Promise<void>) {
    const scheduled = pendingWrites.then(write);
    pendingWrites = scheduled.catch(() => undefined);
    return scheduled;
  }

  try {
    microphone = native.addListener("microphoneChunk", (event) => {
      if (active && event.sessionId === id) onChunk(event.base64Pcm);
    });
    audioError = native.addListener("audioError", (event) => {
      if (!active || event.sessionId !== id) return;
      startFailure = new Error(event.message);
      rejectStartup?.(startFailure);
      detach();
      onError?.(startFailure);
    });
    signal?.addEventListener("abort", onAbort, { once: true });

    const opening = (async () => {
      if (signal?.aborted) throw abortError();
      await native.start(id);
      // A late result can outlive both the caller and its first cleanup attempt.
      if (!active) void stopNativeSession().catch(() => undefined);
    })();
    await Promise.race([opening, interrupted]);
    if (startFailure) throw startFailure;
  } catch (error) {
    detach();
    throw error;
  } finally {
    rejectStartup = undefined;
  }

  return {
    play(base64Pcm) {
      const generation = playbackGeneration;
      return scheduleWrite(async () => {
        if (active && generation === playbackGeneration) await native.play(id, base64Pcm);
      });
    },
    clearPlayback() {
      ++playbackGeneration;
      return scheduleWrite(async () => {
        if (active) await native.clearPlayback(id);
      });
    },
    async finishPlayback() {
      const generation = playbackGeneration;
      await pendingWrites;
      if (active && generation === playbackGeneration) await native.finishPlayback(id);
    },
    stop,
  };
}
