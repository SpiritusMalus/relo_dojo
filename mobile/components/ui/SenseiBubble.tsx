import { View } from "react-native";
import { useTheme, type Belt } from "../../theme/theme";
import Sensei, { type Mood } from "./Sensei";
import Txt from "./Txt";

// Sensei "speaks" — the mascot + a speech bubble with his line. Restores the designer's coach-line
// presentation (reference/dojo-home.jsx → HomeFocus): the memory-layer line used to be a flat
// "🥋 …" row with no avatar. Pure presentational; the caller supplies the line + a mood.
export default function SenseiBubble({
  belt,
  mood = "happy",
  text,
  size = 56,
}: {
  belt?: Belt;
  mood?: Mood;
  text: string;
  size?: number;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Sensei belt={belt} size={size} mood={mood} bob />
      {/* bubble: squared top-left corner = a little tail pointing back at Sensei */}
      <View
        style={{
          flex: 1,
          backgroundColor: t.c.surface3,
          borderRadius: 16,
          borderTopLeftRadius: 4,
          paddingVertical: 10,
          paddingHorizontal: 14,
        }}
      >
        <Txt variant="secondary" color={t.c.ink2}>
          {text}
        </Txt>
      </View>
    </View>
  );
}
