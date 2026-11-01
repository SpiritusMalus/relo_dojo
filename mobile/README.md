# Relo Dojo mobile

Expo SDK 54 / React Native / TypeScript. The current native app version is **1.1.0**,
Android version code **2**. Package/bundle ID: `com.relodojo.app`; scheme `relodojo`.
The Node package version is independent of the native app version in `app.json`.
Generated `android/` and `ios/` projects are ignored; `expo prebuild` recreates them.

## Development and verification

```sh
npm ci
npx expo start
npx tsc --noEmit
npm test -- --runInBand
```

Expo Go must match SDK 54. The API client infers a development backend from the
Expo host; `EXPO_PUBLIC_API_URL` takes precedence. A standalone build must receive
its intended URL at bundle time. Never place server credentials in `EXPO_PUBLIC_*`.

## Internal Android APK

The manual [Android workflow](../.github/workflows/android-apk.yml) uses JDK 17,
Expo prebuild and Gradle on GitHub. Its default URL is
`https://relo.family-pie.ru`; voice defaults off. The generated release variant
uses the Expo template's **debug signing key** unless managed signing is explicitly
configured. It is suitable for internal sideload testing, not a store-signed release.
No EAS quota or payment is required for that workflow.

For a local build, install JDK 17 and the Android SDK, set `JAVA_HOME` and
`ANDROID_HOME`, then run from `mobile/`:

```sh
npx expo prebuild --platform android --no-install
python3 scripts/android-qa-network.py production
NODE_ENV=production EXPO_PUBLIC_API_URL=https://relo.family-pie.ru \
  android/gradlew -p android assembleRelease --no-daemon
```

The APK is `android/app/build/outputs/apk/release/app-release.apk`. When switching
API environments, invalidate the generated JS bundle and verify the URL in the
resulting APK; an environment change alone may leave a cached bundle. Check native
version, signature, SHA-256 and a real generate/check/restart path before delivery.
An emulator pass does not establish physical-device or iOS behavior.

For internal QA only, `python3 scripts/android-qa-network.py qa` permits HTTP solely
to `127.0.0.1` while denying other cleartext traffic. Use an explicit loopback API
URL and an adb/SSH reverse tunnel to an isolated sandbox. Run `production` before
the HTTPS artifact and verify its compiled manifest has no QA security config.
The script refuses to overwrite an unfamiliar network-security configuration.

## Signing and iOS

EAS profiles and the existing credential templates remain available for managed
signing. Keep keystores/passwords out of Git. Google sign-in requires the fingerprint
of the actual signing key to be registered in its Android OAuth client; email auth
and an installable APK do not prove Google OAuth works.

For iOS development/signing constraints see [the existing notes](docs/ios-store-free.md).
The Android test release does not claim an iOS/TestFlight build or acceptance.

## Design assets

`assets/brand-mark.svg` preserves the existing torii/gold-step identity. The icon
rasters and provenance are in `assets/brand-assets.json`; the optional local export
script is `scripts/export-brand-assets.cjs`. Design direction and native tokens are
recorded in [DESIGN.md](../DESIGN.md).
