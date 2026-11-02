import { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import { useTheme, type Belt } from "../../theme/theme";
import { useEquippedSenseiVisual } from "../../store/cosmeticsStore";
import type { SenseiVisual } from "../../store/cosmetics";
import WatercolorSensei, { type Mood } from "./WatercolorSensei";

export type { Mood } from "./WatercolorSensei";

// Keep one appearance contract for feedback, the room, and Wardrobe try-on previews.
export default function Sensei({
  size = 88,
  mood = "happy",
  bob = false,
  visual,
}: {
  /** @deprecated Kept for existing callers; the learner's belt is shown separately. */
  belt?: Belt;
  size?: number;
  mood?: Mood;
  bob?: boolean;
  /** Override the equipped skin (used by the Wardrobe try-on preview). */
  visual?: SenseiVisual;
}) {
  const { reduceMotion } = useTheme();
  const equipped = useEquippedSenseiVisual();
  const y = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Returning to zero also covers Reduce Motion being enabled mid-animation.
    y.setValue(0);
    if (!bob || reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: -5, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false }),
        Animated.timing(y, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      y.setValue(0);
    };
  }, [bob, reduceMotion, y]);

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ translateY: y }] }}>
      <WatercolorSensei size={size} mood={mood} visual={visual ?? equipped} />
    </Animated.View>
  );
}
