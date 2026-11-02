import { Image, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { SenseiVisual } from "../../store/cosmetics";
import type { Belt } from "../../theme/theme";

export type Mood = "happy" | "cheer" | "think" | "sad";

const ATLAS = require("../../assets/sketch/sensei-atlas.png");
const MOOD_ROW: Record<Mood, number> = { happy: 0, cheer: 1, think: 2, sad: 3 };
// Every shipped catalog visual has its own painted hair, skin tone, and accessory.
// The same selection handles equipped cosmetics and explicit Wardrobe previews.
const SKIN_COLUMN = { beard: 1, scar: 2, sakura: 3 } as const;

/** A genuine transparent portrait, cropped natively from the equal-cell 4 × 4 atlas. */
export default function WatercolorSensei({
  belt,
  size,
  mood,
  visual,
}: {
  belt: Belt;
  size: number;
  mood: Mood;
  visual: SenseiVisual;
}) {
  const column = visual.accessory ? SKIN_COLUMN[visual.accessory] : 0;
  const row = MOOD_ROW[mood];

  return (
    <View style={{ width: size, height: size }} pointerEvents="none" accessible={false}>
      <View style={{ width: size, height: size, overflow: "hidden" }}>
        <Image
          source={ATLAS}
          accessible={false}
          fadeDuration={0}
          resizeMode="stretch"
          style={{
            position: "absolute",
            width: size * 4,
            height: size * 4,
            left: -column * size,
            top: -row * size,
          }}
        />
      </View>
      {/* A small cloth progress ribbon keeps the real belt colour visible without
          painting a synthetic headband over the hand-drawn face. */}
      <Svg
        width={size * 0.21}
        height={size * 0.13}
        viewBox="0 0 32 20"
        style={{ position: "absolute", right: size * 0.04, bottom: size * 0.025 }}
        accessible={false}
      >
        <Path d="M2 4 L28 3 L29 15 L18 13 L3 16 Z" fill={belt.color} stroke={belt.edge} strokeWidth={1.2} strokeLinejoin="round" />
        <Path d="M11 4 L16 4 L17 14 L12 15 Z" fill={belt.knot} />
        <Path d="M3 7 L10 6 M18 6 L26 6" stroke={belt.ink} strokeOpacity={0.2} strokeWidth={0.7} />
      </Svg>
    </View>
  );
}
