// Daily contracts card (engagement v2, Phase 2) — the daily-return + varied-earning hook on Home.
// Shows today's server-issued contracts with live progress; a completed one can be claimed for koku.
// Progress is counted server-side from the events pipeline, so this card just reflects + claims.
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import { claimContract, getContracts, type Contract } from "../../services/api";
import { trackContractClaimed } from "../../services/analytics";
import { useAuth } from "../../store/auth";
import { useI18n } from "../../store/i18n";
import { useWallet } from "../../store/wallet";
import { contractsSummary } from "../../store/contracts";
import { useTheme } from "../../theme/theme";
import Button from "./Button";
import Card from "./Card";
import ProgressBar from "./ProgressBar";
import Ring from "./Ring";
import Txt from "./Txt";

export default function ContractsCard() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { token } = useAuth();
  const { refresh: refreshWallet } = useWallet();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const c = await getContracts();
      setContracts(c.contracts);
    } catch {
      // offline / logged out / old backend — hide the card silently
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Progress is event-driven, so refresh whenever Home regains focus (e.g. after a session).
  useFocusEffect(useCallback(() => void load(), [load]));

  async function claim(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      const res = await claimContract(id);
      if (res.claimed) trackContractClaimed({ id, reward: res.reward });
      await refreshWallet(); // koku credited server-side
      await load();
    } catch {
      await load(); // 409 (not yet complete) → just resync progress
    } finally {
      setBusy(null);
    }
  }

  if (!token || contracts.length === 0) return null;

  const summary = contractsSummary(contracts);

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
        {/* Daily-goal ring — the at-a-glance "how close am I today" anchor. */}
        <Ring pct={summary.pct} size={52} stroke={6} color={summary.claimable ? t.c.gold : undefined}>
          <Txt variant="caption">{`${summary.done}/${summary.total}`}</Txt>
        </Ring>
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">{tr("contract.title")}</Txt>
          <Txt variant="secondary" color={t.c.ink2}>{tr("contract.sub")}</Txt>
        </View>
      </View>
      <View style={{ gap: 12 }}>
        {contracts.map((c) => (
          <View key={c.id} style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Txt variant="body" style={{ flex: 1 }}>
                {tr(`contract.${c.metric}` as never, { n: c.target })}
              </Txt>
              <Txt variant="caption" color={t.c.ink3}>{`${c.progress}/${c.target}`}</Txt>
            </View>
            <ProgressBar pct={c.target ? (100 * c.progress) / c.target : 0} />
            {c.claimed ? (
              <Txt variant="caption" color={t.c.ink3}>{tr("contract.claimed")}</Txt>
            ) : c.done ? (
              <Button
                label={busy === c.id ? tr("contract.claiming") : tr("contract.claim", { reward: c.reward })}
                onPress={() => claim(c.id)}
                disabled={busy !== null}
              />
            ) : null}
          </View>
        ))}
      </View>
    </Card>
  );
}
