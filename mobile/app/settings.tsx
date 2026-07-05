import { useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Switch, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import { useAuth } from "../store/auth";
import { useProgress } from "../store/progress";
import { DEFAULT_TONE, TONES } from "../store/onboarding";

// Reminder-time presets (the notification plan re-builds from profile.remindHour on change).
const REMIND_HOURS = [8, 12, 16, 19, 21];
import { RU_TONE_LABELS } from "../i18n/strings";
import { analyzePain, deleteAccount, exportMyData } from "../services/api";
import { PRIVACY_URL, TERMS_URL } from "../store/consent";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Chip from "../components/ui/Chip";
import DataGuard from "../components/ui/DataGuard";
import Icon from "../components/ui/Icon";
import Txt from "../components/ui/Txt";

// Settings: account + app preferences, reached from the gear in the TopBar. Moved out of the
// Progress tab so stats stay stats and logout/language aren't buried under achievements.
export default function SettingsScreen() {
  const t = useTheme();
  const { t: tr, lang, setLang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { progress, resetOnboarding, updateProfile } = useProgress();
  const tone = progress.profile?.tone || DEFAULT_TONE;
  const [goalText, setGoalText] = useState("");
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalSaved, setGoalSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Store-compliance: export the caller's data (GET /auth/export) and hand it to the OS share sheet
  // so they can save/send the JSON. Read-only on the server. Only a genuine fetch failure is an
  // "export failed"; the share sheet being dismissed/cancelled (which can reject on some platforms)
  // is a normal outcome and must NOT surface an error — so the fetch and the share are guarded apart.
  async function onExportData() {
    if (exporting) return;
    setExporting(true);
    let data: unknown;
    try {
      data = await exportMyData();
    } catch {
      setExporting(false);
      Alert.alert(tr("settings.exportData"), tr("settings.exportFail"));
      return;
    }
    try {
      await Share.share({ message: JSON.stringify(data, null, 2), title: tr("settings.exportData") });
    } catch {
      // The user dismissed the share sheet (or the platform rejected a cancel) — not an export failure.
    } finally {
      setExporting(false);
    }
  }

  // Store-compliance: in-app account deletion. Confirm first (irreversible), then DELETE the account
  // and sign out — logout() clears the token, which resets the local progress cache (see store/progress).
  function onDeleteAccount() {
    if (deleting) return;
    Alert.alert(tr("settings.deleteTitle"), tr("settings.deleteMsg"), [
      { text: tr("settings.deleteCancel"), style: "cancel" },
      {
        text: tr("settings.deleteConfirm"),
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteAccount();
            await logout(); // clears the dead token → progress store wipes local state for the guest
            router.replace("/");
          } catch {
            Alert.alert(tr("settings.deleteAccount"), tr("settings.deleteFail"));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  // "Change my goal": free text, any time. /profile/analyze maps it to topics and (when logged in)
  // persists it into the server-side learner profile; locally it refreshes painText + focusTopics.
  async function submitGoal() {
    const text = goalText.trim();
    if (!text || goalBusy) return;
    setGoalBusy(true);
    setGoalSaved(false);
    try {
      const { topics } = await analyzePain(text);
      const prevFocus = progress.profile?.focusTopics ?? [];
      updateProfile({ painText: text, focusTopics: Array.from(new Set([...prevFocus, ...topics])) });
      setGoalText("");
      setGoalSaved(true);
    } catch {
      // offline / model down — keep the text so the user can retry
    } finally {
      setGoalBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top + 8 }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityLabel="Back">
          <Icon name="back" size={24} color={t.c.ink2} />
        </Pressable>
        <Txt variant="screenTitle">{tr("settings.title")}</Txt>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: t.spacing.pad, paddingBottom: insets.bottom + 24, gap: t.spacing.gap }}
        showsVerticalScrollIndicator={false}
      >
        <Card>
          <Txt variant="label" style={{ marginBottom: 10 }}>
            {tr("settings.account")}
          </Txt>
          {!!user && (
            <Txt variant="body" color={t.c.ink3} style={{ marginBottom: 12 }}>
              {user.email}
            </Txt>
          )}
          <View style={styles.toggleRow}>
            <Txt variant="bodyStrong">{tr("settings.dark")}</Txt>
            <Switch
              value={t.name === "dark"}
              onValueChange={t.toggle}
              trackColor={{ true: t.c.accent, false: t.c.line2 }}
              thumbColor={t.c.surface}
            />
          </View>
          <View style={styles.toggleRow}>
            <Txt variant="bodyStrong">{tr("settings.language")}</Txt>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["ru", "en"] as const).map((l) => (
                <Pressable
                  key={l}
                  onPress={() => setLang(l)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: t.spacing.radiusSm,
                    backgroundColor: lang === l ? t.c.accent : t.c.surface3,
                  }}
                >
                  <Txt variant="bodyStrong" color={lang === l ? t.c.accentInk : t.c.ink2}>
                    {l === "ru" ? "Русский" : "English"}
                  </Txt>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ marginBottom: 12 }}>
            <Txt variant="bodyStrong" style={{ marginBottom: 8 }}>
              {tr("settings.remind")}
            </Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {REMIND_HOURS.map((h) => (
                <Chip
                  key={h}
                  label={`${String(h).padStart(2, "0")}:00`}
                  selected={(progress.profile?.remindHour ?? 19) === h}
                  onPress={() => updateProfile({ remindHour: h })}
                />
              ))}
            </View>
          </View>
          <View style={{ marginBottom: 12 }}>
            <Txt variant="bodyStrong" style={{ marginBottom: 8 }}>
              {tr("settings.tone")}
            </Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {TONES.map((x) => (
                <Chip
                  key={x.id}
                  label={lang === "ru" ? RU_TONE_LABELS[x.id] ?? x.label : x.label}
                  selected={tone === x.id}
                  onPress={() => updateProfile({ tone: x.id })}
                />
              ))}
            </View>
          </View>
          <Button
            label={tr("settings.redoOnboarding")}
            variant="ghost"
            uppercase={false}
            onPress={resetOnboarding}
            style={{ marginBottom: 10 }}
          />
          <Pressable onPress={logout} style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }}>
            <Txt variant="bodyStrong" color={t.c.bad}>
              {tr("settings.logout")}
            </Txt>
          </Pressable>

          {/* Store-compliance: data export + in-app account deletion (signed-in accounts only). */}
          {!!user && (
            <>
              <Button
                label={tr("settings.exportData")}
                variant="ghost"
                uppercase={false}
                onPress={onExportData}
                disabled={exporting}
                style={{ marginTop: 6 }}
              />
              <Pressable
                onPress={onDeleteAccount}
                disabled={deleting}
                style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }}
                accessibilityLabel={tr("settings.deleteAccount")}
              >
                <Txt variant="bodyStrong" color={t.c.bad}>
                  {tr("settings.deleteAccount")}
                </Txt>
              </Pressable>
            </>
          )}
        </Card>

        {/* Privacy & cross-border consent (152-ФЗ): re-read the standalone consent + the full policy.
            Sits next to the account delete/export actions — withdrawal = delete account. */}
        <Card>
          <Txt variant="label" style={{ marginBottom: 6 }}>
            {tr("settings.privacyTitle")}
          </Txt>
          <Txt variant="secondary" color={t.c.ink3} style={{ marginBottom: 10 }}>
            {tr("settings.privacySub")}
          </Txt>
          <Button
            label={tr("settings.consentReview")}
            variant="ghost"
            uppercase={false}
            onPress={() => router.push("/consent?review=1")}
            style={{ marginBottom: 6 }}
          />
          <Button
            label={tr("settings.privacyPolicy")}
            variant="ghost"
            uppercase={false}
            onPress={() => Linking.openURL(PRIVACY_URL)}
            style={{ marginBottom: 6 }}
          />
          <Button
            label={tr("settings.terms")}
            variant="ghost"
            uppercase={false}
            onPress={() => Linking.openURL(TERMS_URL)}
            style={{ marginBottom: 6 }}
          />
          {/* Neutral studio-site link (plain landing, not a purchase URL — safe on iOS too). */}
          <Button
            label={tr("links.site")}
            variant="ghost"
            uppercase={false}
            onPress={() => Linking.openURL("https://family-pie.ru")}
          />
        </Card>

        {/* Free-text goal change (Praktika adoption Stage 1): the account adapts to a new goal. */}
        <Card>
          <Txt variant="label" style={{ marginBottom: 6 }}>
            {tr("settings.goalTitle")}
          </Txt>
          <Txt variant="secondary" color={t.c.ink3} style={{ marginBottom: 10 }}>
            {tr("settings.goalSub")}
          </Txt>
          {!!progress.profile?.painText && (
            <Txt variant="body" color={t.c.ink2} style={{ marginBottom: 10 }}>
              «{progress.profile.painText}»
            </Txt>
          )}
          <TextInput
            value={goalText}
            onChangeText={(v) => {
              setGoalText(v);
              setGoalSaved(false);
            }}
            placeholder={tr("settings.goalPlaceholder")}
            placeholderTextColor={t.c.ink3}
            multiline
            style={{
              borderWidth: 1,
              borderColor: t.c.line2,
              borderRadius: t.spacing.radiusSm,
              padding: 12,
              minHeight: 64,
              color: t.c.ink,
              marginBottom: 10,
            }}
          />
          <DataGuard style={{ marginBottom: 10 }} />
          {goalSaved && (
            <Txt variant="secondary" color={t.c.accent} style={{ marginBottom: 8 }}>
              {tr("settings.goalSaved")}
            </Txt>
          )}
          <Button
            label={goalBusy ? tr("ob.analyzing") : tr("settings.goalSave")}
            uppercase={false}
            onPress={submitGoal}
            disabled={goalBusy || !goalText.trim()}
          />
        </Card>

        {/* Secondary door to the Lavka, for people who look for "where do I spend koku" here. */}
        <Button
          label={`🌾 ${tr("btn.shop.title")}`}
          variant="ghost"
          uppercase={false}
          onPress={() => router.push("/shop")}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 44 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, marginBottom: 6 },
});
