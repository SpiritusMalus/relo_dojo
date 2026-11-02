import { useCallback, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import { useAuth } from "../store/auth";
import { useWallet } from "../store/wallet";
import { captureAccountScope, isCurrentAccountScope, subscribeAccountScope, type AccountScope } from "../store/accountScope";
import { useDojoRoom } from "../store/dojoRoom";
import { dojoCopy, dojoDays, dojoItemName, dojoItemChapter, dojoChapterReward } from "../store/dojoRoomCopy";
import type { DojoCatalogItem, DojoSlot } from "../services/dojo";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import Txt from "../components/ui/Txt";
import DojoScene from "../components/ui/DojoScene";
import DojoItemArtwork from "../components/ui/DojoItemArtwork";
import ProgressBar from "../components/ui/ProgressBar";

const SLOTS: DojoSlot[] = ["dojo_light", "dojo_display", "dojo_plant"];

export default function DojoScreen() {
  const t = useTheme();
  const { lang } = useI18n();
  const copy = dojoCopy(lang);
  const { token } = useAuth();
  const wallet = useWallet();
  const room = useDojoRoom();
  const router = useRouter();
  const params = useLocalSearchParams<{ reward?: string; epoch?: string }>();
  const insets = useSafeAreaInsets();
  const scope = useSyncExternalStore(subscribeAccountScope, captureAccountScope, captureAccountScope);
  const [selection, setSelection] = useState<{ scope: AccountScope; slot: DojoSlot; id: string | null } | null>(null);
  // A completion link is a preview request, never an ownership or equip command.
  // Its epoch fences navigation that was opened before the account changed.
  const requestedReward = typeof params.reward === "string" && params.epoch === String(scope.epoch)
    ? room.catalog.find((item) => item.id === params.reward && !!dojoItemChapter(item.id) && room.owned.includes(item.id))
    : undefined;
  const localSelection = selection?.scope === scope ? selection : null;
  const rewardEntry = !!requestedReward && !localSelection;
  const slot = localSelection?.slot ?? requestedReward?.slot ?? "dojo_display";
  const previewId = localSelection ? localSelection.id : requestedReward?.id ?? null;
  const preview = room.catalog.find((item) => item.id === previewId);
  const shown = preview ? { ...room.equipped, [preview.slot]: preview.id } : room.equipped;
  const targetId = room.snapshot?.selected_target ?? room.nextMilestone?.itemId;
  const target = room.catalog.find((item) => item.id === targetId);
  const targetName = target ? dojoItemName(target.id, lang) : "";
  const chooseSlot = (next: DojoSlot) => setSelection({ scope, slot: next, id: null });
  const selectedItem = preview ?? room.catalog.find((item) => item.id === room.equipped[slot]);
  const guest = !token || !scope.owner || scope.owner === "guest";
  const enabled = room.ready && !room.busy && !room.loading;

  useFocusEffect(useCallback(() => { void room.refresh(); }, [room.refresh]));

  async function commit(item: DojoCatalogItem) {
    if (!enabled || !isCurrentAccountScope(scope)) return;
    const chapter = dojoItemChapter(item.id);
    if (chapter && !room.owned.includes(item.id)) {
      router.push({ pathname: "/chapter", params: { id: chapter.id } });
      return;
    }
    try {
      if (room.owned.includes(item.id) || item.gate === "starter") await room.equip(item.id);
      else if (item.gate === "buy") {
        await room.buy(item.id);
        // Separate, guarded existing equip API. A failed equip leaves the purchased item owned.
        await room.equip(item.id);
      } else await room.selectTarget(item.id);
    } catch { /* The provider reconciles uncertain writes and supplies a localized recovery state. */ }
  }

  function itemAction(item: DojoCatalogItem, showPreview: boolean) {
    const owned = item.gate === "starter" || room.owned.includes(item.id);
    const placed = room.equipped[item.slot] === item.id;
    const insufficient = item.gate === "buy" && !owned && wallet.ready && wallet.coins < item.price;
    const selectedTarget = room.snapshot?.selected_target === item.id;
    const chapter = dojoItemChapter(item.id);
    const label = room.busy ? copy.busy : placed ? copy.equipped : owned ? copy.equip
      : chapter ? copy.openChapter : item.gate === "buy" ? `${copy.buy} ${item.price} ${copy.koku}` : selectedTarget ? copy.selected : copy.choose;
    return <View style={{ gap: 10 }}>
      {showPreview && preview && !placed && <DojoScene equipped={shown} compact accessibilityLabel={`${copy.selectedPreview}: ${dojoItemName(item.id, lang)}`} />}
      <Button variant="ghost" label={label} onPress={() => void commit(item)}
        disabled={!enabled || placed || insufficient || (!owned && item.gate === "buy" && !wallet.ready) || (!owned && item.gate === "achievement" && selectedTarget && !chapter)} />
      {insufficient && <Txt variant="secondary">{copy.insufficient}</Txt>}
      {!owned && item.gate === "buy" && !wallet.ready && <Txt variant="secondary">{copy.walletUnknown}</Txt>}
      {room.error === "save" && <Txt variant="secondary" color={t.c.bad} accessibilityRole="alert">{copy.error}</Txt>}
    </View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top + 8 }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel={copy.back} accessibilityRole="button"
          style={({ pressed }) => [styles.back, { backgroundColor: pressed ? t.c.surface2 : "transparent", borderRadius: 12 }]}>
          <Icon name="back" color={t.c.ink2} />
        </Pressable>
        <Txt variant="screenTitle" style={{ flex: 1 }}>{copy.title}</Txt>
        <Txt variant="secondary" color={t.c.gold} style={{ flexShrink: 1, textAlign: "right" }}>
          {wallet.ready ? `${wallet.coins} ${copy.koku}` : copy.emptyBalance}
        </Txt>
      </View>
      <ScrollView contentContainerStyle={{ padding: t.spacing.pad, paddingTop: 12, paddingBottom: insets.bottom + 28, gap: 20 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 8 }}>
          <View style={{ marginHorizontal: -t.spacing.pad }}>
            <DojoScene equipped={shown} accessibilityLabel={copy.title} />
          </View>
          {preview && <Txt variant="secondary" color={t.c.ink2}>{`${copy.selectedPreview}: ${dojoItemName(preview.id, lang)}`}</Txt>}
          {rewardEntry && selectedItem && itemAction(selectedItem, false)}
        </View>

        {room.loading && !room.snapshot ? <ActivityIndicator color={t.c.accent} accessibilityLabel={copy.uncertain} /> : null}
        {guest ? (
          <View style={{ gap: 8 }}>
            <Txt variant="secondary">{copy.guest}</Txt>
          </View>
        ) : room.source !== "server" && !room.loading ? (
          <View style={{ gap: 10 }}>
            <Txt variant="secondary">{room.source === "cache" ? copy.offline : copy.unavailable}</Txt>
            <Button variant="ghost" label={copy.retry} onPress={() => void room.refresh()} disabled={room.loading} />
          </View>
        ) : null}

        {target ? (
          <View style={[styles.target, { borderColor: t.c.line }]}>
            <DojoItemArtwork itemId={target.id} size={76} />
            <View style={{ flex: 1, gap: 5 }}>
              <Txt variant="cardTitle">{targetName}</Txt>
              <Txt variant="secondary" color={t.c.ink2}>
                {dojoChapterReward(target.id, lang) ?? (target.practice_days ? `${room.practiceDays ?? "—"} / ${dojoDays(target.practice_days, lang)}` : `${target.price} ${copy.koku}`)}
              </Txt>
              {target.practice_days && room.practiceDays !== null
                ? <ProgressBar pct={room.practiceDays / target.practice_days * 100} height={5} />
                : null}
              {room.snapshot?.selected_target && <Txt variant="caption" color={t.c.accent}>{copy.selected}</Txt>}
            </View>
          </View>
        ) : room.snapshot && !room.loading ? (
          <View style={{ gap: 4 }}>
            <Txt variant="cardTitle">{copy.allEarned}</Txt>
          </View>
        ) : null}

        <Button label={copy.practice} onPress={() => router.push("/practice")} left={<Icon name="practice" color={t.c.accentInk} />} />
        <Button variant="ghost" label={copy.chapters} onPress={() => router.push("/chapters")} left={<Icon name="scroll" color={t.c.accent} />} />
        {guest && <Button variant="ghost" label={copy.login} onPress={() => router.push("/login")} />}

        {room.catalog.length > 0 && <View style={{ gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Txt variant="cardTitle">{copy.collection}</Txt>
          </View>
          <View style={[styles.slots, { backgroundColor: t.c.surface2 }]}>
            {SLOTS.map((itemSlot) => <Pressable key={itemSlot} accessibilityRole="tab" accessibilityState={{ selected: slot === itemSlot }}
              onPress={() => chooseSlot(itemSlot)} style={({ pressed }) => [styles.slot, { backgroundColor: slot === itemSlot ? t.c.surface : pressed ? t.c.accentSoft : "transparent" }]}>
              <Txt variant="bodyStrong" color={slot === itemSlot ? t.c.accent : t.c.ink2} style={{ textAlign: "center", flexShrink: 1 }}>
                {itemSlot === "dojo_light" ? copy.light : itemSlot === "dojo_display" ? copy.display : copy.plant}
              </Txt>
            </Pressable>)}
          </View>
          <View>
            {room.catalog.filter((item) => item.slot === slot).map((item) => {
              const owned = item.gate === "starter" || room.owned.includes(item.id);
              const placed = room.equipped[slot] === item.id;
              const selected = selectedItem?.id === item.id;
              return <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected }}
                accessibilityLabel={`${dojoItemName(item.id, lang)}${placed ? `, ${copy.equipped}` : ""}`}
                onPress={() => setSelection({ scope, slot, id: item.id })}
                style={({ pressed }) => [styles.item, { borderColor: t.c.line, backgroundColor: selected ? t.c.accentSoft : pressed ? t.c.surface2 : "transparent" }]}>
                <DojoItemArtwork itemId={item.id} size={70} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt variant="bodyStrong">{dojoItemName(item.id, lang)}</Txt>
                  <Txt variant="secondary">{placed ? copy.equipped : dojoChapterReward(item.id, lang) ?? (owned ? item.gate === "starter" ? copy.starter : item.gate === "achievement" ? copy.earned : copy.owned
                    : item.practice_days ? dojoDays(item.practice_days, lang) : `${item.price} ${copy.koku}`)}</Txt>
                </View>
                {placed ? <Icon name="check" color={t.c.accent} /> : !owned ? <Icon name="lock" size={18} color={t.c.ink3} /> : null}
              </Pressable>;
            })}
          </View>
          {!rewardEntry && selectedItem && itemAction(selectedItem, true)}
        </View>}
        {room.error === "save" && !selectedItem && <Txt variant="secondary" color={t.c.bad} accessibilityRole="alert">{copy.error}</Txt>}
        {room.snapshot?.receipts.map((receipt) => <View key={receipt.id} style={{ gap: 8, paddingVertical: 12, borderTopWidth: 1, borderColor: t.c.line }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <DojoItemArtwork itemId={receipt.item_id} size={76} />
            <View style={{ flex: 1, gap: 4 }}>
              <Txt variant="secondary">{copy.welcome}</Txt>
              <Txt variant="bodyStrong">{dojoItemName(receipt.item_id, lang)}</Txt>
            </View>
          </View>
          <Button variant="ghost" label={copy.close} disabled={!enabled} onPress={() => void room.acknowledge(receipt.id).catch(() => {})} />
        </View>)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, minHeight: 48 },
  back: { minWidth: 48, minHeight: 48, justifyContent: "center", alignItems: "center" },
  target: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1 },
  slots: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 14 },
  slot: { flex: 1, minHeight: 48, justifyContent: "center", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 10 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderRadius: 12 },
});
