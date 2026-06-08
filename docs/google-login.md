# Google login — setup

The code is done on both sides. To turn it on you only need to create a Google OAuth client and
paste two env values. ~5–10 minutes, all in your Google account.

## What you do (Google Cloud Console — only you can do this)

1. Go to <https://console.cloud.google.com/> and create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: choose **External**, set an app name + your email,
   add yourself as a Test user. Save. (No verification needed while testing.)
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application** (this is what Expo Go's auth flow uses).
   - **Authorized redirect URIs** — add the Expo auth proxy URL:
     - `https://auth.expo.io/@YOUR_EXPO_USERNAME/mobile`
       (the slug is `mobile`, from `mobile/app.json`. If you set an Expo account `owner`, use it as
       `YOUR_EXPO_USERNAME`. Find it with `npx expo whoami`.)
     - For a standalone build you'd also add `grammardojo://` — not needed for Expo Go testing.
4. Copy the **Client ID** (looks like `1234567890-abc.apps.googleusercontent.com`).
   You do **not** need the client secret for this flow.

Then send me the Client ID (or just set the env vars below yourself).

## What's already built (code)

- **Backend** `POST /auth/google`: verifies the Google ID token at Google's tokeninfo endpoint,
  pins the audience to your client ID, requires a verified email from a Google issuer, then
  find-or-creates the user and issues the same app JWT as password login.
  (`backend/app/routers/auth.py`, `_verify_google_id_token`.)
- **Mobile**: the Login screen's Google button runs `expo-auth-session` to get a Google ID token and
  posts it to `/auth/google` (`mobile/app/login.tsx`, `store/auth.tsx`, `services/api.ts`).
- Until configured, the button shows a friendly "not configured yet" message.

## Env to set

**`backend/.env`** — the audience the backend trusts:

```
GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

**`mobile/.env`** (or your shell when running Expo) — same Web client ID, exposed to the app:

```
EXPO_PUBLIC_GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

## Install the new mobile deps (one-time)

```bash
cd mobile
npx expo install expo-auth-session expo-web-browser expo-crypto
```

(`package.json` already lists them; `expo install` pins the exact SDK-54 versions.)

## Verify

1. Backend: restart it (so it reads `GOOGLE_CLIENT_ID`).
2. App: restart Expo so `EXPO_PUBLIC_GOOGLE_CLIENT_ID` is picked up.
3. Login screen → **Google** → pick your Google account → you should land logged in, with progress
   syncing like any account.

Notes:
- Google accounts have no password (a random unguessable hash is stored), so they can only sign in
  via Google — no DB migration was needed.
- The backend returns `503 "Google sign-in is not configured."` if `GOOGLE_CLIENT_ID` is empty.
