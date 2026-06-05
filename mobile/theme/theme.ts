// Design system for the "dojo" redesign — single source of truth for colours, type, spacing,
// shadows and the belt system. Recreated from design_handoff_grammar_dojo/README.md (resolved hex)
// and reference/theme.css. Presentation only; no app logic or data lives here.
//
// Usage: wrap the app in <ThemeProvider>, then `const t = useTheme()` → { c, name, setName, toggle,
// reduceMotion, ... }. Colours come from `t.c`; spacing/shadows/type are theme-independent except
// `t.shadows` which follows light/dark.
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AccessibilityInfo, type TextStyle, type ViewStyle } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ZenMaruGothic_500Medium,
  ZenMaruGothic_700Bold,
} from "@expo-google-fonts/zen-maru-gothic";
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
  HankenGrotesk_800ExtraBold,
} from "@expo-google-fonts/hanken-grotesk";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_600SemiBold,
} from "@expo-google-fonts/jetbrains-mono";

// --- fonts -------------------------------------------------------------------
// Map passed to useFonts() in the root layout. fontFamily strings below match these keys.
export const fontMap = {
  ZenMaruGothic_500Medium,
  ZenMaruGothic_700Bold,
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
  HankenGrotesk_800ExtraBold,
  JetBrainsMono_400Regular,
  JetBrainsMono_600SemiBold,
};

// Named font faces. Weight is baked into the family (don't set fontWeight with custom fonts).
export const fonts = {
  brand: "ZenMaruGothic_700Bold", // headings, belt names, mascot speech
  brandMd: "ZenMaruGothic_500Medium",
  ui400: "HankenGrotesk_400Regular",
  ui500: "HankenGrotesk_500Medium",
  ui600: "HankenGrotesk_600SemiBold",
  ui700: "HankenGrotesk_700Bold",
  ui800: "HankenGrotesk_800ExtraBold",
  mono: "JetBrainsMono_400Regular",
  mono600: "JetBrainsMono_600SemiBold",
} as const;

// --- colour tokens -----------------------------------------------------------
export type Colors = {
  accent: string;
  accentPress: string;
  accentInk: string;
  accentSoft: string;
  accentSoft2: string;
  fire: string;
  fireSoft: string;
  gold: string;
  bad: string;
  badSoft: string;
  bg: string;
  screen: string;
  surface: string;
  surface2: string;
  surface3: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  line2: string;
};

export const light: Colors = {
  accent: "#0E8A30",
  accentPress: "#0B6E26",
  accentInk: "#FFFFFF",
  accentSoft: "#E0F0E4",
  accentSoft2: "#C0E1C9",
  fire: "#F0801F",
  fireSoft: "#FDECDD",
  gold: "#E3A52C",
  bad: "#D8493A",
  badSoft: "#FCEAE7",
  bg: "#EEF2EE",
  screen: "#FBFDFB",
  surface: "#FFFFFF",
  surface2: "#F2F7F3",
  surface3: "#EAF1EC",
  ink: "#15201A",
  ink2: "#586A60",
  ink3: "#8A988F",
  line: "#E7EDE8",
  line2: "#DDE6E0",
};

export const dark: Colors = {
  accent: "#0E8A30",
  accentPress: "#0B6E26",
  accentInk: "#06140B",
  accentSoft: "#0D2B16",
  accentSoft2: "#0D3E1B",
  fire: "#F0801F",
  fireSoft: "#2C1D10",
  gold: "#E3A52C",
  bad: "#D8493A",
  badSoft: "#2E1714",
  bg: "#080B09",
  screen: "#0D130F",
  surface: "#141C16",
  surface2: "#1A241D",
  surface3: "#212D24",
  ink: "#E9F1EB",
  ink2: "#9AAB9F",
  ink3: "#6C7D71",
  line: "#243029",
  line2: "#2C3A31",
};

// --- spacing & shape (cozy density) ------------------------------------------
export const spacing = {
  pad: 20,
  gap: 14,
  radius: 20,
  radiusSm: 12,
  radiusLg: 28,
  pill: 999,
  hit: 44, // minimum interactive hit target
} as const;

// --- shadows (RN approximations of the CSS multi-layer shadows) ---------------
export type Shadow = Pick<
  ViewStyle,
  "shadowColor" | "shadowOffset" | "shadowOpacity" | "shadowRadius" | "elevation"
>;
type ShadowSet = { sm: Shadow; md: Shadow; lg: Shadow };

const SHADOW_INK = "#142818"; // rgba(20,40,28)

export const shadowsLight: ShadowSet = {
  sm: { shadowColor: SHADOW_INK, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 },
  md: { shadowColor: SHADOW_INK, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.1, shadowRadius: 16, elevation: 6 },
  lg: { shadowColor: SHADOW_INK, shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.16, shadowRadius: 30, elevation: 14 },
};

