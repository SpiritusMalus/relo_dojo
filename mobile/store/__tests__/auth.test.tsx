import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import * as SecureStore from "expo-secure-store";
import { AppState, type AppStateStatus } from "react-native";
import { ApiError, getMe, login as apiLogin, register as apiRegister } from "../../services/api";
import { syncConsentToServer } from "../consent";
import { AuthProvider, useAuth } from "../auth";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));
jest.mock("../../services/api", () => ({
  ...jest.requireActual("../../services/api"), getMe: jest.fn(), login: jest.fn(), register: jest.fn(),
}));
jest.mock("../consent", () => ({ syncConsentToServer: jest.fn() }));

let auth!: ReturnType<typeof useAuth>;
function Harness() { auth = useAuth(); return null; }
let renderer: ReactTestRenderer | undefined;
async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(<AuthProvider><Harness /></AuthProvider>);
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("saved-session");
  (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
});
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });

it.each([new Error("offline"), new ApiError("temporarily unavailable", 503)])(
  "keeps a saved login on a temporary validation failure: %s", async (error) => {
    (getMe as jest.Mock).mockRejectedValue(error);
    await mount();
    expect(auth.ready).toBe(true);
    expect(auth.token).toBe("saved-session");
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  }
);

it("clears credentials only when the server explicitly rejects the token", async () => {
  (getMe as jest.Mock).mockRejectedValue(new ApiError("expired", 401));
  await mount();
  expect(auth.ready).toBe(true);
  expect(auth.token).toBeNull();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("relo_dojo_token");
});

it("renders without waiting for a slow server and never restores a logged-out session", async () => {
  let resolve!: (value: unknown) => void;
  (getMe as jest.Mock).mockReturnValue(new Promise((done) => { resolve = done; }));
  await mount();
  expect(auth.ready).toBe(true);
  expect(auth.token).toBe("saved-session");
  await act(async () => { await auth.logout(); });
  await act(async () => { resolve({ id: "previous-user", email: "qa@example.com" }); });
  expect(auth.token).toBeNull();
  expect(auth.user).toBeNull();
});

it("does not erase an unreadable SecureStore value", async () => {
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error("storage unavailable"));
  await mount();
  expect(auth.ready).toBe(true);
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});

it.each(["login", "register"] as const)("a late %s identity cannot overwrite a later signed-in account", async (action) => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  const meA = { id: "account-a", email: "qa-a@example.com", is_verified: false };
  const meB = { id: "account-b", email: "qa-b@example.com", is_verified: true };
  let resolveA!: (value: unknown) => void;
  (getMe as jest.Mock)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
    .mockResolvedValueOnce(meB);
  (apiLogin as jest.Mock).mockResolvedValue({ access_token: "token-b" });
  ((action === "login" ? apiLogin : apiRegister) as jest.Mock).mockResolvedValueOnce({ access_token: "token-a" });
  await mount();
  let attemptA!: Promise<void>;
  await act(async () => { attemptA = auth[action]("qa-a@example.com", "synthetic-password"); });
  expect(auth.token).toBe("token-a");
  await act(async () => { await auth.logout(); });
  await act(async () => { await auth.login("qa-b@example.com", "synthetic-password"); });
  expect(auth.token).toBe("token-b");
  expect(auth.user).toEqual(meB);
  await act(async () => { resolveA(meA); await attemptA; });
  expect(auth.token).toBe("token-b");
  expect(auth.user).toEqual(meB);
  expect(syncConsentToServer).toHaveBeenCalledTimes(1); // the invalidated A attempt does not replay it
});

it.each(["login", "register"] as const)("a delayed %s token response cannot restore an explicitly logged-out session", async (action) => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  let resolveToken!: (value: unknown) => void;
  ((action === "login" ? apiLogin : apiRegister) as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }));
  await mount();
  let pending!: Promise<void>;
  act(() => { pending = auth[action]("qa-a@example.com", "synthetic-password"); });
  await act(async () => { await auth.logout(); });
  await act(async () => { resolveToken({ access_token: "old-token-a" }); await pending; });
  expect(auth.token).toBeNull();
  expect(auth.user).toBeNull();
  expect(getMe).not.toHaveBeenCalled();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

it("a native A write must settle before the logout/B replacement, so restart cannot restore A", async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  let saved: string | null = null;
  let releaseA!: () => void;
  let startedA!: () => void;
  const started = new Promise<void>((done) => { startedA = done; });
  const blocked = new Promise<void>((done) => { releaseA = done; });
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (_key: string, value: string) => {
    if (value === "token-a") { startedA(); await blocked; }
    saved = value;
  });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async () => { saved = null; });
  (apiLogin as jest.Mock).mockResolvedValueOnce({ access_token: "token-a" }).mockResolvedValueOnce({ access_token: "token-b" });
  (getMe as jest.Mock).mockResolvedValue({ id: "b", email: "b@example.com", is_verified: true });
  await mount();
  let loginA!: Promise<void>;
  let logout!: Promise<void>;
  let loginB!: Promise<void>;
  await act(async () => { loginA = auth.login("a@example.com", "synthetic-password"); await started; });
  await act(async () => { logout = auth.logout(); loginB = auth.login("b@example.com", "synthetic-password"); });
  expect(auth.token).toBe("token-b");
  // B's native replacement is queued, rather than racing past the unresolved A write.
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  await act(async () => { releaseA(); await Promise.all([loginA, logout, loginB]); });
  expect(saved).toBe("token-b");
  expect(auth.token).toBe("token-b");
  expect(auth.user?.id).toBe("b");
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async () => saved);
  act(() => renderer!.unmount());
  await mount();
  expect(auth.token).toBe("token-b");
});

