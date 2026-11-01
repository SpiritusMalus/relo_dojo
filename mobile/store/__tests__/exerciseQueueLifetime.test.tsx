import { StrictMode, useState } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { useExerciseQueueLifetime } from "../useExerciseQueueLifetime";
import type { ExerciseQueue } from "../../services/exerciseQueue";

function Harness({ queue }: { queue: ExerciseQueue }) { useExerciseQueueLifetime(queue); return null; }
const makeQueue = () => ({ next: jest.fn(), prefetch: jest.fn(), clear: jest.fn(), dispose: jest.fn(), readyCount: jest.fn() }) as ExerciseQueue;

it("keeps the same queue through StrictMode replay, then releases it on actual exit", async () => {
  const queue = makeQueue();
  let r!: ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<StrictMode><Harness queue={queue} /></StrictMode>); });
  expect(queue.dispose).not.toHaveBeenCalled();
  await act(async () => { r.unmount(); });
  expect(queue.dispose).toHaveBeenCalledTimes(1);
});

it("releases a replaced queue without closing its replacement", async () => {
  const a = makeQueue();
  const b = makeQueue();
  let replace!: (queue: ExerciseQueue) => void;
  function Replaceable() {
    const [queue, setQueue] = useState(a);
    replace = setQueue;
    return <Harness queue={queue} />;
  }
  let r!: ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<Replaceable />); });
  await act(async () => { replace(b); });
  expect(a.dispose).toHaveBeenCalledTimes(1);
  expect(b.dispose).not.toHaveBeenCalled();
  await act(async () => { r.unmount(); });
  expect(b.dispose).toHaveBeenCalledTimes(1);
});
