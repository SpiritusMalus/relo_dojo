import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, View } from "react-native";
import { belts, useTheme, type Belt } from "../../theme/theme";
import DojoItemArtwork from "./DojoItemArtwork";
import Sensei from "./Sensei";

const ROOM = require("../../assets/sketch/room.png");
const STARTERS = {
  dojo_light: "dojo_light_paper",
  dojo_display: "dojo_display_blank",
  dojo_plant: "dojo_plant_seedling",
};
const SLOT_ITEMS = {
  dojo_light: ["dojo_light_paper", "dojo_light_lantern", "dojo_light_sunset"],
  dojo_display: ["dojo_display_blank", "dojo_display_first_scroll", "dojo_display_wave"],
  dojo_plant: ["dojo_plant_seedling", "dojo_plant_bamboo"],
};
// Authored against a 360 × 270 room: all bases sit on the same desktop.
const PLACES = [
  { slot: "dojo_light", x: -1, y: 119, size: 108 },
  { slot: "dojo_display", x: 209, y: 123, size: 108 },
  { slot: "dojo_plant", x: 271, y: 123, size: 108 },
] as const;

function PlacedItem({ itemId, size }: { itemId: string; size: number }) {
  const { reduceMotion } = useTheme();
  const enter = useRef(new Animated.Value(1)).current;
  const previous = useRef(itemId);
  useEffect(() => {
    enter.stopAnimation();
    if (reduceMotion || previous.current === itemId) {
      enter.setValue(1);
    } else {
      enter.setValue(0);
      Animated.timing(enter, {
        toValue: 1, duration: 240, easing: Easing.out(Easing.exp), useNativeDriver: true,
      }).start();
    }
    previous.current = itemId;
    return () => enter.stopAnimation();
  }, [itemId, reduceMotion, enter]);
  return <Animated.View style={{ opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}>
    <DojoItemArtwork itemId={itemId} size={size} />
  </Animated.View>;
}

/** The same painted room on Home and My Dojo; every equipped object remains its own layer. */
export default function DojoScene({ equipped = {}, compact = false, accessibilityLabel, belt = belts[0] }: {
  equipped?: Record<string, string>; compact?: boolean; accessibilityLabel?: string; belt?: Belt;
}) {
  const [width, setWidth] = useState(0);
  const scale = width / 360;
  const cropTop = compact ? 28 : 0;
  const place = (x: number, y: number) => ({ position: "absolute" as const, left: x * scale, top: (y - cropTop) * scale });

  return (
    <View accessible={!!accessibilityLabel} accessibilityRole="image" accessibilityLabel={accessibilityLabel}
      testID="dojo-scene" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ width: "100%", aspectRatio: compact ? 1.8 : 4 / 3, overflow: "hidden", backgroundColor: "#F5E6CE" }}>
      {width > 0 && <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
        <Image source={ROOM} accessible={false} fadeDuration={0} resizeMode="stretch"
          style={{ position: "absolute", width, height: width * 0.75, top: -cropTop * scale }} />
        <View style={place(69, 70)}><Sensei size={158 * scale} mood="happy" belt={belt} /></View>
        {PLACES.map(({ slot, x, y, size }) => {
          const candidate = equipped[slot];
          const itemId = SLOT_ITEMS[slot].includes(candidate) ? candidate : STARTERS[slot];
          return <View key={slot} testID={`dojo-object-${itemId}`} style={place(x, y)}>
            <PlacedItem itemId={itemId} size={size * scale} />
          </View>;
        })}
      </View>}
    </View>
  );
}
