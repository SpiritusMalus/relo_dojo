import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { AppState, type AppStateStatus } from "react-native";
import { getNetworkStateAsync, NetworkStateType } from "expo-network";
import { openConversationSocket } from "../../services/conversation";
import { requestLiveMicPermission, startLiveAudio, type LiveAudioSession } from "../../services/liveAudio";
import { useLiveConversation } from "../useLiveConversation";

jest.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: jest.fn() }),
  getNetworkStateAsync: jest.fn(),
  NetworkStateType: { NONE: "NONE", WIFI: "WIFI" },
}));

jest.mock("../../services/conversation", () => ({
  conversationEnabled: () => true,
  openConversationSocket: jest.fn(),
  readConversationEvent: (data: string) => JSON.parse(data),
}));

jest.mock("../../services/liveAudio", () => ({
  requestLiveMicPermission: jest.fn(),
  startLiveAudio: jest.fn(),
}));

jest.mock("../../services/api", () => ({ isCurrentAuthToken: () => true }));

const requestPermission = jest.mocked(requestLiveMicPermission);
const openSocket = jest.mocked(openConversationSocket);
const network = jest.mocked(getNetworkStateAsync);
const startAudio = jest.mocked(startLiveAudio);
const initialAppState = AppState.currentState;

beforeEach(() => {
  network.mockResolvedValue({ type: NetworkStateType.WIFI });
  requestPermission.mockResolvedValue(true);
});
afterEach(() => {
  jest.restoreAllMocks();
  AppState.currentState = initialAppState;
  requestPermission.mockReset();
  openSocket.mockReset();
  network.mockReset();
  startAudio.mockReset();
  jest.useRealTimers();
});

test("first microphone permission can pause the Android activity before the session starts", async () => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    const callback = listener as (state: AppStateStatus) => void;
    listeners.add(callback);
    return { remove: () => { listeners.delete(callback); } };
  });
  const enter = (state: AppStateStatus) => {
    AppState.currentState = state;
    for (const listener of [...listeners]) listener(state);
  };

  let grant!: (value: boolean) => void;
  requestPermission.mockReturnValue(new Promise<boolean>((resolve) => { grant = resolve; }));
  const close = jest.fn();
  openSocket.mockReturnValue({ close } as unknown as WebSocket);
  AppState.currentState = "active";
  let hook!: ReturnType<typeof useLiveConversation>;
  let renderer!: ReactTestRenderer;
  function Harness() { hook = useLiveConversation("fixture"); return null; }
  act(() => { renderer = TestRenderer.create(<Harness />); });

  let started!: Promise<void>;
  await act(async () => {
    started = hook.start();
    await Promise.resolve();
  });
  expect(requestPermission).toHaveBeenCalledTimes(1);
  await act(async () => {
    enter("background");
    grant(true);
    await Promise.resolve();
  });
  expect(hook.phase).toBe("connecting");
  expect(openSocket).not.toHaveBeenCalled();

  await act(async () => {
    enter("active");
    await started;
  });
  expect(openSocket).toHaveBeenCalledWith("fixture");
  expect(hook.phase).toBe("connecting");

  act(() => { enter("background"); });
  expect(hook.phase).toBe("ended");
  expect(close).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});


function mount() {
  let hook!: ReturnType<typeof useLiveConversation>;
  let renderer!: ReactTestRenderer;
  function Harness() { hook = useLiveConversation("fixture"); return null; }
  AppState.currentState = "active";
  act(() => { renderer = TestRenderer.create(<Harness />); });
  return { get: () => hook, close: () => act(() => renderer.unmount()) };
}

function mockSocket() {
  const socket = { close: jest.fn(), send: jest.fn(), onmessage: undefined } as unknown as WebSocket;
  openSocket.mockReturnValueOnce(socket);
  return {
    socket,
    receive: (event: object) => socket.onmessage?.({ data: JSON.stringify(event) } as MessageEvent),
  };
}

