import { Image, View } from "react-native";
import type { SenseiVisual } from "../../store/cosmetics";

export type Mood = "happy" | "cheer" | "think" | "sad";

const ATLAS = require("../../assets/sketch/sensei-atlas.png");
const CLASSIC_ATLAS = require("../../assets/sketch/classic-sensei-atlas.png");
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
  const { accessory } = visual;
  const specialtySkin = accessory === "beard" || accessory === "scar";
  const atlas = specialtySkin ? ATLAS : accessory === "sakura" ? SPRING_ATLAS : CLASSIC_ATLAS;
  const moodIndex = MOOD_INDEX[mood];
  // Classic and Spring have their own 2 × 2 sheets. Sage and Ronin use the
  // middle two columns of the original 4 × 4 sheet.
  const gridSize = specialtySkin ? 4 : 2;
  const column = specialtySkin ? SKIN_COLUMN[accessory] : moodIndex % 2;
  const row = specialtySkin ? moodIndex : Math.floor(moodIndex / 2);

  return (
    <View style={{ width: size, height: size }} pointerEvents="none" accessible={false}>
      <View style={{ width: size, height: size, overflow: "hidden" }}>
        <Image
          source={atlas}
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
