// Mock native modules that the pure logic under test pulls in transitively (store/progress.tsx →
// AsyncStorage). The library ships an official in-memory Jest mock.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// Google-font asset packages (pulled in transitively via theme/theme.ts when a component renders).
// They ship native font assets jest can't resolve; the values are only used as fontFamily *keys*,
// so a string stub per export is enough for render tests. `virtual: true` → no real module needed.
const fontStub = (names) =>
  Object.fromEntries(names.map((n) => [n, n])); // each export resolves to its own name string
jest.mock(
  "@expo-google-fonts/zen-maru-gothic",
  () => fontStub(["ZenMaruGothic_500Medium", "ZenMaruGothic_700Bold"]),
  { virtual: true }
);
jest.mock(
  "@expo-google-fonts/hanken-grotesk",
  () =>
    fontStub([
      "HankenGrotesk_400Regular",
      "HankenGrotesk_500Medium",
      "HankenGrotesk_600SemiBold",
      "HankenGrotesk_700Bold",
      "HankenGrotesk_800ExtraBold",
    ]),
  { virtual: true }
);
jest.mock(
  "@expo-google-fonts/jetbrains-mono",
  () => fontStub(["JetBrainsMono_400Regular", "JetBrainsMono_600SemiBold"]),
  { virtual: true }
);
