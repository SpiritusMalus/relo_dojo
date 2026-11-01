# Relo Dojo

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

English learners practising in short daily sessions, with exercises related to their
goals and field. The existing product supports Russian and English UI. The owner is
the first tester; the current delivery target is an Android test release.

## Product Purpose

Make a small daily English practice session useful, understandable and worth returning
to. After each answer, use evidence about the learner's skill and effort to choose the
next appropriate challenge. A correct answer and an explanation must be trustworthy.

## Operating Context

Native Expo/React Native client, FastAPI/PostgreSQL backend, generated exercises through
OpenRouter. Anonymous practice precedes optional account creation. Saved progress,
reviewing mistakes and returning to the next session are core workflows. Emulator
acceptance and an installable Android build are required for this test release.

## Capabilities and Constraints

- Preserve existing exercise formats, deterministic grading, consent and account controls.
- Difficulty should respond after every answer, conservatively and per skill/topic.
- Generation uses explicit contracts and validation; a strict prompt alone is insufficient.
- Existing belts, scroll rewards, quests, review and cosmetics supply game progression.
- Payments, advertisements and microphone/Live voice are separate gated capabilities;
  adding them is not required to make the learning loop complete.
- Existing iOS targets remain in the repository; Android emulator evidence does not
  establish iOS or physical-device acceptance.

## Brand Commitments

The name is Relo Dojo. The owner confirmed on 2026-10-31: a calm dojo with game
progression. Preserve recognisable scrolls, belts and a welcoming learning ritual.
Avoid noisy pressure, fabricated mastery or rewards that obscure the learning task.

## Evidence on Hand

The existing app and its assets are the visual starting point. The 2026-10-31 audit
established 420 backend tests, 379 mobile tests and a running API/database, but did not
prove native usability, current model quality, learning effectiveness or retention.
No customer testimonials or commercial results are supplied.

## Product Principles

1. Evidence before promotion: distinguish estimated skill from earned achievements.
2. Every answer informs the next challenge without sudden difficulty jumps.
3. Recovery is part of the task: network/audio failures must offer a clear next step.
4. The dojo supports concentration; game progression rewards the learning loop.
5. Verify the full native journey, not only unit tests or a visual mockup.
6. Use short, natural copy. Show reward requirements at the point of choice; keep routine
   screens free of boilerplate footnotes, canned praise and explanations of internal rules.
