---
name: Relo Dojo
description: Calm native dojo with earned game progression
colors:
  bamboo: "#376347"
  bamboo-pressed: "#284B34"
  on-bamboo: "#FFFFFF"
  bamboo-soft: "#E6ECDF"
  paper: "#F6F3EB"
  parchment: "#FFFCF5"
  paper-secondary: "#EEEBDD"
  paper-track: "#E5E2D6"
  ink: "#253328"
  secondary-ink: "#566053"
  muted-ink: "#666F61"
  outline: "#DDDDCF"
  outline-strong: "#C9CEBD"
  amber-ink: "#896421"
  rust: "#9E592D"
  error: "#AE463B"
  night-paper: "#171D18"
  night-surface: "#202821"
  night-bamboo: "#8EBA9A"
  night-bamboo-pressed: "#679474"
  night-bamboo-soft: "#253C2C"
  night-on-bamboo: "#102416"
  night-ink: "#F0EEE3"
  night-secondary-ink: "#C4C6B8"
  night-muted-ink: "#A0AA99"
  night-outline: "#3D483A"
typography:
  display:
    fontFamily: Zen Maru Gothic
    fontSize: "32px"
    lineHeight: "38px"
    fontWeight: 700
  headline:
    fontFamily: Zen Maru Gothic
    fontSize: "25px"
    lineHeight: "30px"
    fontWeight: 700
  title:
    fontFamily: Zen Maru Gothic
    fontSize: "17px"
    lineHeight: "21px"
    fontWeight: 700
  body:
    fontFamily: Hanken Grotesk
    fontSize: "16px"
    lineHeight: "23px"
    fontWeight: 500
  body-strong:
    fontFamily: Hanken Grotesk
    fontSize: "16px"
    lineHeight: "23px"
    fontWeight: 600
  control:
    fontFamily: Hanken Grotesk
    fontSize: "16px"
    lineHeight: "23px"
    fontWeight: 700
  secondary:
    fontFamily: Hanken Grotesk
    fontSize: "14px"
    lineHeight: "20px"
    fontWeight: 500
  caption:
    fontFamily: Hanken Grotesk
    fontSize: "12px"
    lineHeight: "17px"
    fontWeight: 600
  label:
    fontFamily: Hanken Grotesk
    fontSize: "13px"
    lineHeight: "18px"
    fontWeight: 700
  mono:
    fontFamily: JetBrains Mono
    fontSize: "15px"
    lineHeight: "21px"
    fontWeight: 400
rounded:
  control: "12px"
  surface: "16px"
  showcase: "20px"
  pill: "999px"
spacing:
  page: "20px"
  stack: "14px"
  target: "48px"
components:
  button-primary:
    backgroundColor: "{colors.bamboo}"
    textColor: "{colors.on-bamboo}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "15px 18px"
  button-ghost:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "13px 18px"
  card:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "20px"
  chip:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
  chip-selected:
    backgroundColor: "{colors.bamboo-soft}"
    textColor: "{colors.bamboo}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
---

# Design System: Relo Dojo

## Overview

**Creative North Star: "A calm dojo with game progression"**

The owner selected this direction on 2026-10-31. It refines the existing torii,
Sensei, belt and scroll identity. Warm paper and readable ink support a short,
focused training ritual. The filled bamboo action leads to practice; earned belts
and a small reward reveal give progress a physical, recognisable form.

**Key Characteristics:**

- Warm neutral surfaces, restrained bamboo action colour and legible secondary ink.
- Existing belt colours remain meaningful progression markers.
- Standard native navigation, spacious controls and clear recovery states.
- Rewards acknowledge practice without competing with the lesson.

## Colors

The light palette is paper, parchment and ink, with bamboo for primary actions and
current selection. Rust and amber serve supporting status; red identifies errors.
Use `mobile/theme/theme.ts` as the executable source, including its complete dark
scheme. Dark mode uses warm charcoal with lighter bamboo and dark on-primary ink;
it is a separately resolved palette. The frontmatter records reused primitives;
the complete theme also owns soft status fills and the remaining surface steps.

Light ink on paper measures 11.96:1, secondary ink 5.93:1 and muted ink 4.72:1.
White on the light primary is 6.91:1. Dark on-primary ink measures 7.50:1. These are
token-pair checks; verify each composed native screen too.

Belts retain their existing white/yellow/orange/green/blue/black swatches. Use them
on knots, racks and small course markers, rather than as large reading surfaces.
The launcher reuses the existing torii vector with a flat bamboo ground and gold
step; the gold mark is an accent rather than text.

## Typography

Zen Maru Gothic carries the existing rounded display voice. Hanken Grotesk carries
body and controls; JetBrains Mono is reserved for English examples/code or measured
values. Font weights are encoded in the loaded font family; do not add `fontWeight`
to a custom family. Native text retains React Native font scaling and OS glyph
fallbacks, including Cyrillic fallback where the selected face has no glyph.

