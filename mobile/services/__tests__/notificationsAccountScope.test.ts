jest.mock("expo-constants", () => ({
  __esModule: true, default: { executionEnvironment: "standalone" }, ExecutionEnvironment: { StoreClient: "storeClient" },
}));
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(), setNotificationChannelAsync: jest.fn(async () => {}),
  AndroidImportance: { DEFAULT: 3 }, SchedulableTriggerInputTypes: { DATE: "date" },
  getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(), scheduleNotificationAsync: jest.fn(),
}));

import * as Native from "expo-notifications";
import { cancelPersonalNotifications, ensurePermission, rescheduleAll, type ScheduleState } from "../notifications";
import { captureAccountScope, setAccountToken } from "../../store/accountScope";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const now = new Date(2026, 0, 1, 8);
const A: ScheduleState = { lang: "en", trainedToday: false, dailyStreak: 123, contractsLeft: 91 };
const B: ScheduleState = { lang: "ru", trainedToday: false, dailyStreak: 2, contractsLeft: 2 };
const scheduled = new Map<string, Native.NotificationRequestInput>();
let nextId = 0;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  jest.clearAllMocks();
  scheduled.clear();
  nextId = 0;
  setAccountToken("session-a");
  jest.mocked(Native.cancelAllScheduledNotificationsAsync).mockImplementation(async () => { scheduled.clear(); });
  jest.mocked(Native.scheduleNotificationAsync).mockImplementation(async (request) => {
    const id = String(++nextId);
    scheduled.set(id, request);
    return id;
  });
});
afterEach(async () => { await cancelPersonalNotifications(); setAccountToken(null); });

it("waits for in-flight A native scheduling before cancelling and laying down B's plan", async () => {
  const pending = deferred<string>();
  jest.mocked(Native.scheduleNotificationAsync).mockImplementationOnce(async (request) => {
    const id = await pending.promise;
    scheduled.set(id, request); // native completion occurs AFTER the account switch
    return id;
  });
  const a = rescheduleAll(A, now);
  await flush();
  expect(Native.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  setAccountToken("session-b");
  const cancel = cancelPersonalNotifications();
  const b = rescheduleAll(B, now, captureAccountScope());
  await flush();
  expect(Native.scheduleNotificationAsync).toHaveBeenCalledTimes(1); // B cannot race A's native await
  pending.resolve("late-a");
  await Promise.all([a, cancel, b]);
  expect(scheduled.size).toBe(5);
  expect([...scheduled.values()].some((request) => request.content.body?.includes("123"))).toBe(false);
  expect([...scheduled.values()].some((request) => request.content.body?.includes("91"))).toBe(false);
  expect([...scheduled.values()].every((request) => /[А-Яа-я]/.test(request.content.body ?? ""))).toBe(true);
});

it("removes a native A completion that arrives after logout without scheduling more A plans", async () => {
  const pending = deferred<string>();
  jest.mocked(Native.scheduleNotificationAsync).mockImplementationOnce(async (request) => {
    const id = await pending.promise;
    scheduled.set(id, request);
    return id;
  });
  const a = rescheduleAll(A, now);
  await flush();
  setAccountToken(null);
  const cancel = cancelPersonalNotifications();
  pending.resolve("late-a");
  await Promise.all([a, cancel]);
  expect(Native.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(scheduled.size).toBe(0);
});

it("does not even cancel B's schedule when a stale parent supplies an A scope", async () => {
  const aScope = captureAccountScope();
  setAccountToken("session-b");
  await rescheduleAll(B, now);
  const current = [...scheduled.entries()];
  const cancels = jest.mocked(Native.cancelAllScheduledNotificationsAsync).mock.calls.length;
  await rescheduleAll(A, now, aScope);
  expect([...scheduled.entries()]).toEqual(current);
  expect(Native.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(cancels);
});

it("recovers its serialized queue after a native error so the next account can schedule", async () => {
  jest.mocked(Native.scheduleNotificationAsync).mockRejectedValueOnce(new Error("native rejected"));
  await expect(rescheduleAll(A, now)).rejects.toThrow("native rejected");
  setAccountToken("session-b");
  await cancelPersonalNotifications();
  await rescheduleAll(B, now);
  expect(scheduled.size).toBe(5);
});

it("stops permission work when the account changes during a native permissions read", async () => {
  const permission = deferred<Awaited<ReturnType<typeof Native.getPermissionsAsync>>>();
  jest.mocked(Native.getPermissionsAsync).mockReturnValueOnce(permission.promise);
  const pending = ensurePermission();
  setAccountToken("session-b");
  permission.resolve({ granted: false, canAskAgain: true, status: "undetermined", expires: "never" } as Awaited<ReturnType<typeof Native.getPermissionsAsync>>);
  expect(await pending).toBe(false);
  expect(Native.requestPermissionsAsync).not.toHaveBeenCalled();
});

it("respects a prior denial instead of asking again on another login or launch", async () => {
  jest.mocked(Native.getPermissionsAsync).mockResolvedValueOnce({
    granted: false, canAskAgain: true, status: "denied", expires: "never",
  } as Awaited<ReturnType<typeof Native.getPermissionsAsync>>);
  expect(await ensurePermission()).toBe(false);
  expect(Native.requestPermissionsAsync).not.toHaveBeenCalled();
});

it("discards a granted permission response that belongs to an earlier account scope", async () => {
  type Permission = Awaited<ReturnType<typeof Native.requestPermissionsAsync>>;
  const permission = deferred<Permission>();
  jest.mocked(Native.getPermissionsAsync).mockResolvedValueOnce({
    granted: false, canAskAgain: true, status: "undetermined", expires: "never",
  } as Permission);
  jest.mocked(Native.requestPermissionsAsync).mockReturnValueOnce(permission.promise);
  const pending = ensurePermission();
  await flush();
  expect(Native.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  setAccountToken("session-b");
  permission.resolve({ granted: true, canAskAgain: true, status: "granted", expires: "never" } as Permission);
  expect(await pending).toBe(false);
});
