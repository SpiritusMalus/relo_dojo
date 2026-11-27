import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { AppState, type AppStateStatus } from "react-native";
import { openConversationSocket } from "../../services/conversation";
import { requestLiveMicPermission } from "../../services/liveAudio";
import { useLiveConversation } from "../useLiveConversation";

jest.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove: jest.fn() }),
  NetworkStateType: { NONE: "NONE" },
}));

jest.mock("../../services/conversation", () => ({
  conversationEnabled: () => true,
  openConversationSocket: jest.fn(),
}));

jest.mock("../../services/liveAudio", () => ({
  requestLiveMicPermission: jest.fn(),
}));

jest.mock("../../services/api", () => ({ isCurrentAuthToken: () => true }));

const requestPermission = jest.mocked(requestLiveMicPermission);
const openSocket = jest.mocked(openConversationSocket);
const initialAppState = AppState.currentState;

afterEach(() => {
  jest.restoreAllMocks();
  AppState.currentState = initialAppState;
  requestPermission.mockReset();
  openSocket.mockReset();
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
