import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import * as SecureStore from "expo-secure-store";
import { ApiError, getMe, login as apiLogin, register as apiRegister } from "../../services/api";
import { syncConsentToServer } from "../consent";
import { AuthProvider, useAuth } from "../auth";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));
jest.mock("../../services/api", () => ({
  ...jest.requireActual("../../services/api"), getMe: jest.fn(), setAuthToken: jest.fn(), login: jest.fn(), register: jest.fn(),
}));
jest.mock("../consent", () => ({ syncConsentToServer: jest.fn() }));

let auth!: ReturnType<typeof useAuth>;
function Harness() { auth = useAuth(); return null; }
let renderer: ReactTestRenderer;
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
afterEach(() => { if (renderer) act(() => renderer.unmount()); });

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
