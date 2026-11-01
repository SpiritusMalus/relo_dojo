# Relo Dojo model selection — 2026-10-31 to 2026-11-01

The release candidate uses `google/gemini-3.5-flash-lite` for generated text and
`openai/gpt-6.1-terra` for a separate semantic-review request, writing assessment, planning and
on-demand explanations (both structured and streaming).
Audio transcription retains `google/gemini-3.1-flash-lite`. All requests go through OpenRouter.
The selected text setting is reasoning `low`, provider sort `latency`, and a 1,024-token output cap.
After exhausted content validation, one checked repair may use `google/gemini-3.8-flash`.
If that also fails, a separately authored safety-net item may be served with `source=curated`
and its **actual** level. This floor never disguises an easier item as generated C1 content.

This is a small task-specific smoke comparison, not a statistical model ranking or a certified
CEFR examination. Model access, structural validity, semantic validity and delivery rate are
different measurements. A refused request is never scored as an incorrect model answer.

## Comparison and selection

The initial common matrix covered 15 A1–C1 cases, all eight weighted exercise formats and
listening. It used the actual production generator, validation/retry/fallback ladder, sealed
answer keys, deterministic grading and a fixed separate reviewer (`openai/gpt-6.1-terra`).
Concurrency was three; latency below excludes waiting for that local semaphore and includes
provider retries and review. Prices/capabilities came from the live official model catalogue.

| Generator | Served | Requested format | Median / max | Reported API cost |
|---|---:|---:|---:|---:|
| Gemini 3.1 Flash Lite | 13/15 | 12/15 | 5.11 / 22.56 s | $0.03556 |
| Gemini 3.5 Flash Lite | 14/15 | 12/15 | 7.46 / 19.99 s | $0.03253 |
| GPT-6 Luna | 13/15 | 13/15 | 9.69 / 33.65 s | $0.02491 |
| Claude Haiku 5.5 | 12/15 | 7/15 | 17.26 / 38.92 s | $0.03401 |

These are end-to-end delivery results, not pure model intelligence scores. Some requests were
blocked by the account's input-sensitive information policy. Haiku also repeatedly exhausted the
1,024-token cap; its result applies to this tested configuration, not every possible configuration.
The complete prompts/results/rejections and usage evidence are in
[`03-four-model-comparison.json`](benchmarks/2026-10-31/03-four-model-comparison.json).

Advanced discovery then exposed conflicting prompts: B2 prepositions still received a basic
time/place reference, and lexical questions demanded grammatical rather than semantic
exclusivity. Correcting those conflicts let Gemini 3.5 serve all four targeted advanced cases.
Gemini 3.8 Flash served three of four with roughly twice the median latency; switching to a larger
model alone did not fix the prompt contract. See
[`05-advanced-prompt-repair.json`](benchmarks/2026-10-31/05-advanced-prompt-repair.json).

## Quality contract

- Native strict structured output and provider parameter support are requested. The app also
  checks output types, required fields and enums locally; successful JSON parsing is insufficient.
- Choice sets must contain distinct visible options and their key. Truncation cannot hide an
  answer. Blank counts, matching tiles and dialog lengths are checked before serving.
- The grammatical reference no longer treats optional reported-speech backshift as obligatory.
  Known ambiguous present/past and will/would pairs after reporting verbs are rejected locally.
- Basic article/time-preposition blueprints remain available at lower levels. A blueprint proves
  only its slot key; **every AI-authored surrounding sentence still receives semantic review**.
  Independent inspection found “I wait here for an hour now” with a correct article key, which
  exposed the old review exemption. That exemption is removed and a regression test covers it.
  B2/C1 uses generated substantive decisions with advanced references, followed by review.
- AI-authored tasks are independently reviewed for correctness, unique answerability, missing
  information and translation mismatch. Failed reviews feed a concrete repair reason into the next
  attempt. A valid multiple-choice fallback is allowed; the originally requested format is recorded.
- CEFR remains an instructional target. Review rejects gross mismatches, such as reported speech
  for A1 or elementary vowel-sound a/an labelled C1, but does not pretend to certify an exact B2/C1
  boundary. Valid idioms, metaphors and wording are not rejected for subjective style preferences.
