import { captureAccountScope } from "../../store/accountScope";
import { deleteAccount, getExercise, setAuthToken, syncLearnerProfile } from "../api";

const token = (id: string) => `header.${btoa(JSON.stringify({ sub: id }))}.signature`;
const response = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;

beforeEach(() => { setAuthToken(token("A")); });
afterEach(() => { setAuthToken(null); jest.restoreAllMocks(); });

it("rejects A's response after a switch, including a delayed JSON body", async () => {
  let resolveBody!: (value: unknown) => void;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200,
    json: () => new Promise((resolve) => { resolveBody = resolve; }),
  })) as unknown as typeof fetch;
  const pending = getExercise();
  const outcome = expect(pending).rejects.toMatchObject({ code: "session_changed" });
  await Promise.resolve();
  setAuthToken(token("B"));
  resolveBody({ text: "A private card" });
  await outcome;
});

it("does not PUT A's delayed profile or patch with B's bearer token", async () => {
  let resolveGet!: (value: Response) => void;
  global.fetch = jest.fn(() => new Promise((resolve) => { resolveGet = resolve; })) as unknown as typeof fetch;
  const pending = syncLearnerProfile({ goal: "A private goal" });
  setAuthToken(token("B"));
  resolveGet(response({ goal: "A old goal" }));
  await pending;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(jest.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Bearer ${token("A")}` });
});

it("keeps both profile requests pinned to the same account", async () => {
  global.fetch = jest.fn(async () => response({ goal: "old", tone: "soft" })) as unknown as typeof fetch;
  await syncLearnerProfile({ goal: "new" });
  expect(fetch).toHaveBeenCalledTimes(2);
  const [, init] = jest.mocked(fetch).mock.calls[1];
  expect(init?.method).toBe("PUT");
  expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token("A")}` });
  expect(JSON.parse(String(init?.body))).toEqual({ goal: "new", tone: "soft" });
});

it("a held A deletion scope cannot delete the newly signed-in B", async () => {
  const scope = captureAccountScope();
  global.fetch = jest.fn();
  setAuthToken(token("B"));
  await expect(deleteAccount(scope)).rejects.toMatchObject({ code: "session_changed" });
  expect(fetch).not.toHaveBeenCalled();
});
