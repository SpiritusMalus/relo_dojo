import { Image, View } from "react-native";
import type { SenseiVisual } from "../../store/cosmetics";

export type Mood = "happy" | "cheer" | "think" | "sad";

const ATLAS = require("../../assets/sketch/sensei-atlas.png");
const SPRING_ATLAS = require("../../assets/sketch/spring-sensei-atlas.png");
const MOOD_INDEX: Record<Mood, number> = { happy: 0, cheer: 1, think: 2, sad: 3 };
// Every shipped catalog skin has its own painted portrait, hair and skin palette.
// The same selection handles equipped cosmetics and explicit Wardrobe previews.
const SKIN_COLUMN = { beard: 1, scar: 2 } as const;

/** A transparent painted portrait, cropped natively from its equal-cell atlas. */
export default function WatercolorSensei({
  size,
  mood,
  visual,
}: {
  size: number;
  mood: Mood;
  visual: SenseiVisual;
}) {
  const spring = visual.accessory === "sakura";
  const moodIndex = MOOD_INDEX[mood];
  // Spring uses a flowerless 2 × 2 portrait sheet; the other skins retain their
  // original 4 × 4 sheet. Its former flower portrait column is never selected.
  const gridSize = spring ? 2 : 4;
  const column = visual.accessory === "sakura" ? moodIndex % 2 : visual.accessory ? SKIN_COLUMN[visual.accessory] : 0;
  const row = spring ? Math.floor(moodIndex / 2) : moodIndex;

  return (
    <View style={{ width: size, height: size }} pointerEvents="none" accessible={false}>
      <View style={{ width: size, height: size, overflow: "hidden" }}>
        <Image
          source={spring ? SPRING_ATLAS : ATLAS}
          accessible={false}
          fadeDuration={0}
          resizeMode="stretch"
          style={{
            position: "absolute",
            width: size * gridSize,
            height: size * gridSize,
            left: -column * size,
            top: -row * size,
          }}
        />
      </View>
    </View>
  );
}
