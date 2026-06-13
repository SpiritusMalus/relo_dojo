import { useEffect, useState } from "react";
import { View } from "react-native";
import { trackStreakBreak } from "../../services/analytics";
import { useI18n } from "../../store/i18n";
import { useProgress } from "../../store/progress";
import { useWallet } from "../../store/wallet";
import { repairOpen, repairPrice } from "../../store/streak";
import { useTheme } from "../../theme/theme";
import type { Belt } from "../../theme/theme";
import Button from "./Button";
import Card from "./Card";
import Sensei from "./Sensei";
import Txt from "./Txt";

// The loss-aversion moment (monetization branch 3): a streak the user grew for days has just
// snapped. Shown on Home while the repair window is open. Sensei is sad — the user did this, and
// the user can undo it for koku ("отработка у Сэнсэя"); the price grew with the streak they lost.
export default function StreakRepairSheet({ belt }: { belt: Belt }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { progress, repairStreak, dismissBrokenStreak } = useProgress();
  const { coins } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const broken = progress.brokenStreak;
  const visible = !!broken && repairOpen(broken, new Date());

  // The streak snapped and the repair window is open — fire once per broken streak length.
  useEffect(() => {
    if (visible && broken) trackStreakBreak({ streak: broken.streak });
  }, [visible, broken?.streak]);

  if (!visible || !broken) return null;

  const price = repairPrice(broken.streak);
  const canAfford = coins >= price;

  async function repair() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await repairStreak();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Repair failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <View style={{ alignItems: "center", gap: 10, paddingVertical: 6 }}>
        <Sensei belt={belt} size={84} mood="sad" />
        <Txt variant="bodyStrong" style={{ textAlign: "center" }}>
          {tr("streak.brokenTitle", { n: broken.streak })}
        </Txt>
        <Txt variant="secondary" color={t.c.ink2} style={{ textAlign: "center" }}>
          {tr("streak.brokenSub")}
        </Txt>

        <View style={{ alignSelf: "stretch", gap: 8, marginTop: 6 }}>
          <Button
            label={busy ? tr("streak.repairing") : tr("streak.repair", { price })}
            onPress={repair}
            disabled={!canAfford || busy}
          />
          {!canAfford && (
            <Txt variant="caption" color={t.c.ink3} style={{ textAlign: "center" }}>
              {tr("limit.notEnough", { coins })}
            </Txt>
          )}
          <Button label={tr("streak.letGo")} variant="ghost" onPress={dismissBrokenStreak} disabled={busy} />
        </View>

        {error && (
          <Txt variant="caption" color={t.c.bad} style={{ textAlign: "center" }}>
            {error}
          </Txt>
        )}
      </View>
    </Card>
  );
}
