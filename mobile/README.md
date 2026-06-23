# Relo Dojo — mobile (Expo)

Managed Expo / React Native app. Ids are fixed across all build paths:

| | value |
|---|---|
| Android package | `com.relodojo.app` |
| iOS bundle id | `com.relodojo.app` |
| URL scheme | `relodojo` |
| Expo slug | `relo-dojo` |
| version | `1.0.0` |

No `android/` or `ios/` folders are committed — this is the **managed** workflow. Native projects
are generated on demand by `expo prebuild` (or inside `eas build --local`) and stay out of git
(see [`.gitignore`](.gitignore)).

## Dev

```bash
npm install
npm start            # Metro; press a / i / w for android / ios / web
npm test             # jest
npx tsc --noEmit     # types
```

The API client ([`services/api.ts`](services/api.ts)) auto-derives the backend URL from the Expo
dev host (LAN IP, port 8000) so a phone on the same Wi-Fi reaches your Mac with no config.
`EXPO_PUBLIC_API_URL` overrides it — that override is how the prod build below points at the real
backend.

---

## Production build (sideload, no store)

Produces a **release-signed, prod-config APK** that installs on a physical Android device
**without Google Play**. It mirrors production (release build, Hermes, minify, prod backend) but is
distributed by sideload — for owner/internal device testing, not store distribution.

Both paths use the **`prod-apk`** profile in [`eas.json`](eas.json): it extends `production` but
flips to `distribution: internal` + `android.buildType: apk` and sets
`EXPO_PUBLIC_API_URL=https://relo.family-pie.ru` so the build talks to the **real prod backend**.
`EXPO_PUBLIC_GOOGLE_CLIENT_ID` is read from your local `mobile/.env`.

> iOS has no store-free build path (Apple signing). See
> [`docs/ios-store-free.md`](docs/ios-store-free.md).

### Path A — Cloud build with EAS (recommended)

Builds on Expo's servers — **no local JDK or Android SDK needed**. Expo generates and stores the
release keystore for you (managed credentials).

```bash
npm i -g eas-cli
eas login                 # once, with the Expo account that owns the project
cd mobile
eas init                  # once — links the project (writes extra.eas.projectId to app.json)
eas build -p android --profile prod-apk
```

The CLI prints a build URL and, on success, a link/QR for the APK. Open that link **on the Android
phone's browser** and install the APK directly — no cable, no `adb`. (Or `adb install -r <file>.apk`
if you download it to the Mac.)

Get the **release keystore SHA-1** for Google sign-in (see the gotcha below):

```bash
eas credentials -p android        # → Keystore → shows SHA-1 / SHA-256 fingerprints
```

### Path B — Fully local build (no Expo cloud)

Use this only if you want zero cloud dependency. Requires the full local toolchain.

**Prereqs (Mac):** **JDK 17** (`brew install --cask zulu@17`), **Android SDK**
(`brew install --cask android-commandlinetools`, then
`sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"` and
`yes | sdkmanager --licenses`; export `ANDROID_HOME="$HOME/Library/Android/sdk"`), **EAS CLI**
(`npm i -g eas-cli`), and a **physical device** with USB debugging (`adb devices`).

1. **Create the release keystore** (once — a secret, kept OUT of git; back it up):
   ```bash
   cd mobile && mkdir -p credentials
   keytool -genkeypair -v \
     -keystore credentials/relodojo-release.keystore \
     -alias relodojo -keyalg RSA -keysize 2048 -validity 10000 \
     -storepass <STOREPASS> -keypass <KEYPASS> \
     -dname "CN=Relo Dojo, OU=Mobile, O=Relo Dojo, L=, S=, C=RU"
   keytool -list -v -keystore credentials/relodojo-release.keystore -alias relodojo \
     -storepass <STOREPASS> | grep -E "SHA1:|SHA256:"      # SHA-1 for Google sign-in
   ```
2. **Wire credentials:** `cp credentials.example.json credentials.json` and fill the passwords/alias.
   `credentials.json` + `*.keystore` are gitignored; only [`credentials.example.json`](credentials.example.json)
   and the `prod-apk` profile are committed.
3. **Build locally:** `eas build --local --profile prod-apk --platform android` → `build-<ts>.apk` in
   `mobile/`. (Alt: `npx expo prebuild -p android --clean` then `cd android && ./gradlew assembleRelease`;
   the generated `android/` is ephemeral and gitignored.)
4. **Install:** `adb install -r build-<ts>.apk && adb shell monkey -p com.relodojo.app 1`.

### ⚠️ Google sign-in needs the release SHA-1 registered (owner step)

Google validates the app's signing fingerprint. A **release-signed APK has a different SHA-1 than
the debug build**, so sign-in fails until the **release keystore SHA-1** (cloud: `eas credentials`;
local: the `keytool -list` above) is added to the Android OAuth client in Google Cloud Console
(APIs & Services → Credentials → the Android client for `com.relodojo.app`). Do this before relying
on login in the sideloaded build.
