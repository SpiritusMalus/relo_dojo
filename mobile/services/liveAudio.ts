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

export async function startLiveAudio(
  onChunk: (base64Pcm: string) => void,
  onError?: (error: Error) => void,
): Promise<LiveAudioSession> {
  const native = getNativeAudio();
  if (!native) throw new Error("Live audio is unavailable on this device");

  const id = ++nextSessionId;
  let active = true;
  let playbackGeneration = 0;
  let pendingWrites = Promise.resolve();
  let stopPromise: Promise<void> | undefined;

  const microphone = native.addListener("microphoneChunk", (event) => {
    if (active && event.sessionId === id) onChunk(event.base64Pcm);
  });
  const audioError = native.addListener("audioError", (event) => {
    if (!active || event.sessionId !== id) return;
    detach();
    onError?.(new Error(event.message));
  });

  function detach() {
    active = false;
    microphone.remove();
    audioError.remove();
  }

  function scheduleWrite(write: () => Promise<void>) {
    const scheduled = pendingWrites.then(write);
    pendingWrites = scheduled.catch(() => undefined);
    return scheduled;
  }

  try {
    await native.start(id);
  } catch (error) {
    if (active) detach();
    throw error;
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
    stop() {
      if (stopPromise) return stopPromise;
      if (active) detach();
      stopPromise = native.stop(id);
      return stopPromise;
    },
  };
}
