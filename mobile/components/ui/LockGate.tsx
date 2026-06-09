import { type ReactNode } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";
import { useI18n } from "../../store/i18n";
import Icon from "./Icon";

// Wrap any tappable block; when `locked`, it's dimmed, taps are intercepted (showing an "activate"
// alert) and a small lock chip is overlaid. Lets us gate buttons without changing each component.
export default function LockGate({ locked, children }: { locked: boolean; children: ReactNode }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  if (!locked) return <>{children}</>;
  return (
    <View>
      <View pointerEvents="none" style={{ opacity: 0.45 }}>
        {children}
      </View>
      <Pressable
        onPress={() => Alert.alert(tr("activate.title"), tr("activate.lockedMsg"))}
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={tr("activate.lockedMsg")}
      >
        <View style={[styles.chip, { backgroundColor: t.c.surface, borderColor: t.c.line2 }]}>
          <Icon name="lock" size={16} color={t.c.ink2} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