function mockAudio() {
  const method = () => jest.fn().mockResolvedValue(undefined);
  return { stop: method(), play: method(), clearPlayback: method(), finishPlayback: method() };
}

it("shows an offline start immediately without requesting microphone or opening a socket", async () => {
  network.mockResolvedValueOnce({ type: NetworkStateType.NONE });
  const view = mount();
  await act(async () => { await view.get().start(); });
  expect(view.get().phase).toBe("error");
  expect(view.get().error).toBe("offline");
  expect(requestPermission).not.toHaveBeenCalled();
  expect(openSocket).not.toHaveBeenCalled();
  view.close();
});

it("times out native startup, retries on the same screen and disposes a late old recorder", async () => {
  jest.useFakeTimers();
  const first = mockSocket();
  const second = mockSocket();
  const stale = mockAudio();
  const fresh = mockAudio();
  let resolveOld!: (audio: LiveAudioSession) => void;
  startAudio
    .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce(fresh);
  const view = mount();

  await act(async () => { await view.get().start(); });
  act(() => first.receive({ type: "ready" }));
  expect(view.get().phase).toBe("preparing");
  const oldSignal = startAudio.mock.calls[0][2];
  await act(async () => { await jest.advanceTimersByTimeAsync(8000); });
  expect(view.get().error).toBe("startup_timeout");
  expect(oldSignal?.aborted).toBe(true);
  expect(first.socket.close).toHaveBeenCalledTimes(1);

  await act(async () => { await view.get().start(); });
  await act(async () => second.receive({ type: "ready" }));
  expect(view.get().phase).toBe("listening");
  await act(async () => resolveOld(stale));
  expect(stale.stop).toHaveBeenCalledTimes(1);
  expect(fresh.stop).not.toHaveBeenCalled();
  expect(second.socket.close).not.toHaveBeenCalled();
  view.close();
});

it("does not let a hung previous microphone stop block a subsequent start", async () => {
  jest.useFakeTimers();
  const first = mockSocket();
  const next = mockSocket();
  const stuck = mockAudio();
  stuck.stop.mockReturnValue(new Promise<void>(() => undefined));
  startAudio.mockResolvedValueOnce(stuck).mockResolvedValueOnce(mockAudio());
  const view = mount();
  await act(async () => { await view.get().start(); });
  await act(async () => first.receive({ type: "ready" }));
  act(() => view.get().stop());

  await act(async () => {
    void view.get().start();
    await jest.advanceTimersByTimeAsync(750);
  });
  expect(openSocket).toHaveBeenCalledTimes(2);
  await act(async () => next.receive({ type: "ready" }));
  expect(view.get().phase).toBe("listening");
  view.close();
});

it("allows cancellation while waiting for a platform permission promise", async () => {
  let resolvePermission!: (answer: boolean) => void;
  requestPermission.mockReturnValueOnce(new Promise((resolve) => { resolvePermission = resolve; }));
  const view = mount();
  let started!: Promise<void>;
  await act(async () => { started = view.get().start(); });
  expect(view.get().phase).toBe("permission");
  await act(async () => {
    view.get().stop();
    await started;
    resolvePermission(true);
  });
  expect(view.get().phase).toBe("ended");
  expect(openSocket).not.toHaveBeenCalled();
  view.close();
});

it("shows the server retry time and blocks early connection attempts", async () => {
  jest.useFakeTimers();
  const first = mockSocket();
  mockSocket();
  const view = mount();
  await act(async () => { await view.get().start(); });
  act(() => first.receive({ type: "error", code: "connection_rate_limit", retryAfterSeconds: 3 }));
  expect(view.get().retrySeconds).toBe(3);
  await act(async () => { await view.get().start(); });
  expect(openSocket).toHaveBeenCalledTimes(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
  expect(view.get().retrySeconds).toBe(0);
  await act(async () => { await view.get().start(); });
  expect(openSocket).toHaveBeenCalledTimes(2);
  view.close();
});
