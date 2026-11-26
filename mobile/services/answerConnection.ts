import { addNetworkStateListener, getNetworkStateAsync, NetworkStateType } from "expo-network";

export type AnswerConnectionFailure = "answer_offline" | "answer_timeout";

const activeChecks = new Set<() => void>();
let listening = false;

function watchForDisconnect(onDisconnect: () => void): () => void {
  activeChecks.add(onDisconnect);
  if (!listening) {
    try {
      // SDK 54's iOS network monitor cannot restart after its last listener is removed.
      // Keep one native listener and remove individual checks when they settle.
      addNetworkStateListener((state) => {
        if (state.type === NetworkStateType.NONE) {
          for (const check of activeChecks) check();
        }
      });
      listening = true;
    } catch {
      // A platform without a network monitor can still attempt the bounded request.
    }
  }
  return () => { activeChecks.delete(onDisconnect); };
}

export function withAnswerConnection<T>(
  send: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  makeError: (reason: AnswerConnectionFailure) => Error,
): Promise<T> {
  const controller = new AbortController();
  let rejectInterruption!: (error: Error) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectInterruption = reject; });
  const interrupt = (reason: AnswerConnectionFailure) => {
    if (controller.signal.aborted) return;
    rejectInterruption(makeError(reason));
    controller.abort();
  };
  const timer = setTimeout(() => interrupt("answer_timeout"), timeoutMs);
  const unwatch = watchForDisconnect(() => interrupt("answer_offline"));
  const request = async () => {
    // Recheck the native state on every explicit retry after a network switch. Android's
    // internet validation can fail even when this API is reachable.
    const state = await getNetworkStateAsync().catch(() => undefined);
    if (state?.type === NetworkStateType.NONE) interrupt("answer_offline");
    if (controller.signal.aborted) return interrupted;
    return send(controller.signal);
  };

  // The UI deadline covers both headers and body, even if the native request hangs on abort.
  return Promise.race([request(), interrupted]).finally(() => {
    clearTimeout(timer);
    unwatch();
  });
}
