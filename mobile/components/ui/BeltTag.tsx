import { StyleSheet, View } from "react-native";
import { useTheme, type Belt } from "../../theme/theme";
import Txt from "./Txt";

// Swatch + "Green belt · B2" pill.
export default function BeltTag({
  belt,
  size = "md",
  showCefr = true,
}: {
  belt: Belt;
  size?: "sm" | "md";
  showCefr?: boolean;
}) {
  const t = useTheme();
  const sm = size === "sm";
  const sw = sm ? 14 : 18;
  return (
    <View
      style={[
        styles.wrap,
        {
          gap: sm ? 6 : 8,
          backgroundColor: t.c.surface2,
          borderColor: t.c.line,
          paddingVertical: sm ? 4 : 5,
          paddingLeft: sm ? 5 : 6,
          paddingRight: sm ? 9 : 12,
        },
      ]}
    >
      <View
        style={{
          width: sw,
          height: sw,
          borderRadius: 5,
          backgroundColor: belt.color,
          borderWidth: 1.5,
          borderColor: belt.edge,
        }}
      />
      <Txt variant="caption" style={{ fontSize: sm ? 12 : 13 }}>
        {belt.name}
        {showCefr ? <Txt variant="caption" color={t.c.ink3} style={{ fontSize: sm ? 12 : 13 }}>{` · ${belt.cefr}`}</Txt> : null}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 999 },
});
