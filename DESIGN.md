---
name: Relo Dojo
description: Calm native dojo with earned game progression
colors:
  bamboo: "#376347"
  bamboo-pressed: "#284B34"
  bamboo-soft: "#E6ECDF"
  paper: "#F6F3EB"
  parchment: "#FFFCF5"
  paper-secondary: "#EEEBDD"
  paper-track: "#E5E2D6"
  ink: "#253328"
  secondary-ink: "#566053"
  muted-ink: "#666F61"
  outline: "#DDDDCF"
  amber-ink: "#896421"
  rust: "#9E592D"
  error: "#AE463B"
  night-paper: "#171D18"
  night-surface: "#202821"
  night-bamboo: "#8EBA9A"
  night-on-bamboo: "#102416"
  night-ink: "#F0EEE3"
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
  label:
    fontFamily: Hanken Grotesk
    fontSize: "13px"
    lineHeight: "18px"
    fontWeight: 700
rounded:
  control: "12px"
  surface: "16px"
  showcase: "20px"
spacing:
  page: "20px"
  stack: "14px"
  target: "48px"
components:
  button-primary:
    backgroundColor: "{colors.bamboo}"
    textColor: "#FFFFFF"
    rounded: "{rounded.control}"
    padding: "15px 18px"
  button-ghost:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "13px 18px"
  card:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "20px"
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
it is a separately resolved palette.

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

Hero 32/38, screen title 25/30, card title 17/21, body 16/23, secondary 14/20,
caption 12/17 and label 13/18. Labels and primary buttons use normal sentence case.
Avoid adding display fonts to data/control labels.

## Layout

Use the existing Expo Router tabs and native navigation stack. Page padding is
20 logical units, standard vertical gap 14, control target at least 48 on Android.
Preserve safe-area and keyboard insets. Scroll content must leave space below the
last action; the consent route includes its bottom safe area explicitly.

Home exposes its belt summary and Daily Mix before the longer course path. Train
shows practice modes before the topic catalogue. Progress separates earned belt
and XP information from estimates and unstarted topics. Route-specific hierarchy
lives in `.impeccable/surfaces/mobile.md`.

## Elevation & Depth

Ordinary cards and mode rows use one quiet outline and tonal surface, with no
shadow. The shared Button retains a subtle two-unit lower edge and one-unit press
translation. Existing overlay shadow tokens remain available to focused sheets;
do not apply them to every list row.

## Shapes

Controls use 12-unit corners, cards 16 and the belt summary 20. Pills identify small
chips or badges. Belt knots, the torii and the drawn scroll are established domain
shapes. Icons use the shared two-unit rounded line system.

## Components

- **Primary Button:** filled bamboo, contrasting on-primary text, minimum target 48,
  normal case, explicit disabled/loading text supplied by its caller.
- **Mode row:** quiet outlined native row, one consistent icon, readable title and
  subtitle, chevron. It is secondary to Daily Mix.
- **Card:** parchment, one outline, 20 padding and 16 corners.
- **Belt controls:** names localize to Russian/English; the sheet explains practice
  progression. A starting belt does not claim measured CEFR mastery.
- **Topic rows:** unstarted topics show a dash and explanatory text, without invented
  accuracy. Display skill estimates as estimates.
- **Scroll:** server-authoritative result, 220ms reveal; reduced motion reveals
  immediately. Distinguish the exact daily-cap code from network uncertainty. Never
  automatically retry a possibly credited reward.
- **Motion:** tab mascots rest. Keep existing progress feedback; the completion
  reward is the authored celebration, with reduced motion honoured.

## Do's and Don'ts

### Do
- Keep the next useful learning action findable in the first viewport.
- Use existing belt and scroll mechanics without inventing mastery or reward claims.
- Verify light, dark and enlarged type in a native emulator or device.
- Preserve native Back, safe areas, keyboard access and clear loading/error states.

### Don't
- Put promotions, reward pressure or a long catalogue ahead of the daily practice action.
- Use saturated mode backgrounds, decorative gradients or shadows on every card.
- Present estimated skill or unstarted topics as earned proficiency.
- Replace the established dojo with a new brand or generic emoji icon vocabulary.
