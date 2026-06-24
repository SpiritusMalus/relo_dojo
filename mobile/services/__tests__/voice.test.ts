import {
  canServePronunciation,
  canUseVoice,
  gradeReadAloud,
  levenshtein,
  normalizePhrase,
  phraseSimilarity,
  pickLiveModel,
  READ_ALOUD_PASS,
  voiceFeatureEnabled,
} from "../voice";

describe("voice feature gating", () => {
  it("is OFF by default (no EXPO_PUBLIC_VOICE_ENABLED in the test env)", () => {
    expect(voiceFeatureEnabled()).toBe(false);
  });

  it("canUseVoice needs BOTH the flag and consent", () => {
    expect(canUseVoice(true, true)).toBe(true);
    expect(canUseVoice(true, false)).toBe(false);
    expect(canUseVoice(false, true)).toBe(false);
    expect(canUseVoice(false, false)).toBe(false);
  });

  it("canServePronunciation also needs the opt-in pref (default off)", () => {
    expect(canServePronunciation(true, true, true)).toBe(true);
    expect(canServePronunciation(true, true, false)).toBe(false);
    expect(canServePronunciation(true, true, undefined)).toBe(false);
    expect(canServePronunciation(false, true, true)).toBe(false); // flag off → never
    expect(canServePronunciation(true, false, true)).toBe(false); // no consent → never
  });
});

describe("normalizePhrase", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizePhrase("The   Cat, sat!")).toBe("the cat sat");
    expect(normalizePhrase("  Hello… World?? ")).toBe("hello world");
  });
});

describe("levenshtein", () => {
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("gradeReadAloud", () => {
  it("passes an exact (post-normalization) match", () => {
    const r = gradeReadAloud("I went to the shop.", "i went to the shop");
    expect(r.correct).toBe(true);
    expect(r.similarity).toBe(1);
  });

  it("is lenient about minor transcription noise", () => {
    const r = gradeReadAloud("I have been living here", "I have been living hear");
    expect(r.similarity).toBeGreaterThanOrEqual(READ_ALOUD_PASS);
    expect(r.correct).toBe(true);
  });

  it("fails a clearly different utterance", () => {
    const r = gradeReadAloud("I went to the shop", "completely different words here");
    expect(r.correct).toBe(false);
    expect(r.similarity).toBeLessThan(READ_ALOUD_PASS);
  });

  it("keeps similarity within [0,1]", () => {
    expect(phraseSimilarity("abc", "abc")).toBe(1);
    expect(phraseSimilarity("abc", "xyz")).toBeGreaterThanOrEqual(0);
    expect(phraseSimilarity("", "")).toBe(1);
  });
});

describe("pickLiveModel (resolve, don't hardcode)", () => {
  it("prefers a native-audio flash model", () => {
    const models = [
      "models/gemini-3.1-flash-lite",
      "models/gemini-2.5-flash-native-audio-preview-09-2025",
      "models/gemini-live-2.5-flash-preview",
    ];
    expect(pickLiveModel(models)).toBe("gemini-2.5-flash-native-audio-preview-09-2025");
  });

  it("falls back to a flash+live id when no native-audio model exists", () => {
    expect(pickLiveModel(["gemini-live-2.5-flash-preview", "gemini-3.1-flash-lite"])).toBe(
      "gemini-live-2.5-flash-preview"
    );
  });

  it("returns null when nothing qualifies (caller surfaces 'unavailable' rather than guessing)", () => {
    expect(pickLiveModel(["gemini-3.1-flash-lite", "gemini-2.5-pro"])).toBeNull();
    expect(pickLiveModel([])).toBeNull();
  });
});
