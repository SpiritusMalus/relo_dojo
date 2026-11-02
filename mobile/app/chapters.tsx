import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { getChapters, CHAPTER_IDS, type ChapterCatalog } from "../services/chapters";
import { chapterCopy } from "../i18n/chapterCopy";
import { useAuth } from "../store/auth";
import { useAccountScope } from "../store/useAccountScope";
import { isCurrentAccountScope, type AccountScope } from "../store/accountScope";
import { useI18n } from "../store/i18n";
import { useTheme } from "../theme/theme";
import { dojoItemName } from "../store/dojoRoomCopy";
import Button from "../components/ui/Button";
import DojoItemArtwork from "../components/ui/DojoItemArtwork";
import Icon from "../components/ui/Icon";
import Screen from "../components/ui/Screen";
import Txt from "../components/ui/Txt";

type CatalogState = { scope: AccountScope; catalog: ChapterCatalog | null; loading: boolean; error: boolean };
export default function ChaptersScreen() {
  const t = useTheme();
  const router = useRouter();
  const { lang } = useI18n();
  const { token } = useAuth();
  const scope = useAccountScope();
  const copy = chapterCopy(lang);
  const guest = !token || !scope.owner || scope.owner === "guest";
  const [state, setState] = useState<CatalogState>({ scope, catalog: null, loading: !guest, error: false });
  const [attempt, setAttempt] = useState(0);
  const visible = state.scope === scope ? state : { scope, catalog: null, loading: !guest, error: false };
  useFocusEffect(useCallback(() => {
    let active = true;
    if (guest) { setState({ scope, catalog: null, loading: false, error: false }); return; }
    setState({ scope, catalog: null, loading: true, error: false });
    void getChapters(lang).then((catalog) => {
      if (active && isCurrentAccountScope(scope)) setState({ scope, catalog, loading: false, error: false });
    }).catch(() => {
      if (active && isCurrentAccountScope(scope)) setState({ scope, catalog: null, loading: false, error: true });
    });
    return () => { active = false; };
  }, [scope, guest, lang, attempt]));

  return <Screen>
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={copy.back}
        style={({ pressed }) => [styles.back, { backgroundColor: pressed ? t.c.surface2 : "transparent" }]}>
        <Icon name="back" color={t.c.ink2} />
      </Pressable>
      <Txt variant="screenTitle" style={{ flex: 1 }}>{copy.title}</Txt>
    </View>
    <Txt variant="body" color={t.c.ink2}>{copy.intro}</Txt>
    {guest && <View style={{ gap: 12 }}>
      <Txt variant="secondary" color={t.c.ink2}>{copy.guest}</Txt>
      <Button label={copy.login} onPress={() => router.push("/login")} />
    </View>}
    {visible.loading && <View style={styles.status}>
      <ActivityIndicator color={t.c.accent} />
      <Txt variant="secondary" color={t.c.ink2}>{copy.loading}</Txt>
    </View>}
    {visible.error && <View style={{ gap: 12 }}>
      <Txt variant="body" color={t.c.ink2}>{copy.offline}</Txt>
      <Button label={copy.tryAgain} variant="ghost" onPress={() => setAttempt((n) => n + 1)} />
    </View>}
    <View>
      {CHAPTER_IDS.map((id) => {
        const chapter = copy.chapter(id);
        const summary = visible.catalog?.chapters.find((item) => item.id === id);
        const available = guest || !!summary;
        const itemId = summary?.keepsake_id ?? `dojo_display_${id}`;
        const rewardLabel = copy.rewardLabel(dojoItemName(itemId, lang));
        return <Pressable key={id} disabled={!available} accessibilityRole="button"
          accessibilityLabel={`${chapter.title}. ${chapter.goal} ${summary ? copy.progress(summary) : copy.path}. ${rewardLabel}`}
          onPress={() => { if (isCurrentAccountScope(scope)) router.push({ pathname: "/chapter", params: { id } }); }}
          style={({ pressed }) => [styles.row, { borderColor: t.c.line, backgroundColor: pressed ? t.c.surface2 : "transparent", opacity: available ? 1 : 0.5 }]}>
          <View style={styles.art}><DojoItemArtwork itemId={itemId} size={74} /></View>
          <View style={{ flex: 1, gap: 6 }}>
            <Txt variant="cardTitle">{chapter.title}</Txt>
            <Txt variant="secondary" color={t.c.ink2}>{chapter.goal}</Txt>
            <Txt variant="caption" color={summary?.completed ? t.c.accent : t.c.ink3}>
              {summary ? copy.progress(summary) : copy.path}
            </Txt>
            <Txt variant="caption" color={t.c.ink3}>{rewardLabel}</Txt>
          </View>
          <Icon name={summary?.completed ? "check" : "chevron"} size={20} color={summary?.completed ? t.c.accent : t.c.ink3} />
        </Pressable>;
      })}
    </View>
  </Screen>;
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: -8 },
  back: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 24, borderBottomWidth: 1, minHeight: 112 },
  art: { width: 74, alignItems: "center", justifyContent: "center" },
  status: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12 },
});
