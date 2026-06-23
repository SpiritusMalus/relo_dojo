# iOS without the App Store

**There is no fully store-free *local* iOS build the way Android has one.** Apple requires every
install on a device to be signed with an Apple-issued certificate + provisioning profile tied to a
device list. You cannot produce a self-signed, freely-distributable `.ipa` the way you sideload a
release APK. So unlike Android, iOS here is **documented only — no iOS code is built in this repo
task.**

App identity (consistent with Android): bundle id `com.relodojo.app`, scheme `relodojo`,
version `1.0.0`.

There are two real ways to get the app onto an iPhone outside the App Store:

## Path A — Apple Developer Program ($99/yr): ad-hoc / internal distribution

The practical "prod-like, no store" path. Build a signed `.ipa` and hand testers an install link;
no App Store review.

1. Enroll in the Apple Developer Program ($99/yr) → you get an **Apple Team ID**.
2. Register each test device's **UDID** in the developer portal (ad-hoc) — or use TestFlight
   internal testing (up to 100 testers, no UDID list, but goes through App Store Connect).
3. Fill the Apple ids in [`eas.json`](../eas.json) → `submit.production.ios`
   (`appleId`, `ascAppId`, `appleTeamId` — currently `REPLACE_WITH_*` placeholders).
4. Build the signed `.ipa` in the cloud (EAS manages the certs/profiles):
   ```bash
   eas build -p ios --profile preview
   ```
   `preview` is `distribution: internal`, which yields an install link / ad-hoc `.ipa`. There is no
   `--local` iOS equivalent of the Android APK that avoids Apple signing.
5. Testers open the install link on a registered device (or accept the TestFlight invite).

This needs the paid account and a Mac for any local signing work; the EAS cloud build does the
heavy lifting.

## Path B — Free Xcode personal team (7-day, on-device only)

No paid account. Xcode signs with your free **personal team**; the app installs on a device you own
but the signature **expires after 7 days** (reinstall to renew) and you can't distribute it to
others.

1. `npx expo prebuild -p ios --clean` (generates the ephemeral, gitignored `ios/`).
2. `open ios/relodojo.xcworkspace` in Xcode (Mac required).
3. Signing & Capabilities → select your personal Apple ID team → plug in the iPhone → Run.

Good for "does it run on my own phone" checks; not for handing builds to anyone else.

## Notes

- **Simulator builds are Mac-only** and don't run on physical hardware — not a distribution path.
- Both paths require a Mac. There is no Windows/Linux route to a signed iOS install.
- No iOS native code is built as part of the local-prod-build task; this file is the deliverable.