The frontmatter maps native `hero` to display, `screenTitle` to headline and
`cardTitle` to title. Body strong uses the semibold face; shared Button labels use
the bold UI face. Button labels default to normal case, with uppercase an explicit
caller option. Avoid adding display fonts to data/control labels.

**The Encoded Weight Rule.** Native custom-font families already encode weight.
The frontmatter records the portable family and weight; native components select
the corresponding named face from `fonts` instead of adding `fontWeight`.

## Layout

Use the existing Expo Router tabs and native navigation stack. Page padding is
20 logical units, standard vertical gap 14, control target at least 48 on Android.
Preserve safe-area and keyboard insets. Scroll content must leave space below the
last action; the consent route includes its bottom safe area explicitly. Frontmatter
pixel strings represent the source's logical native units, not physical pixels.

The three-tab bar height is `ceil(48 + 16 × fontScale) + bottomInset`. Its active
highlight surrounds the icon (52 × 32), while the label remains below it. Preserve
the scaling formula and safe-area padding rather than fixing a screenshot height.
Route-specific hierarchy and acceptance evidence live in
`.impeccable/surfaces/mobile.md`.

## Elevation & Depth

Ordinary cards and mode rows use one quiet outline and tonal surface, with no
shadow. The shared Button and Daily Mix retain a two-unit lower border that becomes
one unit during a one-unit downward press. The translation popover uses the theme's
large overlay shadow; light and dark resolve it separately.

**The Quiet Surface Rule.** Ordinary cards and mode rows separate content with tone
and an outline. Do not spread the overlay shadow across those rows.

## Shapes

Controls use 12-unit corners, cards 16 and the belt summary 20. Pills identify small
chips or badges. Belt knots, the torii and the drawn scroll are established domain
shapes. Icons use the shared two-unit rounded line system.

## Components

The sidecar's self-contained HTML/CSS samples translate native components for the
design panel. Browser hover and focus-visible rules belong to that preview;
React Native components remain the authority for shipped interaction states.

- **Primary Button:** filled bamboo, contrasting on-primary text, minimum target 48,
  default normal case, bold UI label and explicit disabled/loading text supplied by
  its caller. Disabled colours use the surface track, strong outline and muted ink.
- **Ghost Button:** parchment with a strong outline; pressed state uses the
  secondary paper surface. It shares the primary control's bold label and target.
- **Daily Mix:** full-width filled bamboo action, drawn bolt, title/subtitle and
  drawn chevron. It uses the card radius and 16-unit padding.
- **Mode row:** quiet outlined native row, one consistent icon, readable title and
  subtitle, chevron. It is secondary to Daily Mix.
- **Card:** parchment, one outline, 20 padding and 16 corners.
- **Choice chip:** pill with 48-unit minimum target; selected state uses soft bamboo
  with bamboo ink and outline. Disabled opacity is 0.5.
- **Account field:** visible label, parchment fill, strong two-unit outline and
  12-unit corners. Focus changes the outline to bamboo; entry text uses the medium
  UI face at 15 units and placeholder text uses muted ink.
- **Navigation:** Home, Train and Progress use the shared drawn icons, a soft bamboo
  icon highlight, active bamboo text and inactive muted ink. Labels are 12/16 with
  the semibold UI face.
- **Belt controls:** names localize to Russian/English; the sheet explains practice
  progression. Warm-up completion presents a preliminary estimate and a white-belt
  Sensei, while the worn belt follows the earned-belt cap. A starting belt does not
  claim measured CEFR mastery.
- **Topic rows:** unstarted topics show a dash and explanatory text, without invented
  accuracy. Display skill estimates as estimates.
- **Scroll:** server-authoritative result, 220ms reveal; reduced motion reveals
  immediately. Distinguish the exact daily-cap code from network uncertainty. Never
  automatically retry a possibly credited reward.
- **Motion:** tab mascots rest. Keep existing progress feedback; the completion
  reward is the authored celebration, with reduced motion honoured.

## Do's and Don'ts

### Do

- **Do** keep the next useful learning action findable in the first viewport.
- **Do** use existing belt and scroll mechanics without inventing mastery or reward claims.
- **Do** verify light, dark and enlarged type in a native emulator or device.
- **Do** preserve native Back, safe areas, keyboard access and clear loading/error states.

### Don't

- **Don't** put promotions, reward pressure or a long catalogue ahead of the daily practice action.
- **Don't** replace the quiet training-mode surfaces with saturated fills, gradients or repeated shadows.
- **Don't** present estimated skill or unstarted topics as earned proficiency.
- **Don't** replace the established dojo with a new brand or generic emoji icon vocabulary.
