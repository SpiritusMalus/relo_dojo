// Cross-border personal-data consent store (152-ФЗ).
//
// The text a learner enters (exercise answers, the "review my text" paste, the free-text goal) is
// sent to Google LLC's Gemini model in the USA for grading/generation — a cross-border transfer of
// personal data. Russian law (with the 01.09.2025 rule) requires a SEPARATE, specific consent for
// that, presented on its own — never bundled into the оферта/Terms. This store gates the app on that
// consent and records the accepted version.
//
// Persistence is two-layered: the accepted version is held locally (AsyncStorage) so the gate works
// for anonymous users too, and — when signed in — pushed to the backend (POST /auth/consent) as the
// provable audit trail. Bumping PD_CONSENT_VERSION re-shows the screen to everyone.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { recordConsent } from "../services/api";

// Current consent document version. Bump on any material change to what/where/why data is sent.
export const PD_CONSENT_VERSION = "pd-2026-06";
// Hosted legal docs on the studio's central host (family-pie mirrors legal/PRIVACY_POLICY.md +
// TERMS_OF_USE.md). Linked from the consent screen and Settings. Конфиденциальность = Privacy,
// Оферта = Terms.
export const PRIVACY_URL = "https://family-pie.ru/relo_dojo/privacy";
export const TERMS_URL = "https://family-pie.ru/relo_dojo/terms";
const STORAGE_KEY = "relo_dojo/consent/pd/v1";

type ConsentCtx = {
  ready: boolean; // false until the stored version has been read
  accepted: boolean; // true once the CURRENT version is accepted
  accept: () => Promise<void>;
};

const Context = createContext<ConsentCtx | null>(null);

// Best-effort server replay of the locally-stored consent (called after sign-in, when the bearer
// token finally exists). No-ops silently when nothing is stored or the request fails — the local
// flag is what gates the UI; this only strengthens the server audit trail.
export async function syncConsentToServer(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    if (v === PD_CONSENT_VERSION) await recordConsent(v);
  } catch {
    // best-effort
  }
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => active && setAccepted(v === PD_CONSENT_VERSION))
      .catch(() => {})
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, []);

  const accept = useCallback(async () => {
    setAccepted(true);
    await AsyncStorage.setItem(STORAGE_KEY, PD_CONSENT_VERSION).catch(() => {});
    // Audit trail for signed-in users; 401 for anonymous is caught and replayed after sign-in.
    recordConsent(PD_CONSENT_VERSION).catch(() => {});
  }, []);

  return <Context.Provider value={{ ready, accepted, accept }}>{children}</Context.Provider>;
}

export function useConsent(): ConsentCtx {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useConsent must be used within ConsentProvider");
  return ctx;
}
