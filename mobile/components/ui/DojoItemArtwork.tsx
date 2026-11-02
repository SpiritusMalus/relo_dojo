import { Image, View } from "react-native";

const ATLAS = require("../../assets/sketch/items-atlas.png");
const FRAMES: Record<string, readonly [number, number]> = {
  dojo_light_paper: [0, 0],
  dojo_light_lantern: [1, 0],
  dojo_light_sunset: [2, 0],
  dojo_display_blank: [0, 1],
  dojo_display_first_scroll: [1, 1],
  dojo_display_wave: [2, 1],
  dojo_plant_seedling: [0, 2],
  dojo_plant_bamboo: [1, 2],
};

/** Native equal-cell crop. The PNG's alpha preserves the watercolor's irregular edges. */
export default function DojoItemArtwork({ itemId, size = 64, accessibilityLabel }: {
  itemId: string; size?: number; accessibilityLabel?: string;
}) {
  const frame = FRAMES[itemId];
  if (!frame) return null;
  const [column, row] = frame;
  return <View accessible={!!accessibilityLabel} accessibilityRole="image" accessibilityLabel={accessibilityLabel}
    style={{ width: size, height: size, overflow: "hidden" }}>
    <Image source={ATLAS} accessible={false} fadeDuration={0} resizeMode="stretch"
      style={{ position: "absolute", width: size * 3, height: size * 3, left: -column * size, top: -row * size }} />
  </View>;
}
