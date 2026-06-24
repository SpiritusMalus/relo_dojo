// Microphone capture for read-aloud (mode a). Wraps expo-av so the rest of the app talks to a tiny
// interface. NEVER call these without passing the voice gate first (canUseVoice in services/voice +
// voice consent) — that enforcement lives at the call sites (practice screen). Imported only by the
// flag-gated voice UI, so it (and expo-av) stay out of the jest graph while the modality is dormant.
import { Audio } from "expo-av";

export type Utterance = { uri: string };

/** Ask for microphone permission (OS prompt). Returns true if granted. */
export async function requestMicPermission(): Promise<boolean> {
  const { granted } = await Audio.requestPermissionsAsync();
  return granted;
}

/** Start a recording. Caller stops it via the returned handle. Throws if permission is missing. */
export async function startRecording(): Promise<Audio.Recording> {
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const rec = new Audio.Recording();
  await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await rec.startAsync();
  return rec;
}

/** Stop a recording and return the local file URI of the captured audio. */
export async function stopRecording(rec: Audio.Recording): Promise<Utterance> {
  await rec.stopAndUnloadAsync();
  const uri = rec.getURI();
  if (!uri) throw new Error("No audio captured");
  return { uri };
}