- The entire generation/review/retry ladder has a 60-second deadline. Policy/configuration errors
  fail promptly; an already generic policy-denied request is not repeatedly resubmitted.
- Malformed/truncated JSON and schema violations are content errors, so they can reach the single
  repair and safety net. Explicit model refusals and content-filter outcomes remain policy errors
  and never enter that path. A reviewer failure cannot leak an unreviewed generated item.
- `practice_index` rotates a topic's actual learning objective. Word-order rotation replaces the
  old frequency-adverb anchor, rather than renaming nouns in another always/is-always question.
  Recent answer evidence and the two-format window survive progress synchronization.
- Word-order `odd-one-out` requests use the existing multiple-choice generator and return its
  actual type/key. Native acceptance found short inversion starters with an unstated category;
  their explanation invented a grammar defect. This narrow routing avoids that unsupported
  combination while retaining other topics' classification tasks. Both explanation paths receive
  a grounding rule: compare the visible alternatives, distinguish category from grammaticality,
  and acknowledge insufficient context. The rule is a prompt instruction, not a correctness proof.

An agent inspection of an earlier same-model-review run found false acceptance of ambiguous
reported speech and inappropriate beginner grammar. That run is retained as evidence of the
limitation, not a successful quality gate:
[`02-same-model-review.json`](benchmarks/2026-10-31/02-same-model-review.json).
An independent second agent inspected subsequent task/key pairs and helped distinguish real
ambiguity from an overstrict subjective difficulty filter. Neither inspection is a human examiner's
certification.

## Access and policy evidence

Initially, the authenticated model eligibility endpoint returned only Gemini 3.1 Flash Lite.
Alternative generators and the reviewer were denied before inference; the owner subsequently
changed that access restriction. No model winner was inferred from those denied requests.

A separate Person-name `Block` policy also rejected ordinary feedback and every writing fixture,
including samples without personal names. Direct neutral requests to both selected models
returned HTTP 200, and direct unchanged app prompts returned the provider's HTTP 403. No local
backend PERSON detector produced those errors. The owner explicitly authorized changing that
one policy action to `Redact`; other account controls were left unchanged. Account identifiers,
credentials, request headers and private account budgets are excluded from these artifacts.
Two remaining location-sensitive writing fixtures were subsequently refused; the owner separately
authorized Address `Block` to `Redact`. Their exact unchanged inputs then passed 2/2. No other
account controls were changed.

The pre-change writing result is provider-policy failure, not 0% CEFR classification quality:
[`06-writing-policy-blocked.json`](benchmarks/2026-10-31/06-writing-policy-blocked.json).
The calibrated pre-policy-fix generation run served 16/17 tasks with 15 requested formats,
median 4.65 s and maximum 20.89 s; its only unavailable case was a provider-policy refusal:
[`08-calibrated-review.json`](benchmarks/2026-10-31/08-calibrated-review.json).

Final post-policy-change generation and fixed feedback/writing regression evidence is recorded
alongside these files; see the completion receipt below.

## Reproduction

From `backend/`, with an authorized environment already configured:

```sh
python -m evals.compare_openrouter --models google/gemini-3.5-flash-lite \
  --review-model openai/gpt-6.1-terra --budget-usd 1 \
  --output evals/reports/generation.json
python -m evals.run_eval --provider openrouter --model google/gemini-3.5-flash-lite --writing
```

For a server-side credential file, the comparison tool accepts `--env-file` and reads only the
OpenRouter key in that process. It does not copy credentials, import the FastAPI entry point,
start a service, connect to PostgreSQL or execute migrations. It checks authenticated model
eligibility before billable calls and bounds spend using in-flight reservations plus reported
usage. The regular fixed-set runner does not have that budget option; the release run used an
additional measured wrapper. Generated samples and fixtures contain synthetic content only.

## Primary sources