describe("foreground recovery of a restored identity", () => {
  let state: AppStateStatus;
  const listeners = new Set<(state: AppStateStatus) => void>();
  const descriptor = Object.getOwnPropertyDescriptor(AppState, "currentState");
  const meA = { id: "a", email: "a@example.com", is_verified: true };
  const meB = { id: "b", email: "b@example.com", is_verified: false };
  const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
  const advance = async (ms: number) => { act(() => { jest.advanceTimersByTime(ms); }); await flush(); };
  const emit = async (next: AppStateStatus) => {
    state = next;
    act(() => { for (const listener of [...listeners]) listener(next); });
    await flush();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    state = "active";
    listeners.clear();
    (getMe as jest.Mock).mockReset();
    Object.defineProperty(AppState, "currentState", { configurable: true, get: () => state });
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => { listeners.delete(listener); } };
    });
  });
  afterEach(() => {
    if (renderer) act(() => renderer!.unmount());
    renderer = undefined;
    jest.restoreAllMocks();
    if (descriptor) Object.defineProperty(AppState, "currentState", descriptor);
    jest.useRealTimers();
  });

  it("recovers after startup offline without a login or AppState transition, then stops retrying", async () => {
    (getMe as jest.Mock).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(meA);
    await mount();
    expect(auth.ready).toBe(true);
    expect(auth.token).toBe("saved-session");
    expect(auth.user).toBeNull();
    await advance(14999);
    expect(getMe).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(auth.user).toEqual(meA);
    await advance(300000);
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(apiLogin).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("backs off 15→30→60 seconds and caps subsequent retries at 60", async () => {
    (getMe as jest.Mock).mockRejectedValue(new Error("offline"));
    await mount();
    await advance(15000);
    expect(getMe).toHaveBeenCalledTimes(2);
    await advance(29999);
    expect(getMe).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(getMe).toHaveBeenCalledTimes(3);
    await advance(59999);
    expect(getMe).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(getMe).toHaveBeenCalledTimes(4);
    await advance(60000);
    expect(getMe).toHaveBeenCalledTimes(5);
    expect(auth.token).toBe("saved-session");
  });

  it("pauses in the background and resumes with one immediate foreground attempt", async () => {
    (getMe as jest.Mock).mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("still offline")).mockResolvedValueOnce(meA);
    await mount();
    await emit("background");
    await advance(120000);
    expect(getMe).toHaveBeenCalledTimes(1);
    await emit("active");
    expect(getMe).toHaveBeenCalledTimes(2);
    await advance(15000);
    expect(getMe).toHaveBeenCalledTimes(3);
    expect(auth.user).toEqual(meA);
  });

  it("dedupes a slow startup request with manual refresh, foreground and the retry timer", async () => {
    let resolve!: (value: unknown) => void;
    (getMe as jest.Mock).mockReturnValue(new Promise((done) => { resolve = done; }));
    await mount();
    let manual!: Promise<void>;
    act(() => { manual = auth.refreshUser(); });
    await emit("active");
    await advance(15000);
    expect(getMe).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(meA); await manual; });
    expect(auth.user).toEqual(meA);
    await advance(120000);
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it("keeps recovering the retained identity after a failed replacement login advances the session epoch", async () => {
    (getMe as jest.Mock).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(meA);
    (apiLogin as jest.Mock).mockRejectedValueOnce(new ApiError("invalid replacement credentials", 401));
    await mount();
    await act(async () => { await expect(auth.login("other@example.com", "wrong-password")).rejects.toMatchObject({ status: 401 }); });
    expect(auth.token).toBe("saved-session");
    await advance(15000);
    expect(auth.user).toEqual(meA);
    expect(getMe).toHaveBeenCalledTimes(2);
  });

  it.each(["success", "401"] as const)("a delayed A retry %s cannot restore A metadata or log out B", async (outcome) => {
    let resolveA!: (value: unknown) => void;
    let rejectA!: (reason: Error) => void;
    (getMe as jest.Mock).mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => new Promise((done, reject) => { resolveA = done; rejectA = reject; }))
      .mockResolvedValueOnce(meB);
    (apiLogin as jest.Mock).mockResolvedValueOnce({ access_token: "token-b" });
    await mount();
    await advance(15000);
    expect(getMe).toHaveBeenCalledTimes(2);
    await act(async () => { await auth.logout(); await auth.login("b@example.com", "synthetic-password"); });
    expect(auth.user).toEqual(meB);
    await act(async () => { if (outcome === "success") resolveA(meA); else rejectA(new ApiError("expired A", 401)); });
    await flush();
    await advance(120000);
    expect(auth.token).toBe("token-b");
    expect(auth.user).toEqual(meB);
    expect(getMe).toHaveBeenCalledTimes(3);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1); // explicit logout only
  });

  it("an explicit retry 401 clears the token and stops the recovery loop", async () => {
    (getMe as jest.Mock).mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new ApiError("expired", 401));
    await mount();
    await advance(15000);
    expect(auth.token).toBeNull();
    expect(auth.user).toBeNull();
    await advance(120000);
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it("unmount stops scheduled recovery", async () => {
    (getMe as jest.Mock).mockRejectedValue(new Error("offline"));
    await mount();
    act(() => renderer!.unmount());
    renderer = undefined;
    await advance(120000);
    expect(getMe).toHaveBeenCalledTimes(1);
  });
});
