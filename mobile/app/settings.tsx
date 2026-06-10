import { Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import { useAuth } from "../store/auth";
import { useProgress } from "../store/progress";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
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
  const { resetOnboarding } = useProgress();

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
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 44 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, marginBottom: 6 },
});