OpenRouter documents endpoint-dependent schema support and `require_parameters`, so the app
also validates locally rather than treating a provider promise as a semantic guarantee:
[structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
[provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).
Current slugs, supported parameters and prices were checked through the
[official model catalogue](https://openrouter.ai/api/v1/models).

The optional-backshift correction follows the
[British Council explanation](https://learnenglish.britishcouncil.org/free-resources/grammar/b1-b2/reported-speech-statements)
and [Cambridge Grammar](https://dictionary.cambridge.org/uk/grammar/british-grammar/reported-speech-indirect-speech).
Input-policy and model-allowlist behavior is documented in
[OpenRouter Guardrails](https://openrouter.ai/docs/guides/features/guardrails/overview).

## Completion receipt

- Offline backend after native-quality regressions: **520 tests passed**; existing environment
  requirements previously passed `pip check`.
- Earlier post-policy-change generation: **17/17 served**, **15/17 requested formats**;
  eight semantic rejections were repaired or replaced before serving. Median **4.43 s**, maximum
  **18.38 s**, reported API usage **$0.03876** for this run. Every delivered keyed response also
  passed the production deterministic checker. See
  [`09-post-redact-generation.json`](benchmarks/2026-10-31/09-post-redact-generation.json).
  This delivery result preceded the independent base-grammar finding described above; it must not
  be presented as a guarantee that every English sentence was correct.
- Fixed real-provider feedback regression: **53/53 correct** on the existing fixtures.
- Initial writing: **15/18 within expected bands** (83.3%, existing threshold 80%). Two samples were
  refused for the account's remaining LOCATION policy; these are provider failures, not bad model
  CEFR answers. One short connected landlord letter was under-rated A2 instead of the expected
  B1/B2. This specific limitation remains visible; no expected bands were changed to turn it green.
  The complete real responses/errors are in
  [`10-feedback-writing-regression.json`](benchmarks/2026-10-31/10-feedback-writing-regression.json).
- A sealed, varied-context 20-case holdout exposed four further quality/compliance failures:
  **16/20 served**, no access failures. This baseline is retained, not relabelled as a pass:
  [`11-holdout-v1.json`](benchmarks/2026-10-31/11-holdout-v1.json).
- After the bounded repair, safety net, objective rotation and all-context review were integrated,
  the same 20-case matrix was rerun as a **regression**, not a new unseen holdout:
  **20/20 served = 19 AI-generated + 1 authored safety-net item**, 15 requested formats,
  two repair-model calls, median **5.32 s**, p95 **24.84 s**, maximum **28.23 s** and reported usage
  **$0.05615**. The safety-net item's true level is recorded; policy outcomes are counted separately.
  See [`14-final-integration-20.json`](benchmarks/2026-10-31/14-final-integration-20.json), including
  source hashes. The subsequent error-classification fix is covered by offline regressions.
  Independent inspection also clarified that run's authored punctuation stem: it now explicitly
  requires three separate list items, removing a possible “tea bread” two-item reading. This
  correction is recorded separately rather than rewriting the old live report:
  [`16-curated-list-clarification.json`](benchmarks/2026-10-31/16-curated-list-clarification.json).
- The writing rubric was corrected using general communicative criteria after an independent
  review: connected, task-complete familiar communication can demonstrate B1 without mandatory
  errors or elaborate grammar. The original fixtures/expected bands were unchanged. The complete
  fresh run then scored **18/18**:
  [`15-writing-final-18.json`](benchmarks/2026-10-31/15-writing-final-18.json).
- These are service-level live checks. PostgreSQL, registration, native audio, device persistence
  and deployment are separate release checks owned by the main task.

The B1 correction follows the communicative scope in the
[British Council B1 writing material](https://learnenglish.britishcouncil.org/free-resources/writing/b1)
and [Council of Europe written-production descriptors](https://rm.coe.int/cefr-companion-volume-with-new-descriptors-2018/1680787989.pdf).

One attempted rerun was cancelled after an SSH source-transfer failure; it is excluded from final
claims. The successful final run followed matching local/staging SHA-256 checks. Captured provider
usage totals **$0.55944**. The cancelled run's uncollected usage is bounded by its own **$1 hard cap**,
within the task's $3 evaluation limit. The source/test/cost receipt is
[`17-final-source-receipt.json`](benchmarks/2026-10-31/17-final-source-receipt.json).
Private provider request headers/diagnostics are preserved outside Git; no account budget,
credential or customer data is included here.

## Native explanation follow-up — 2026-11-01

The visible `word order` odd card contained `Always we deploy`, `Seldom do we`, `Rarely can they`
and `Little did anyone`. Its key is defensible as a classification: the latter three start negative
fronting with auxiliary-subject inversion. Grammaticality alone does not invalidate an odd item;
the original contract explicitly permits short phrases. The native explanation nevertheless
claimed “subject first” and missed that actual distinction. The grammatical inversion rule follows
the [British Council C1 explanation](https://learnenglish.britishcouncil.org/free-resources/grammar/c1/inversion-after-negative-adverbials).

Only this topic/format pair is now routed to MC before inference. Tests cover actual response type,
sealed key type, correct/incorrect grading, retained semantic review and unchanged other formats.
The main task separately supplies the full visible exercise context to Explain.

Six bounded structured Explain requests used the selected base model with all four options visible.
Ordinary wrong-MC explanations passed manual inspection in RU/EN. The first two classification
answers named inversion but did not establish reliable reasoning; a stronger general classification
guard still produced two materially flawed answers. One falsely claimed that affirmative `Always`
required inversion. These are **known explanation failures**, not a 4/4 semantic pass. They remain
unchanged in [`18-native-explanation-initial-4.json`](benchmarks/2026-10-31/18-native-explanation-initial-4.json)
and [`19-native-explanation-odd-final-2.json`](benchmarks/2026-10-31/19-native-explanation-odd-final-2.json).
The deterministic routing prevents new cards of this combination; the prompt guard does not
guarantee sound explanations of historical classification cards. No further prompt/model search
was run. Streaming uses the same grounding rule and was verified offline, without extra paid calls.

Reported usage for this follow-up is **$0.0025072** across six calls, below its **$0.05** cap. Captured
task usage at that stage was **$0.561944**, still excluding the historical interrupted run's uncollected cost
bounded by its own $1 cap. Current hashes and 493-test receipt are in
[`20-native-quality-fix-receipt.json`](benchmarks/2026-10-31/20-native-quality-fix-receipt.json).
The standalone `evals/check_explanations.py` verifies expected source hashes before any provider
call and reserves conservative cost including transport retries. Only isolated evaluation staging
was updated; the running QA/API was not restarted or overwritten.

The next bounded check used the already selected smart model for Explain, while generation and
the 53-case free-text checker retained their original base-model routing. Structured Explain now
explicitly requests the smart tier; streaming accepts an optional tier, retains its base default,
and only the main task's Explain stream requests smart. Offline tests exercise the actual selected
payload/URL for all five provider paths, default preservation and an empty-smart-slot fallback.

Terra's four grounded RU/EN responses cost **$0.007124** and took **2.23–6.42 seconds**. Manual
inspection found three clean responses: RU classification and ordinary MC in both languages.
The EN classification named inversion correctly but still unnecessarily rewrote `Always we deploy`
as `We always deploy`. This is recorded as **partial, not a strict 4/4 pass**; no more calls were
made. Exact outputs and hashes are in
[`21-native-explanation-terra-4.json`](benchmarks/2026-10-31/21-native-explanation-terra-4.json).
The native follow-up's captured cost is **$0.0096312** total, below its two separately authorized
$0.05 caps; captured whole-task usage is **$0.569068**, with the earlier cancelled run still
separately bounded as described above. No further paid calls were made.

The residual legacy case is handled deterministically: public
`grammar.explanation_context_fallback(text, lang)` recognizes only JSON metadata
`type=odd-one-out, topic=word order` and returns an authored RU/EN note that the grouping rule is
not clear enough for a reliable explanation. It never matches specific option phrases and invokes
no provider. Structured Explain returns that note immediately; the main task's stream uses the
same public helper before generation. Other-topic odd cards and word-order MC still use Terra.
Behavioral tests forbid a model call for this legacy context and verify other contexts retain their
smart routing. Current full backend verification is **520 passed**; final hashes and cost are in
[`22-smart-explanation-source-receipt.json`](benchmarks/2026-10-31/22-smart-explanation-source-receipt.json).
The four Terra outputs above predate this deterministic legacy guard and remain unchanged as
evidence of why the guard is required, rather than being presented as final served explanations.
