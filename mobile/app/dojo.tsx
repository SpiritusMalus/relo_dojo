import { useCallback, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import { useAuth } from "../store/auth";
import { useWallet } from "../store/wallet";
import { captureAccountScope, subscribeAccountScope, type AccountScope } from "../store/accountScope";
import { useDojoRoom } from "../store/dojoRoom";
import { dojoCopy, dojoDays, dojoItemName } from "../store/dojoRoomCopy";
import type { DojoCatalogItem, DojoSlot } from "../services/dojo";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import Txt from "../components/ui/Txt";
import DojoScene from "../components/ui/DojoScene";

const SLOTS: DojoSlot[] = ["dojo_light", "dojo_display", "dojo_plant"];

export default function DojoScreen() {
  const t = useTheme();
  const { lang } = useI18n();
  const copy = dojoCopy(lang);
  const { token } = useAuth();
  const wallet = useWallet();
  const room = useDojoRoom();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scope = useSyncExternalStore(subscribeAccountScope, captureAccountScope, captureAccountScope);
  const [selection, setSelection] = useState<{ scope: AccountScope; slot: DojoSlot; id: string | null } | null>(null);
  const slot = selection?.scope === scope ? selection.slot : "dojo_display";
  const previewId = selection?.scope === scope ? selection.id : null;
  const preview = room.catalog.find((item) => item.id === previewId);
  const shown = preview ? { ...room.equipped, [preview.slot]: preview.id } : room.equipped;
  const targetId = room.snapshot?.selected_target ?? room.nextMilestone?.itemId;
  const target = room.catalog.find((item) => item.id === targetId);
  const targetName = target ? dojoItemName(target.id, lang) : "";
  const chooseSlot = (next: DojoSlot) => setSelection({ scope, slot: next, id: null });
  const selectedItem = preview ?? room.catalog.find((item) => item.id === room.equipped[slot]);
  const guest = !token || scope.owner === "guest";
  const enabled = room.ready && !room.busy && !room.loading;

  useFocusEffect(useCallback(() => { void room.refresh(); }, [room.refresh]));

  async function commit(item: DojoCatalogItem) {
    if (!enabled) return;
    try {
      if (room.owned.includes(item.id) || item.gate === "starter") await room.equip(item.id);
      else if (item.gate === "buy") {
        await room.buy(item.id);
        // Separate, guarded existing equip API. A failed equip leaves the purchased item owned.
        await room.equip(item.id);
      } else await room.selectTarget(item.id);
    } catch { /* The provider reconciles uncertain writes and supplies a localized recovery state. */ }
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
          <DojoScene equipped={shown} accessibilityLabel={copy.title} />
          {preview && <Txt variant="caption" color={t.c.ink2}>{`${copy.selectedPreview}: ${dojoItemName(preview.id, lang)}`}</Txt>}
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
            <View style={{ flex: 1, gap: 4 }}>
              <Txt variant="secondary">{room.snapshot?.selected_target ? copy.selected : copy.target}</Txt>
              <Txt variant="cardTitle">{targetName}</Txt>
              <Txt variant="secondary" color={t.c.ink2}>
                {target.practice_days ? `${room.practiceDays ?? "—"} / ${dojoDays(target.practice_days, lang)}` : `${target.price} ${copy.koku}`}
              </Txt>
            </View>
            <ItemMark item={target} />
          </View>
        ) : room.snapshot && !room.loading ? (
          <View style={{ gap: 4 }}>
            <Txt variant="cardTitle">{copy.allEarned}</Txt>
          </View>
        ) : null}

        <Button label={copy.practice} onPress={() => router.push("/practice")} left={<Icon name="practice" color={t.c.accentInk} />} />
        {guest && <Button variant="ghost" label={copy.login} onPress={() => router.push("/login")} />}

        {room.catalog.length > 0 && <View style={{ gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Txt variant="cardTitle">{copy.collection}</Txt>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {SLOTS.map((itemSlot) => <Pressable key={itemSlot} accessibilityRole="tab" accessibilityState={{ selected: slot === itemSlot }}
              onPress={() => chooseSlot(itemSlot)} style={({ pressed }) => [styles.slot, { backgroundColor: slot === itemSlot ? t.c.accentSoft : pressed ? t.c.surface2 : t.c.surface, borderColor: slot === itemSlot ? t.c.accent : t.c.line2 }]}>
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
                <ItemMark item={item} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Txt variant="bodyStrong">{dojoItemName(item.id, lang)}</Txt>
                  <Txt variant="secondary">{placed ? copy.equipped : owned ? item.gate === "starter" ? copy.starter : item.gate === "achievement" ? copy.earned : copy.owned
                    : item.practice_days ? dojoDays(item.practice_days, lang) : `${item.price} ${copy.koku}`}</Txt>
                </View>
                {placed ? <Icon name="check" color={t.c.accent} /> : !owned ? <Icon name="lock" size={18} color={t.c.ink3} /> : null}
              </Pressable>;
            })}
          </View>
          {selectedItem && (() => {
            const item = selectedItem;
            const owned = item.gate === "starter" || room.owned.includes(item.id);
            const placed = room.equipped[slot] === item.id;
            const insufficient = item.gate === "buy" && !owned && wallet.ready && wallet.coins < item.price;
            const selectedTarget = room.snapshot?.selected_target === item.id;
            const label = room.busy ? copy.busy : placed ? copy.equipped : owned ? copy.equip
              : item.gate === "buy" ? `${copy.buy} ${item.price} ${copy.koku}` : selectedTarget ? copy.selected : copy.choose;
            return <View style={{ gap: 10 }}>
              {preview && !placed && <DojoScene equipped={shown} compact accessibilityLabel={`${copy.selectedPreview}: ${dojoItemName(item.id, lang)}`} />}
              <Button variant="ghost" label={label} onPress={() => void commit(item)}
                disabled={!enabled || placed || insufficient || (!owned && item.gate === "buy" && !wallet.ready) || (!owned && item.gate === "achievement" && selectedTarget)} />
              {!owned && item.gate === "achievement" && <Txt variant="secondary">{copy.daysHint}</Txt>}
              {insufficient && <Txt variant="secondary">{copy.insufficient}</Txt>}
              {!owned && item.gate === "buy" && !wallet.ready && <Txt variant="secondary">{copy.walletUnknown}</Txt>}
            </View>;
          })()}
        </View>}
        {room.error === "save" && <Txt variant="secondary" color={t.c.bad} accessibilityRole="alert">{copy.error}</Txt>}
        {room.snapshot?.receipts.map((receipt) => <View key={receipt.id} style={{ gap: 8, paddingVertical: 12, borderTopWidth: 1, borderColor: t.c.line }}>
          <Txt variant="secondary">{copy.welcome}</Txt>
          <Txt variant="bodyStrong">{dojoItemName(receipt.item_id, lang)}</Txt>
          <Button variant="ghost" label={copy.close} disabled={!enabled} onPress={() => void room.acknowledge(receipt.id).catch(() => {})} />
        </View>)}
      </ScrollView>
    </View>
  );
}

