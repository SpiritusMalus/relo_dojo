import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "../../store/auth";
import { useI18n } from "../../store/i18n";
import { useTheme } from "../../theme/theme";
import Button from "./Button";
import Icon from "./Icon";
import Txt from "./Txt";

// Shown while the logged-in account is unverified: explains the gate and offers resend / re-check.
// Renders nothing once verified (or logged out), so it can be dropped at the top of any screen.
export default function ActivationBanner() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { user, refreshUser, resendVerification } = useAuth();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  if (!user || user.is_verified) return null;

  const resend = async () => {
    setBusy(true);
    try {
      await resendVerification();
      setSent(true);
    } catch {
      // best-effort; leave the button as-is
    } finally {
      setBusy(false);
    }
  };

  const recheck = async () => {
    setBusy(true);
    await refreshUser();
    setBusy(false);
    setPending(true); // if still rendered, the link wasn't opened yet
  };

  return (
    <View style={[styles.card, { backgroundColor: t.c.surface2, borderColor: t.c.line2 }]}>
      <View style={styles.row}>
        <Icon name="lock" size={18} color={t.c.ink2} />
        <Txt variant="bodyStrong" style={{ flex: 1 }}>
          {tr("activate.title")}
        </Txt>
      </View>
      <Txt variant="secondary" color={t.c.ink2}>
        {tr("activate.sub", { email: user.email })}
      </Txt>
      {pending && (
        <Txt variant="secondary" color={t.c.bad}>
          {tr("activate.stillPending")}
        </Txt>
      )}
      <View style={styles.actions}>
        <Button
          label={tr("activate.check")}
          onPress={recheck}
          disabled={busy}
          uppercase={false}
          style={{ flex: 1 }}
        />
        <Button
          label={sent ? tr("activate.sent") : tr("activate.resend")}
          onPress={resend}
          disabled={busy || sent}
          uppercase={false}
          variant="ghost"
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
});
