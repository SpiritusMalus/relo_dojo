# Relo Dojo — brand assets & store-art plan

Everything design/marketing that's left before submission. The landing page (`landing/index.html`)
and the icon master (`icon/icon-master.svg`) are drafted; this doc is the spec to turn them into the
exact files the stores and `app.json` need. I draft, you ship — items marked **[YOU]** need a design
tool or a real device.

Brand palette (single source of truth = `mobile/theme/theme.ts`):

| Token | Hex | Use |
|---|---|---|
| accent (green) | `#0E8A30` | primary brand, buttons, icon bg |
| accent-press | `#0B6E26` | gradient bottom, pressed |
| gold | `#E3A52C` | belt/step accent, highlights |
| fire | `#F0801F` | streak |
| ink | `#15201A` | text |
| screen | `#FBFDFB` | page bg |

Logo concept: a **torii gateway** = a passage (relocation), drawn dojo-clean, with a gold step rising
through it (the climb / the belt). The same mark is inlined in the landing nav and the icon.

---

## 1. App icon

Source: [`icon/icon-master.svg`](icon/icon-master.svg) (1024×1024, full-bleed green).

`app.json` already references these paths under `mobile/assets/` — replace the current files:

| File (mobile/assets/) | Size | Notes |
|---|---|---|
| `icon.png` | 1024×1024 | iOS + master. Full-bleed (no transparency, no rounded corners — iOS rounds it). |
| `android-icon-foreground.png` | 1024×1024 | **Adaptive foreground.** Torii + gold step ONLY, centered in the inner **66%** safe circle, transparent background. |
| `android-icon-background.png` | 1024×1024 | **Adaptive background.** Solid `#0B6E26→#12A23A` gradient (or flat `#0E8A30`), no art. |
| `android-icon-monochrome.png` | 1024×1024 | **Themed icon (Android 13+).** White torii silhouette on transparent; the OS tints it. |
| `splash-icon.png` | ~1242×1242 | Torii mark centered; splash bg is set in `app.json` (`#E6F4FE` today — consider switching to white `#FBFDFB` for brand consistency). |
| `favicon.png` | 48×48 | Web favicon; the torii on green. |

> ⚠ Android safe area: the launcher masks the outer ~25% (circle/squircle/rounded). The master is
> full-bleed for iOS; for the **foreground** layer, scale the torii to sit inside the central 66%
> or the gate's pillars get clipped.

### Export recipe **[YOU]**

Pick one (all produce crisp PNGs from the SVG):

```bash
# librsvg (brew install librsvg)
rsvg-convert -w 1024 -h 1024 marketing/icon/icon-master.svg -o mobile/assets/icon.png

# or Inkscape
inkscape marketing/icon/icon-master.svg -w 1024 -h 1024 -o mobile/assets/icon.png

# or Node sharp (npx -y sharp-cli)
npx -y sharp-cli -i marketing/icon/icon-master.svg -o mobile/assets/icon.png resize 1024 1024
```

For the adaptive **foreground/monochrome**, make two trimmed SVG variants from the master (drop the
background `<rect>`; for monochrome, set all strokes/fills to `#FFFFFF`), then export at 1024.
Easiest cross-check: drop the master into [icon.kitchen](https://icon.kitchen) or Android Studio's
Image Asset Studio to preview the maskable result before committing.

After replacing the files: `npx expo prebuild --clean` (or let EAS rebuild) so native projects pick
up the new icons. Sanity-check the maskable version on a real launcher.

---

## 2. Store screenshots **[YOU — needs the app on a device/simulator]**

Capture from a clean install with seeded-looking progress (a few finished lessons, a 7-day streak,
white/yellow belt) so the gamification reads. Use the **light theme**.

### Sizes
| Store | Required | Pixels |
|---|---|---|
| Google Play | 2–8 phone shots | 1080×1920 (9:16) portrait |
| Google Play | Feature graphic | 1024×500 (no transparency) |
| App Store | 6.7" iPhone | 1290×2796 |
| App Store | 6.5" iPhone | 1242×2688 (or scale the 6.7") |
| App Store | (if iPad supported) 12.9" | 2048×2732 |

### The 5 shots (order = the pitch)
1. **Home / Sensei** — the daily mix, Sensei avatar + speech bubble, streak flame, daily-goal ring.
   Caption: **"Five honest minutes a day."**
2. **Practice** — a multiple-choice card mid-answer (a standup/dev example).
   Caption: **"Examples built from your own role."**
3. **Relocation journey** — the Progress tab journey card (pre-move → arrived → settled).
   Caption: **"From the interview to your first standup abroad."**
4. **Belts / progress** — the belt journey + XP.
   Caption: **"Earn your belt, white to black."**
5. **Review my text** — paste-your-own-email feedback.
   Caption: **"Get your real messages checked."**

### Framing
- Add device frames + the caption band above each shot (Figma, [shots.so](https://shots.so),
  [previewed.app](https://previewed.app), or Fastlane `frameit`).
- Caption band: green `#0E8A30`, white text; or white band with `#15201A` text + a thin belt stripe.
- Keep captions ≤ 6 words; truthful (no voice/payments — not shipped).

### Capture how-to
- iOS Simulator: `xcrun simctl io booted screenshot shot1.png` (exact pixel sizes per device).
- Android emulator: `adb exec-out screencap -p > shot1.png`.
- Real device: native screenshot, then scale to the table above.

---

## 3. Landing page

[`landing/index.html`](landing/index.html) — single file, no build step, responsive, on-brand
(palette + torii mark inlined). Open it directly or host on any static host (Netlify / Vercel / GitHub
Pages / Cloudflare Pages).

Before publishing **[YOU]**:
- Wire the **store badges + links** in the `#get` band and nav (placeholders marked `TODO`).
- Point **Privacy / Terms** in the footer at the published `legal/` URLs.
- Export a real **`og-image.png`** (1200×630) for social previews — reuse shot 1 or the hero.
- Set the contact email (currently `hello@relodojo.app`) and confirm the domain (hub note: the
  registered domain is `grammardojo.ru`; decide the public marketing domain).
- Optional: drop one real product screenshot into the hero in place of the CSS phone mock.

Copy is aligned with `legal/STORE_LISTING.md` — keep the two in sync if you revise positioning.
