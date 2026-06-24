// Voice direction — pure logic + feature gating (no native/audio imports → unit-testable, safe to
// import anywhere). Pronunciation is an OPT-IN modality, OFF by default and double-gated:
//   1. EXPO_PUBLIC_VOICE_ENABLED (build flag) — default false. While false, NO audio is captured and
//      NO Gemini Live session opens, so this code is inert and safe to ship before the legal gate.
//   2. A separate, specific voice consent (store/voiceConsent) — audio crosses the border to Google
//      (USA), which needs its own 152-ФЗ consent distinct from the text one.
// Prod enable is the owner's call, only after the RKN audio-category amendment + voice consent land.

// --- Feature flag ------------------------------------------------------------

/** Build-time voice flag. Default OFF — the whole modality is dormant until owner flips it post-legal. */
export const VOICE_ENABLED = (process.env.EXPO_PUBLIC_VOICE_ENABLED ?? "") === "true";

export function voiceFeatureEnabled(): boolean {
  return VOICE_ENABLED;
}

/** The single gate every capture / Live session must pass: build flag AND voice consent granted.
 *  Pure so it can be unit-tested and reused by the UI and the capture/Live services alike. */
export function canUseVoice(flag: boolean, consentGranted: boolean): boolean {
  return flag && consentGranted;
}

/** Whether the pronunciation modality may actually be served: the voice gate AND the learner's
 *  opt-in format pref (steering.formatPrefs.pronunciation, default off). Pure. */
export function canServePronunciation(flag: boolean, consentGranted: boolean, pref: boolean | undefined): boolean {
  return canUseVoice(flag, consentGranted) && pref === true;
}

// --- Read-aloud grading (mode a) ---------------------------------------------
// Binary "did you say it right" — a lenient nudge, NOT a calibrated phoneme score and NOT a
// progression gate (owner decision: no Azure/Speechace). We normalize both sides and accept a high
// similarity so minor transcription noise / filler doesn't fail an honest attempt.

export const READ_ALOUD_PASS = 0.8; // similarity at/above which a read-aloud counts as correct

/** Lowercase, strip punctuation, collapse whitespace — so "The cat, sat." ≈ "the cat sat". */
export function normalizePhrase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein edit distance (character-level). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      cur.push(Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + cost));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Similarity in [0,1] between two phrases after normalization (1 = identical). */
export function phraseSimilarity(target: string, said: string): number {
  const a = normalizePhrase(target);
  const b = normalizePhrase(said);
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

export type ReadAloudResult = { correct: boolean; similarity: number };

/** Grade a read-aloud attempt: binary correct/try-again with the underlying similarity (for copy). */
export function gradeReadAloud(target: string, transcript: string, pass = READ_ALOUD_PASS): ReadAloudResult {
  const similarity = phraseSimilarity(target, transcript);
  return { correct: similarity >= pass, similarity };
}

// --- Gemini Live model resolution (mode b) -----------------------------------
// Mirror the backend llm.py rule: resolve the model id from the live list, never hardcode a guess.
// We want a native-audio *flash* *live* model (realtime two-way voice).

export const GEMINI_LIVE_WSS =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

/** Pick the best native-audio flash-live model from a model-list response. Prefers explicit
 *  native-audio, then a flash+live id; returns null when none qualifies (caller surfaces a clear
 *  "voice unavailable" rather than calling a guessed id). Accepts bare ids or "models/<id>" forms. */
export function pickLiveModel(models: string[]): string | null {
  const norm = (m: string) => m.replace(/^models\//, "");
  const ids = models.map(norm);
  const isFlash = (m: string) => /flash/i.test(m);
  const isLive = (m: string) => /live|native-audio/i.test(m);
  const candidates = ids.filter((m) => isFlash(m) && isLive(m));
  if (candidates.length === 0) return null;
  // Prefer native-audio (true realtime voice) over plain live, then shorter/stabler ids.
  candidates.sort((a, b) => {
    const score = (m: string) => (/native-audio/i.test(m) ? 0 : 1);
    return score(a) - score(b) || a.length - b.length;
  });
  return candidates[0];
}
