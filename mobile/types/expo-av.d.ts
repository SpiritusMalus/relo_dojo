// Minimal ambient declaration for the slice of expo-av the voice modality uses. The package is
// declared in package.json and installed for app/owner builds; this keeps `tsc` resolving the import
// in environments where only the test toolchain is installed. The voice code is dormant unless
// EXPO_PUBLIC_VOICE_ENABLED=true, so nothing here is exercised by the jest suite.
declare module "expo-av" {
  export namespace Audio {
    function requestPermissionsAsync(): Promise<{ granted: boolean }>;
    function setAudioModeAsync(mode: { allowsRecordingIOS?: boolean; playsInSilentModeIOS?: boolean }): Promise<void>;

    interface RecordingOptions {
      [key: string]: unknown;
    }
    const RecordingOptionsPresets: { HIGH_QUALITY: RecordingOptions };

    class Recording {
      prepareToRecordAsync(options?: RecordingOptions): Promise<void>;
      startAsync(): Promise<void>;
      stopAndUnloadAsync(): Promise<void>;
      getURI(): string | null;
    }
  }
}
