import { fetch as expoFetch } from "expo/fetch";
import {
  addNetworkStateListener,
  getNetworkStateAsync,
  NetworkStateType,
  type NetworkStateEvent,
} from "expo-network";
import { checkInteractive, setAuthToken, type ResponseValue } from "../api";

const token = "signed-exercise";
const answer: ResponseValue = ["past", "simple"];
const grade = { correct: true, correct_answer: "past simple" };
const nativeFetch = jest.mocked(expoFetch);
const networkState = jest.mocked(getNetworkStateAsync);
let notifyNetworkChange: (state: NetworkStateEvent) => void;

function response(json = async () => grade): Awaited<ReturnType<typeof expoFetch>> {
  return { ok: true, status: 200, json } as Awaited<ReturnType<typeof expoFetch>>;
}

beforeAll(() => {
  jest.mocked(addNetworkStateListener).mockImplementation((listener) => {
    notifyNetworkChange = listener;
    return { remove: jest.fn() };
  });
});

beforeEach(() => {
  setAuthToken(null);
  nativeFetch.mockReset();
  networkState.mockReset();
  networkState.mockResolvedValue({ type: NetworkStateType.WIFI });
});

afterEach(() => {
  jest.useRealTimers();
});

it("reports an offline check without sending it and uses fresh network state on retry", async () => {
  networkState.mockResolvedValueOnce({ type: NetworkStateType.NONE, isConnected: false });
  await expect(checkInteractive(token, answer)).rejects.toMatchObject({ code: "answer_offline" });
  expect(nativeFetch).not.toHaveBeenCalled();

  nativeFetch.mockResolvedValueOnce(response());
  await expect(checkInteractive(token, answer)).resolves.toEqual(grade);
  expect(networkState).toHaveBeenCalledTimes(2);
  expect(nativeFetch).toHaveBeenCalledTimes(1);
  expect(nativeFetch).toHaveBeenCalledWith(expect.stringMatching(/\/check$/), expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ token, response: answer }),
    headers: expect.objectContaining({ "X-Relo-Review-Guest": expect.any(String) }),
  }));
});

it("aborts an active check when connectivity is lost and retries the same token and answer", async () => {
  const started = new Promise<AbortSignal>((resolve) => {
    nativeFetch.mockImplementationOnce((_url, options) => new Promise((_, reject) => {
      const signal = options!.signal!;
      signal.addEventListener("abort", () => reject(new Error("Native request was cancelled")), { once: true });
      resolve(signal);
    }));
  });
  const pending = checkInteractive(token, answer);
  const rejected = expect(pending).rejects.toMatchObject({ code: "answer_offline" });
  const signal = await started;
  expect(signal.aborted).toBe(false);
  notifyNetworkChange({ type: NetworkStateType.NONE, isConnected: false });
  await rejected;
  expect(signal.aborted).toBe(true);

  nativeFetch.mockResolvedValueOnce(response());
  await expect(checkInteractive(token, answer)).resolves.toEqual(grade);
  const [first, second] = nativeFetch.mock.calls;
  expect(second?.[0]).toBe(first?.[0]);
  expect(second?.[1]?.body).toBe(first?.[1]?.body);
  expect(second?.[1]?.headers).toEqual(first?.[1]?.headers);
  expect(second?.[1]?.signal?.aborted).toBe(false);
});

it("times out after eight seconds and cancels the transport even when the body never settles", async () => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "clearImmediate", "queueMicrotask"] });
  const bodyStarted = new Promise<AbortSignal>((resolve) => {
    nativeFetch.mockImplementationOnce(async (_url, options) => response(() => {
      resolve(options!.signal!);
      return new Promise(() => {});
    }));
  });
  const pending = checkInteractive(token, answer);
  const rejected = expect(pending).rejects.toMatchObject({ code: "answer_timeout" });
  const signal = await bodyStarted;
  await jest.advanceTimersByTimeAsync(7_999);
  expect(signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await rejected;
  expect(signal.aborted).toBe(true);
  expect(nativeFetch).toHaveBeenCalledTimes(1);
});

it.each([
  { type: NetworkStateType.UNKNOWN, isConnected: false, isInternetReachable: false },
  { type: NetworkStateType.WIFI, isConnected: true, isInternetReachable: false },
])("attempts transport when link type is $type and internet validation is unavailable", async (state) => {
  networkState.mockResolvedValueOnce(state);
  nativeFetch.mockResolvedValueOnce(response());
  await expect(checkInteractive(token, answer)).resolves.toEqual(grade);
  expect(nativeFetch).toHaveBeenCalledTimes(1);
});
