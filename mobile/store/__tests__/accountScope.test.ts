import { getMe, postEvents, setAuthToken } from "../../services/api";
import { bindAccountUser, captureAccountScope, isCurrentAccountScope, subscribeAccountScope } from "../accountScope";

const token = (sub: string, nonce = "one") => `header.${Buffer.from(JSON.stringify({ sub, nonce })).toString("base64url")}.signature`;
beforeEach(() => { setAuthToken(null); });
afterEach(() => { setAuthToken(null); jest.restoreAllMocks(); });

it("publishes a stable user namespace synchronously, but invalidates old work on a refreshed token", () => {
  const listener = jest.fn();
  const unsubscribe = subscribeAccountScope(listener);
  setAuthToken(token("ученик-a"));
  const a = captureAccountScope();
  expect(a.owner).toBe("user:ученик-a");
  setAuthToken(token("ученик-a", "two"));
  expect(captureAccountScope().owner).toBe(a.owner);
  expect(isCurrentAccountScope(a)).toBe(false);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it("binds an opaque token to a returned user id only while that exact session remains current", () => {
  setAuthToken("opaque-a");
  const a = captureAccountScope();
  setAuthToken("opaque-b");
  bindAccountUser("a", a);
  expect(captureAccountScope().owner).toBeNull();
  bindAccountUser(42, captureAccountScope());
  expect(captureAccountScope().owner).toBe("user:42");
});

it("a late /auth/me response cannot rebind B's storage namespace to A", async () => {
  let resolve!: (value: Response) => void;
  const fetchMock = jest.spyOn(global, "fetch").mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  setAuthToken(token("a"));
  const pending = getMe();
  setAuthToken(token("b"));
  resolve({ ok: true, json: async () => ({ id: "a", email: "a@example.com", is_verified: true }) } as Response);
  await expect(pending).rejects.toMatchObject({ code: "session_changed" });
  expect(captureAccountScope().owner).toBe("user:b");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("resolves an opaque signed-in session from its current /auth/me user id", async () => {
  jest.spyOn(global, "fetch").mockResolvedValueOnce({ ok: true, json: async () => ({ id: "42", email: "owner@example.com", is_verified: true }) } as Response);
  setAuthToken("opaque-current-token");
  expect(captureAccountScope().owner).toBeNull();
  await getMe();
  expect(captureAccountScope().owner).toBe("user:42");
});

it("refuses to send a queued A analytics batch under B's bearer", async () => {
  const fetchMock = jest.spyOn(global, "fetch");
  setAuthToken(token("a"));
  const a = captureAccountScope();
  setAuthToken(token("b"));
  await expect(postEvents(null, [{ name: "lesson", props: {}, ts: 1 }], a)).rejects.toMatchObject({ status: 409, code: "session_changed" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([null, token("a")])("pins in-flight analytics headers, including anonymous null, across an account switch: %s", async (bearer) => {
  let resolve!: (value: Response) => void;
  const fetchMock = jest.spyOn(global, "fetch").mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  setAuthToken(bearer);
  const scope = captureAccountScope();
  const pending = postEvents("anonymous-id", [{ name: "lesson", props: {}, ts: 1 }], scope);
  const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
  expect(headers.Authorization).toBe(bearer ? `Bearer ${bearer}` : undefined);
  setAuthToken(token("b"));
  resolve({ ok: true, json: async () => ({ accepted: 1 }) } as Response);
  await expect(pending).rejects.toMatchObject({ code: "session_changed" });
});
