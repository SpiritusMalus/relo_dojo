import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../../store/i18n";
import { useTheme } from "../../theme/theme";
import Button from "./Button";
import Txt from "./Txt";

// Separate, specific VOICE consent prompt (152-ФЗ) — shown before the first microphone capture when
// voice consent hasn't been granted. Distinct from the text-consent screen. Copy is a DRAFT pending
// legal/DPO sign-off (brief voice-direction step 3); the gate is inert while VOICE_ENABLED=false.
export default function VoiceConsentSheet({
  visible,
  onAccept,
  onDecline,
}: {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDecline}>
      <Pressable style={styles.backdrop} onPress={onDecline} accessibilityRole="button" accessibilityLabel={tr("voice.consentDecline")}>
        <Pressable
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: t.c.surface, paddingBottom: insets.bottom + 16, borderColor: t.c.line }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.grabber, { backgroundColor: t.c.line2 }]} />
          <Txt variant="cardTitle" style={{ marginBottom: 8 }}>{tr("voice.consentTitle")}</Txt>
          <Txt variant="body" color={t.c.ink2} style={{ marginBottom: 16 }}>{tr("voice.consentBody")}</Txt>
          <View style={{ gap: 8 }}>
            <Button label={tr("voice.consentAccept")} onPress={onAccept} />
            <Button variant="ghost" label={tr("voice.consentDecline")} onPress={onDecline} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, padding: 20 },
  grabber: { width: 44, height: 5, borderRadius: 999, alignSelf: "center", marginBottom: 14 },
});
