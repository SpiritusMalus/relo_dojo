import { requireOptionalNativeModule } from "expo-modules-core";
import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";

type LearningResponse = Pick<Response, "status" | "ok" | "json">;
type NativeLearningRequest = {
  send(url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<{
    status: number;
    body: string;
  }>;
  cancel(): Promise<void>;
};

export async function sendLearningRequest(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<LearningResponse> {
  const native = Platform.OS === "android"
    ? requireOptionalNativeModule<{ Request: new () => NativeLearningRequest }>("ReloLearningTransport")
    : null;
  if (!native) return expoFetch(url, { method: "POST", headers, body, signal });
  if (signal.aborted) throw new Error("Request cancelled");

  const request = new native.Request();
  const cancel = () => { void request.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const response = await request.send(url, headers, body, timeoutMs);
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      json: async () => JSON.parse(response.body),
    };
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
