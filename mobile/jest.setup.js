// Mock native modules that the pure logic under test pulls in transitively (store/progress.tsx →
// AsyncStorage). The library ships an official in-memory Jest mock.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
