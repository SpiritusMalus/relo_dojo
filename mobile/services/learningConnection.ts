import { addNetworkStateListener, getNetworkStateAsync, NetworkStateType } from "expo-network";

export type LearningConnectionFailure = "learning_offline" | "learning_timeout" | "request_aborted";

const activeRequests = new Set<() => void>();
let listening = false;

function watchForDisconnect(onDisconnect: () => void): () => void {
  activeRequests.add(onDisconnect);
  if (!listening) {
    try {
      // SDK 54's iOS network monitor cannot restart after its last listener is removed.
      // Keep one native listener and remove individual requests when they settle.
      addNetworkStateListener((state) => {
        if (state.type === NetworkStateType.NONE) {
          for (const request of activeRequests) request();
        }
      });
      listening = true;
    } catch {
      // A platform without a network monitor can still attempt the bounded request.
    }
  }
  return () => { activeRequests.delete(onDisconnect); };
}

export function withLearningConnection<T>(
  send: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  makeError: (reason: LearningConnectionFailure) => Error,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) return Promise.reject(makeError("request_aborted"));
  const controller = new AbortController();
  let rejectInterruption!: (error: Error) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectInterruption = reject; });
  const interrupt = (reason: LearningConnectionFailure) => {
    if (controller.signal.aborted) return;
    rejectInterruption(makeError(reason));
    controller.abort();
  };
  const onAbort = () => interrupt("request_aborted");
  parentSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => interrupt("learning_timeout"), timeoutMs);
  const unwatch = watchForDisconnect(() => interrupt("learning_offline"));
  const request = async () => {
    // Recheck the native state on every explicit retry after a network switch. Android's
    // internet validation can fail even when this API is reachable.
    const state = await getNetworkStateAsync().catch(() => undefined);
    if (state?.type === NetworkStateType.NONE) interrupt("learning_offline");
    if (controller.signal.aborted) return interrupted;
    return send(controller.signal);
  };

  // The UI deadline covers both headers and body, even if the native request hangs on abort.
  return Promise.race([request(), interrupted]).finally(() => {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
    unwatch();
  });
}
