// Separate, specific VOICE consent (152-ФЗ) — distinct from the text consent (store/consent).
//
// Pronunciation practice captures microphone audio and sends it to Google LLC's Gemini (USA) — a
// cross-border transfer of a NEW data category (voice) that the text consent does not cover. Russian
// law requires its own specific consent for it, presented on its own. This store gates every audio
// capture / Live session and records the accepted version (local + server audit trail).
//
// NB: the legally-reviewed wording + the RKN audio-category amendment are the owner's gate (brief
// voice-direction steps 1–4). This store is the CODE mechanism the enforcement (step 8) needs; the
// copy in i18n is a draft pending legal sign-off and the gate stays inert while VOICE_ENABLED=false.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { recordConsent } from "../services/api";

// Bump on any material change to what voice data is captured / where it goes.
export const VOICE_CONSENT_VERSION = "voice-2026-06";
const STORAGE_KEY = "relo_dojo/consent/voice/v1";

type VoiceConsentCtx = {
  ready: boolean; // false until the stored version has been read
  granted: boolean; // true once the CURRENT version is accepted
  accept: () => Promise<void>;
  revoke: () => Promise<void>;
};

const Context = createContext<VoiceConsentCtx | null>(null);

/** Best-effort server replay of the locally-stored voice consent (called after sign-in). */
export async function syncVoiceConsentToServer(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    if (v === VOICE_CONSENT_VERSION) await recordConsent(v);
  } catch {
    // best-effort; the local flag gates the UI
  }
}

export function VoiceConsentProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => active && setGranted(v === VOICE_CONSENT_VERSION))
      .catch(() => {})
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, []);

  const accept = useCallback(async () => {
    setGranted(true);
    await AsyncStorage.setItem(STORAGE_KEY, VOICE_CONSENT_VERSION).catch(() => {});
    recordConsent(VOICE_CONSENT_VERSION).catch(() => {});
  }, []);

  const revoke = useCallback(async () => {
    setGranted(false);
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, []);

  return <Context.Provider value={{ ready, granted, accept, revoke }}>{children}</Context.Provider>;
}

export function useVoiceConsent(): VoiceConsentCtx {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useVoiceConsent must be used within VoiceConsentProvider");
  return ctx;
}
