import { fetch as expoFetch } from "expo/fetch";
import {
  addNetworkStateListener,
  getNetworkStateAsync,
  NetworkStateType,
  type NetworkState,
  type NetworkStateEvent,
} from "expo-network";
import { checkInteractive, getExercise, setAuthToken, type ResponseValue } from "../api";

const token = "signed-exercise";
const answer: ResponseValue = ["past", "simple"];
const grade = { correct: true, correct_answer: "past simple" };
const nextCard = { token: "next-exercise", text: "Choose the article.", topic: "articles" };
const nativeFetch = jest.mocked(expoFetch);
const networkState = jest.mocked(getNetworkStateAsync);
let notifyNetworkChange: (state: NetworkStateEvent) => void;

function response(json: () => Promise<unknown> = async () => grade): Awaited<ReturnType<typeof expoFetch>> {
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
  await expect(checkInteractive(token, answer)).rejects.toMatchObject({ code: "learning_offline", status: 0 });
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
  const rejected = expect(pending).rejects.toMatchObject({ code: "learning_offline", status: 0 });
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
  const rejected = expect(pending).rejects.toMatchObject({ code: "learning_timeout", status: 0 });
  const signal = await bodyStarted;
  await jest.advanceTimersByTimeAsync(7_999);
  expect(signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await rejected;
  expect(signal.aborted).toBe(true);
  expect(nativeFetch).toHaveBeenCalledTimes(1);
});

it("loads the next exercise through Expo after connectivity returns and the answer checks", async () => {
  const params = { topic: "articles", level: "A2", practice_index: 4 };
  networkState.mockResolvedValueOnce({ type: NetworkStateType.NONE, isConnected: false });
  await expect(getExercise(params)).rejects.toMatchObject({ code: "learning_offline", status: 0 });
  expect(nativeFetch).not.toHaveBeenCalled();

  nativeFetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(response(async () => nextCard));
  await expect(checkInteractive(token, answer)).resolves.toEqual(grade);
  await expect(getExercise(params)).resolves.toEqual(nextCard);
  expect(nativeFetch).toHaveBeenCalledTimes(2);
  const [checkRequest, exerciseRequest] = nativeFetch.mock.calls;
  expect(checkRequest[0]).toMatch(/\/check$/);
  expect(exerciseRequest[0]).toMatch(/\/exercise$/);
  expect(JSON.parse(String(exerciseRequest[1]?.body))).toMatchObject(params);
  expect(exerciseRequest[1]?.headers).toEqual(checkRequest[1]?.headers);
});

it("rejects an already cancelled exercise before querying the network", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(getExercise(undefined, controller.signal)).rejects.toMatchObject({ code: "request_aborted", status: 409 });
  expect(networkState).not.toHaveBeenCalled();
  expect(nativeFetch).not.toHaveBeenCalled();
});

it("cancels an exercise during preflight and never dispatches it when preflight resolves", async () => {
  const controller = new AbortController();
  const preflightStarted = new Promise<(state: NetworkState) => void>((started) => {
    networkState.mockImplementationOnce(() => new Promise((resolve) => { started(resolve); }));
  });
  const pending = getExercise(undefined, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ code: "request_aborted", status: 409 });
  const finishPreflight = await preflightStarted;
  controller.abort();
  await rejected;
  finishPreflight({ type: NetworkStateType.WIFI });
  await Promise.resolve();
  await Promise.resolve();
  expect(nativeFetch).not.toHaveBeenCalled();
});

it("gives an online exercise up to 65 seconds even when the native body does not settle", async () => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "clearImmediate", "queueMicrotask"] });
  const bodyStarted = new Promise<AbortSignal>((resolve) => {
    nativeFetch.mockImplementationOnce(async (_url, options) => response(() => {
      resolve(options!.signal!);
      return new Promise(() => {});
    }));
  });
  const pending = getExercise();
  const rejected = expect(pending).rejects.toMatchObject({ code: "learning_timeout", status: 0 });
  const signal = await bodyStarted;
  await jest.advanceTimersByTimeAsync(64_999);
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
