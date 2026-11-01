import { useSyncExternalStore } from "react";
import { captureAccountScope, subscribeAccountScope } from "./accountScope";

/** The stable snapshot changes synchronously with the API session, including offline restore. */
export function useAccountScope() {
  return useSyncExternalStore(subscribeAccountScope, captureAccountScope, captureAccountScope);
}
