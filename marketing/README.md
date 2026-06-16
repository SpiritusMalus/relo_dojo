# marketing/

Pre-launch design + marketing kit for **Relo Dojo**. Drafted by Claude; the **[YOU]** items in
`BRAND_ASSETS.md` need a design tool or a real device to finish.

- **`landing/index.html`** — single-file landing page (no build step; open or host as-is).
- **`quiz/index.html`** — lead magnet: a 2-min "English for IT relocation" mini-quiz (9 real
  relocation scenarios → score + belt + share). RU framing, EN test content, RU explanations —
  targets the RU/CIS IT-relocation cohort. Fully static (no backend, no LLM cost on web traffic).
  Forwardable in Telegram; ends on an install CTA. **[YOU]:** set the two URL placeholders at the top
  of the `<script>` (`APP_URL`, `SHARE_URL`) and export a `quiz/og-image.png` (1200×630) for the
  link preview.
- **`phrasepack/`** — lead magnet #2: **`relo-dojo-50-relocation-phrases.pdf`**, a 3-page A4
  phrasebook (50 real EN phrases for interview · life abroad · workplace, with RU usage notes).
  Forwardable in Telegram; ends on a CTA to the quiz/app. Regenerate from `build_phrasebook.py`
  (needs `reportlab` + a Cyrillic TTF — reportlab's Helvetica has none): `python3 -m venv /tmp/pdfvenv
  && /tmp/pdfvenv/bin/pip install reportlab && /tmp/pdfvenv/bin/python marketing/phrasepack/build_phrasebook.py`.
  **[YOU]:** swap the `relodojo.app` placeholder for the live URL before sharing.
- **`icon/icon-master.svg`** — app-icon master (torii "gateway = relocation" mark, 1024×1024).
- **`BRAND_ASSETS.md`** — the spec: icon export recipe + Android adaptive split, store-screenshot
  plan (sizes + the 5 shots + captions), and the landing go-live checklist.

Brand palette and the torii mark mirror the app theme (`mobile/theme/theme.ts`); copy is aligned
with `legal/STORE_LISTING.md`. Keep them in sync if positioning changes.
