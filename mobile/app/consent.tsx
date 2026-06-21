import { Linking, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import { PD_CONSENT_VERSION, PRIVACY_URL, useConsent } from "../store/consent";
import Screen from "../components/ui/Screen";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Txt from "../components/ui/Txt";

// Standalone 152-ФЗ personal-data + cross-border consent. Two modes:
//   • gate (default)  — shown before onboarding when the current version isn't accepted; the only
//     way forward is "I agree", which records the version and lets RootNav continue.
//   • review (?review=1) — opened from Settings to re-read the text; no re-acceptance needed.
// It is deliberately its OWN screen, never folded into the Terms/оферта (01.09.2025 rule).
export default function ConsentScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  const { accept } = useConsent();
  const params = useLocalSearchParams<{ review?: string }>();
  const review = params.review === "1";

  async function onAgree() {
    await accept();
    router.replace("/"); // RootNav re-routes to onboarding or the tabs
  }

  function Clause({ label, body }: { label: string; body: string }) {
    return (
      <View style={{ gap: 4, marginBottom: 14 }}>
        <Txt variant="label">{label}</Txt>
        <Txt variant="body" color={t.c.ink2}>
          {body}
        </Txt>
      </View>
    );
  }

  return (
    <Screen contentStyle={{ paddingBottom: 32 }}>
      <Txt variant="screenTitle" style={{ marginTop: 8 }}>
        {tr("consent.title")}
      </Txt>
      <Txt variant="body" color={t.c.ink2} style={{ marginBottom: 4 }}>
        {tr("consent.intro")}
      </Txt>

      <Card>
        <Clause label={tr("consent.whoLabel")} body={tr("consent.who")} />
        <Clause label={tr("consent.whatLabel")} body={tr("consent.what")} />
        <Clause label={tr("consent.whyLabel")} body={tr("consent.why")} />
        <Clause label={tr("consent.crossLabel")} body={tr("consent.cross")} />
        <View style={{ gap: 4 }}>
          <Txt variant="label">{tr("consent.withdrawLabel")}</Txt>
          <Txt variant="body" color={t.c.ink2}>
            {tr("consent.withdraw")}
          </Txt>
        </View>
      </Card>

      <Txt variant="secondary" color={t.c.ink3}>
        {tr("consent.guardReminder")}
      </Txt>

      <Button
        label={tr("consent.privacyPolicy")}
        variant="ghost"
        uppercase={false}
        onPress={() => Linking.openURL(PRIVACY_URL)}
      />

      {review ? (
        <>
          <Txt variant="secondary" color={t.c.accent}>
            {tr("consent.acceptedNote", { v: PD_CONSENT_VERSION })}
          </Txt>
          <Button label={tr("consent.close")} uppercase={false} onPress={() => router.back()} />
        </>
      ) : (
        <Button label={tr("consent.agree")} onPress={onAgree} />
      )}
    </Screen>
  );
}
