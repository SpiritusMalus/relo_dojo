import { fetch as expoFetch } from "expo/fetch";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import type { sendLearningRequest } from "../learningTransport";

jest.mock("expo-modules-core", () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));

const url = "https://example.com/check";
const headers = { "Content-Type": "application/json", "X-Relo-Review-Guest": "guest" };
const body = JSON.stringify({ token: "signed-exercise", response: "always" });
const timeoutMs = 8_000;
const fetch = jest.mocked(expoFetch);
const findNativeModule = jest.mocked(requireOptionalNativeModule);

function loadTransport(os: typeof Platform.OS, nativeModule: { Request: jest.Mock } | null) {
  Object.defineProperty(Platform, "OS", { value: os });
  findNativeModule.mockReturnValue(nativeModule);
  let request!: typeof sendLearningRequest;
  jest.isolateModules(() => {
    ({ sendLearningRequest: request } = require("../learningTransport"));
  });
  return request;
}

beforeEach(() => {
  fetch.mockReset();
  findNativeModule.mockReset();
});

it.each([[200, true], [422, false]])("adapts the native Android JSON response at status %s", async (status, ok) => {
  const payload = { correct: true };
  const send = jest.fn().mockResolvedValue({ status, body: JSON.stringify(payload) });
  const cancel = jest.fn().mockResolvedValue(undefined);
  const Request = jest.fn(() => ({ send, cancel }));
  const request = loadTransport("android", { Request });
  const controller = new AbortController();

  const response = await request(url, headers, body, controller.signal, timeoutMs);

  expect(findNativeModule).toHaveBeenCalledWith("ReloLearningTransport");
  expect(Request).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(url, headers, body, timeoutMs);
  expect(response).toMatchObject({ status, ok });
  await expect(response.json()).resolves.toEqual(payload);
  expect(fetch).not.toHaveBeenCalled();
  controller.abort();
  expect(cancel).not.toHaveBeenCalled();
});

it("cancels the active native Android request when its signal aborts", async () => {
  let begin!: () => void;
  let rejectNative!: (error: Error) => void;
  const started = new Promise<void>((resolve) => { begin = resolve; });
  const send = jest.fn(() => new Promise((_, reject) => {
    rejectNative = reject;
    begin();
  }));
  const cancel = jest.fn(async () => { rejectNative(new Error("Cancelled")); });
  const request = loadTransport("android", { Request: jest.fn(() => ({ send, cancel })) });
  const controller = new AbortController();

  const pending = request(url, headers, body, controller.signal, timeoutMs);
  const rejected = expect(pending).rejects.toThrow();
  await started;
  controller.abort();
  await rejected;

  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it("propagates a native Android failure without sending a second POST", async () => {
  const send = jest.fn().mockRejectedValue(new Error("socket closed"));
  const request = loadTransport("android", { Request: jest.fn(() => ({ send })) });

  await expect(request(url, headers, body, new AbortController().signal, timeoutMs)).rejects.toThrow("socket closed");

  expect(send).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["android", "ios"] as const)("uses Expo fetch when %s has no supported native transport", async (os) => {
  const Request = jest.fn();
  const request = loadTransport(os, os === "android" ? null : { Request });
  const signal = new AbortController().signal;
  const response = { status: 200, ok: true, json: async () => ({ correct: true }) };
  fetch.mockResolvedValueOnce(response as Awaited<ReturnType<typeof expoFetch>>);

  await expect(request(url, headers, body, signal, timeoutMs)).resolves.toMatchObject(response);

  expect(Request).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: "POST", headers, body, signal }));
});
