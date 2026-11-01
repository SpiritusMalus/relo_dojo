jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("expo-constants", () => ({
  __esModule: true, default: { executionEnvironment: "storeClient" }, ExecutionEnvironment: { StoreClient: "storeClient" },
}));
jest.mock("expo-notifications", () => ({
  cancelAllScheduledNotificationsAsync: jest.fn(), scheduleNotificationAsync: jest.fn(), getPermissionsAsync: jest.fn(),
}));

import * as Native from "expo-notifications";
import { cancelPersonalNotifications, ensurePermission, rescheduleAll } from "../notifications";

it("safely skips personal reminder cancellation and scheduling in Android Expo Go", async () => {
  await expect(ensurePermission()).resolves.toBe(false);
  await expect(cancelPersonalNotifications()).resolves.toBeUndefined();
  await expect(rescheduleAll({ lang: "en", trainedToday: false, dailyStreak: 123 })).resolves.toBeUndefined();
  expect(Native.getPermissionsAsync).not.toHaveBeenCalled();
  expect(Native.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  expect(Native.scheduleNotificationAsync).not.toHaveBeenCalled();
});
