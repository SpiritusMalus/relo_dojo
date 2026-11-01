import { useEffect, useRef } from "react";
import type { ExerciseQueue } from "../services/exerciseQueue";

/** Release a screen's queue on exit, while allowing React's immediate effect replay. */
export function useExerciseQueueLifetime(queue: ExerciseQueue | null): void {
  const mountedQueue = useRef<ExerciseQueue | null>(queue);
  useEffect(() => {
    mountedQueue.current = queue;
    return () => {
      mountedQueue.current = null;
      void Promise.resolve().then(() => {
        if (mountedQueue.current !== queue) queue?.dispose();
      });
    };
  }, [queue]);
}