export const shadowsDark: ShadowSet = {
  sm: { shadowColor: "#000000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 2 },
  md: { shadowColor: "#000000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 16, elevation: 6 },
  lg: { shadowColor: "#000000", shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.55, shadowRadius: 30, elevation: 14 },
};

// --- typography variants (font metrics only; colour applied at the call site) -
export type TypeVariant =
  | "hero"
  | "screenTitle"
  | "cardTitle"
  | "body"
  | "bodyStrong"
  | "secondary"
  | "caption"
  | "label"
  | "mono";

export const type: Record<TypeVariant, TextStyle> = {
  hero: { fontFamily: fonts.brand, fontSize: 32, lineHeight: 38 },
  screenTitle: { fontFamily: fonts.brand, fontSize: 25, lineHeight: 30 },
  cardTitle: { fontFamily: fonts.brand, fontSize: 17, lineHeight: 21 },
  body: { fontFamily: fonts.ui500, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: fonts.ui600, fontSize: 15, lineHeight: 21 },
  secondary: { fontFamily: fonts.ui500, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.ui700, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: fonts.ui800, fontSize: 12, lineHeight: 16, letterSpacing: 1.08, textTransform: "uppercase" },
  mono: { fontFamily: fonts.mono, fontSize: 15, lineHeight: 21 },
};

// --- belt system -------------------------------------------------------------
export type Cefr = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type Belt = {
  id: string;
  cefr: Cefr;
  name: string;
  color: string; // cloth
  edge: string; // border / shadow
  knot: string; // folds
  ink: string; // text on the belt
  idx: number;
};

export const belts: Belt[] = [
  { id: "white", cefr: "A1", name: "White belt", color: "#E9EBE6", edge: "#CDD3CB", knot: "#B7BFB4", ink: "#3A443C", idx: 0 },
  { id: "yellow", cefr: "A2", name: "Yellow belt", color: "#F6C945", edge: "#D8A82A", knot: "#C79C22", ink: "#5A4708", idx: 1 },
  { id: "orange", cefr: "B1", name: "Orange belt", color: "#EF8A36", edge: "#CF6F22", knot: "#BB6420", ink: "#5E2C08", idx: 2 },
  { id: "green", cefr: "B2", name: "Green belt", color: "#39A85C", edge: "#2C8748", knot: "#247A3E", ink: "#0C3A1D", idx: 3 },
  { id: "blue", cefr: "C1", name: "Blue belt", color: "#3F86C9", edge: "#2F6AA6", knot: "#295F93", ink: "#0C2F4D", idx: 4 },
  { id: "black", cefr: "C2", name: "Black belt", color: "#2B3037", edge: "#14171B", knot: "#0B0D10", ink: "#E7EBEF", idx: 5 },
];

/** Belt for a CEFR value (defaults to White for unknown/lower). */
export function beltByCefr(cefr: string | null | undefined): Belt {
  return belts.find((b) => b.cefr === cefr) ?? belts[0];
}

/** Belt by ladder index, clamped to the available belts. */
export function beltByIndex(i: number): Belt {
  return belts[Math.max(0, Math.min(belts.length - 1, i))];
}

// --- theme object + provider -------------------------------------------------
export type ThemeName = "light" | "dark";
export type Theme = {
  name: ThemeName;
  c: Colors;
  shadows: ShadowSet;
  spacing: typeof spacing;
  fonts: typeof fonts;
  type: typeof type;
};

export function makeTheme(name: ThemeName): Theme {
  return {
    name,
    c: name === "dark" ? dark : light,
    shadows: name === "dark" ? shadowsDark : shadowsLight,
    spacing,
    fonts,
    type,
  };
}

type ThemeContextValue = Theme & {
  setName: (n: ThemeName) => void;
  toggle: () => void;
  reduceMotion: boolean; // honour OS "reduce motion" — gate confetti/bob/shake/pop
};

const THEME_KEY = "grammar-dojo/ui/theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [name, setNameState] = useState<ThemeName>("light"); // ship default = Light
  const [reduceMotion, setReduceMotion] = useState(false);

  // Restore the user's saved theme choice (a UI preference, not progress data).
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((v) => {
        if (v === "light" || v === "dark") setNameState(v);
      })
      .catch(() => {});
  }, []);

  // Track the OS reduce-motion setting.
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => active && setReduceMotion(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  const setName = useCallback((n: ThemeName) => {
    setNameState(n);
    void AsyncStorage.setItem(THEME_KEY, n).catch(() => {});
  }, []);
  const toggle = useCallback(() => setName(name === "light" ? "dark" : "light"), [name, setName]);

  const value = useMemo<ThemeContextValue>(
    () => ({ ...makeTheme(name), setName, toggle, reduceMotion }),
    [name, setName, toggle, reduceMotion]
  );

  // .ts file (no JSX) — use createElement for the provider element.
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