function ItemMark({ item }: { item: DojoCatalogItem }) {
  const { c } = useTheme();
  return <View accessible={false} style={{ width: 54, height: 54, alignItems: "center", justifyContent: "center" }}>
    <Svg width="48" height="48" viewBox="0 0 48 48">
      {item.slot === "dojo_display" ? <>
        <Rect x="12" y="7" width="25" height="32" fill={c.surface} stroke={c.line2} strokeWidth="1.5" />
        <Path d="M10 7H39M10 39H39" stroke={c.ink2} strokeWidth="3" strokeLinecap="round" />
        {item.id === "dojo_display_first_scroll" && <Path d="M18 23L22 27L31 17M19 32H30" fill="none" stroke={c.accent} strokeWidth="2.5" strokeLinecap="round" />}
        {item.id === "dojo_display_wave" && <Path d="M16 29C20 16 25 31 29 20C31 16 35 18 33 22M16 34C23 28 28 38 34 30" fill="none" stroke={c.accent} strokeWidth="2.5" strokeLinecap="round" />}
      </> : item.slot === "dojo_plant" ? <>
        <Path d="M14 31H35L31 41H18Z" fill={c.fireSoft} stroke={c.fire} strokeWidth="1.5" />
        <Path d={item.id === "dojo_plant_bamboo" ? "M23 31V8M29 31V17M23 20C15 21 13 13 13 13C20 12 23 20 23 20ZM24 14C24 7 34 7 34 7C32 14 24 14 24 14ZM29 25C30 18 39 19 39 19C37 25 29 25 29 25Z" : "M24 31V21M24 24C16 25 13 18 13 18C20 16 24 24 24 24ZM24 21C24 12 33 12 33 12C35 19 24 21 24 21Z"} fill={c.accent} stroke={c.accent} strokeWidth="2" strokeLinecap="round" />
      </> : <>
        <Path d="M24 3V11M18 40H30M24 40V45" stroke={c.ink2} strokeWidth="2" strokeLinecap="round" />
        <Rect x="11" y="12" width="26" height="27" rx={item.id === "dojo_light_lantern" ? 8 : 2} fill={item.id === "dojo_light_paper" ? c.surface2 : c.fireSoft} stroke={item.id === "dojo_light_paper" ? c.line2 : c.gold} strokeWidth="2" />
        <Path d="M12 21H36M12 30H36M20 13V38M28 13V38" stroke={item.id === "dojo_light_paper" ? c.line2 : c.gold} strokeWidth="1.3" />
        {item.id === "dojo_light_sunset" && <Circle cx="24" cy="25" r="5" fill={c.fire} />}
      </>}
    </Svg>
  </View>;
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, minHeight: 48 },
  back: { minWidth: 48, minHeight: 48, justifyContent: "center", alignItems: "center" },
  target: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1 },
  slot: { flex: 1, minHeight: 48, justifyContent: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 12 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 6, borderBottomWidth: 1, borderRadius: 8 },
});
