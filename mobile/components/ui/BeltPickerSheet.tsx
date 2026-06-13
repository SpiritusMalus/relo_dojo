import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { belts, useTheme, type Belt } from "../../theme/theme";
import BeltKnot from "./BeltKnot";
import Icon from "./Icon";
import Txt from "./Txt";

// Bottom sheet listing all six belts; the current one is highlighted. Read-only (shows the
// progression / belt requirements) per the v1 spec.
export default function BeltPickerSheet({
  visible,
  current,
  onClose,
}: {
  visible: boolean;
  current: Belt;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
        <Pressable
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: t.c.surface, paddingBottom: insets.bottom + 16, borderColor: t.c.line },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.grabber, { backgroundColor: t.c.line2 }]} />
          <Txt variant="cardTitle" style={{ marginBottom: 4 }}>
            Belts
          </Txt>
          <Txt variant="secondary" style={{ marginBottom: 12 }}>
            Your belt rises with your overall CEFR level.
          </Txt>
          <ScrollView showsVerticalScrollIndicator={false}>
            {belts.map((b) => {
              const active = b.id === current.id;
              return (
                <View
                  key={b.id}
                  style={[
                    styles.row,
                    {
                      borderColor: active ? t.c.accent : t.c.line,
                      backgroundColor: active ? t.c.accentSoft : t.c.surface,
                    },
                  ]}
                >
                  <BeltKnot belt={b} size={34} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong" color={active ? t.c.accent : t.c.ink}>
                      {b.name}
                    </Txt>
                    <Txt variant="secondary">CEFR {b.cefr}</Txt>
                  </View>
                  {active && <Icon name="check" size={22} color={t.c.accent} />}
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, padding: 20, maxHeight: "82%" },
  grabber: { width: 44, height: 5, borderRadius: 999, alignSelf: "center", marginBottom: 14 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 2,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
});
