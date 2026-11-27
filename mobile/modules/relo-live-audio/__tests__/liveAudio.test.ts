import { requireOptionalNativeModule } from "expo-modules-core";
import { PermissionsAndroid, Platform } from "react-native";
import { liveAudioAvailable, requestLiveMicPermission, startLiveAudio } from "../../../services/liveAudio";

jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: "android.permission.RECORD_AUDIO" },
    RESULTS: { GRANTED: "granted" },
    check: jest.fn(),
    request: jest.fn(),
  },
}));

const getNativeModule = jest.mocked(requireOptionalNativeModule);
type Event = { sessionId: number; base64Pcm?: string; message?: string };

function mockNativeAudio() {
  const listeners = new Map<string, (event: Event) => void>();
  const method = () => jest.fn().mockResolvedValue(undefined);
  const native = {
    start: method(),
    play: method(),
    clearPlayback: method(),
    finishPlayback: method(),
    stop: method(),
    addListener: jest.fn((name: string, listener: (event: Event) => void) => {
      listeners.set(name, listener);
      return { remove: () => listeners.delete(name) };
    }),
  };
  getNativeModule.mockReturnValue(native);
  return { native, listeners };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.resetAllMocks();
  Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
});

it("requests Android microphone permission only when the native bridge is present", async () => {
  getNativeModule.mockReturnValue(null);
  await expect(requestLiveMicPermission()).resolves.toBe(false);
  expect(PermissionsAndroid.request).not.toHaveBeenCalled();

  mockNativeAudio();
  expect(liveAudioAvailable()).toBe(true);
  jest.mocked(PermissionsAndroid.check).mockResolvedValue(false);
  jest.mocked(PermissionsAndroid.request).mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  await expect(requestLiveMicPermission()).resolves.toBe(true);
  expect(PermissionsAndroid.request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
});

it("filters microphone events by session and drops all listeners on call end", async () => {
  const { native, listeners } = mockNativeAudio();
  const onChunk = jest.fn();
  const audio = await startLiveAudio(onChunk);
  const id = native.start.mock.calls[0][0] as number;
  listeners.get("microphoneChunk")?.({ sessionId: id + 1, base64Pcm: "unused" });
  listeners.get("microphoneChunk")?.({ sessionId: id, base64Pcm: "AAE=" });
  expect(onChunk.mock.calls).toEqual([["AAE="]]);

  await Promise.all([audio.stop(), audio.stop()]);
  expect(native.stop).toHaveBeenCalledTimes(1);
  expect(native.stop).toHaveBeenCalledWith(id);
  expect(listeners.size).toBe(0);
});

it("removes native subscriptions when startup fails or capture ends", async () => {
  const { native, listeners } = mockNativeAudio();
  native.start.mockRejectedValueOnce(new Error("Microphone is unavailable"));
  await expect(startLiveAudio(jest.fn())).rejects.toThrow("Microphone is unavailable");
  expect(listeners.size).toBe(0);

  const onError = jest.fn();
  await startLiveAudio(jest.fn(), onError);
  const id = native.start.mock.calls[1][0] as number;
  listeners.get("audioError")?.({ sessionId: id, message: "Microphone capture failed" });
  expect(onError).toHaveBeenCalledWith(new Error("Microphone capture failed"));
  expect(listeners.size).toBe(0);
});

it("skips native work for an already-aborted startup", async () => {
  const { native } = mockNativeAudio();
  const controller = new AbortController();
  controller.abort();

  await expect(startLiveAudio(jest.fn(), jest.fn(), controller.signal))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(native.addListener).not.toHaveBeenCalled();
  expect(native.start).not.toHaveBeenCalled();
  expect(native.stop).not.toHaveBeenCalled();
});

it("aborts promptly even when both native startup and cleanup never resolve", async () => {
  const { native, listeners } = mockNativeAudio();
  native.start.mockReturnValue(deferred().promise);
  native.stop.mockReturnValue(deferred().promise);
  const onChunk = jest.fn();
  const onError = jest.fn();
  const controller = new AbortController();
  const opening = startLiveAudio(onChunk, onError, controller.signal);
  const id = native.start.mock.calls[0][0] as number;
  const lateListener = listeners.get("microphoneChunk");

  controller.abort();
  expect(listeners.size).toBe(0);
  expect(native.stop).toHaveBeenCalledWith(id);
  lateListener?.({ sessionId: id, base64Pcm: "AAE=" });
  expect(onChunk).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  await expect(opening).rejects.toMatchObject({ name: "AbortError" });
});

it("cleans up a late aborted start by its original id without affecting a new session", async () => {
  const { native, listeners } = mockNativeAudio();
  const original = deferred();
  native.start.mockReturnValueOnce(original.promise);
  native.stop.mockRejectedValueOnce(new Error("Native cleanup was not ready"));
  const controller = new AbortController();
  const opening = startLiveAudio(jest.fn(), undefined, controller.signal);
  const originalId = native.start.mock.calls[0][0];
  controller.abort();
  await expect(opening).rejects.toMatchObject({ name: "AbortError" });

  const onNewChunk = jest.fn();
  const current = await startLiveAudio(onNewChunk);
  const currentId = native.start.mock.calls[1][0] as number;
  original.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(native.stop.mock.calls).toEqual([[originalId], [originalId]]);
  listeners.get("microphoneChunk")?.({ sessionId: currentId, base64Pcm: "AAI=" });
  expect(onNewChunk).toHaveBeenCalledWith("AAI=");
  await current.stop();
  expect(native.stop).toHaveBeenLastCalledWith(currentId);
});

it("uses the same idempotent stop for cancellation after startup", async () => {
  const { native, listeners } = mockNativeAudio();
  const controller = new AbortController();
  const current = await startLiveAudio(jest.fn(), undefined, controller.signal);
  controller.abort();
  await current.stop();

  expect(native.stop).toHaveBeenCalledTimes(1);
  expect(listeners.size).toBe(0);
});

it("writes PCM in order and lets clear proceed while hardware drain is pending", async () => {
  const { native } = mockNativeAudio();
  const firstChunk = deferred();
  const drain = deferred();
  native.play.mockImplementationOnce(() => firstChunk.promise);
  native.finishPlayback.mockImplementation(() => drain.promise);
  const audio = await startLiveAudio(jest.fn());
  const id = native.start.mock.calls[0][0];

  const first = audio.play("AAAA");
  const second = audio.play("BBBB");
  const finished = audio.finishPlayback();
  await Promise.resolve();
  expect(native.play.mock.calls).toEqual([[id, "AAAA"]]);
  expect(native.finishPlayback).not.toHaveBeenCalled();

  firstChunk.resolve();
  await Promise.all([first, second]);
  expect(native.play.mock.calls).toEqual([[id, "AAAA"], [id, "BBBB"]]);
  expect(native.finishPlayback).toHaveBeenCalledWith(id);
  await audio.clearPlayback();
  expect(native.clearPlayback).toHaveBeenCalledWith(id);

  drain.resolve();
  await finished;
  await audio.stop();
});

it("drops pending writes from an interrupted answer and plays the subsequent answer", async () => {
  const { native } = mockNativeAudio();
  const firstChunk = deferred();
  native.play.mockImplementationOnce(() => firstChunk.promise);
  const audio = await startLiveAudio(jest.fn());
  const id = native.start.mock.calls[0][0];

  const first = audio.play("AAAA");
  await Promise.resolve();
  const interrupted = audio.play("BBBB");
  const clear = audio.clearPlayback();
  const next = audio.play("CCCC");
  firstChunk.resolve();
  await Promise.all([first, interrupted, clear, next]);

  expect(native.play.mock.calls).toEqual([[id, "AAAA"], [id, "CCCC"]]);
  expect(native.clearPlayback.mock.invocationCallOrder[0]).toBeLessThan(native.play.mock.invocationCallOrder[1]);
  await audio.stop();
});
