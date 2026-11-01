import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import * as SecureStore from "expo-secure-store";
import { ApiError, getMe } from "../../services/api";
import { AuthProvider, useAuth } from "../auth";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(),
}));
jest.mock("../../services/api", () => ({
  ...jest.requireActual("../../services/api"), getMe: jest.fn(), setAuthToken: jest.fn(),
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
