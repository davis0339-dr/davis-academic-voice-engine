# Davis Academic Voice Engine — Phase 3/4 seed + Detector QA

Real build against the *Academic Writing & Research Style Engine — Master
Build Handoff* (7 Aug 2026). Phase 1 built the multi-pass rewrite pipeline;
Phase 2 replaced the two hand-typed "style family" rows from Phase 1 with a
real coverage-density engine computed over an actual 52-document evidence
dataset transcribed from `Davis_Academic_Language_Corpus_v0.1.md` (Baseline
v0.9, Batches 1-9); an interim update added a measurement-only **Detector
QA module** (Section 15.4); a further update added **Phase 3: long-document
processing** (Section 14/25) — chapter/thesis-length documents processed
as a chunked background job instead of one request. This update adds the
**first real Phase 4 diagnostic** (Section 15) — a cadence-deviation flag
grounded in one labeled document pair the product owner supplied, explicitly
NOT a calibrated score (see "What this update added (Phase 4 seed)" below).

## On detector scores — read this before using the Detector QA tab

This build deliberately does **not** try to guarantee a low score on any
AI-detection tool, and the Detector QA module is not a step toward that.
Section 15.4 of the handoff is explicit: *"[the engine] must not run an
endless generate → external detector → regenerate loop intended to force a
chosen external AI score."* Making "beat Turnitin/GPTZero" the product's
success criterion would be a losing target for three concrete reasons:
detectors disagree with each other and with re-runs of themselves; both
major providers actively patch against known evasion patterns, so anything
that works today needs re-fighting later; and it inverts the actual value
proposition, which is writing that's genuinely better structured and less
formulaic — not writing engineered to fool a classifier. The Detector QA
module exists only so you can *observe* how a real detector responds to
revised text, as one input among several during your own product QA — it
is never wired into `/api/rewrite`, and no code path in this repo feeds a
detector result back into generation.

## Run it

```bash
npm install
cp .env.example .env      # leave ANTHROPIC_API_KEY blank to start
npm run dev                # http://localhost:3000
```

The app starts and the editor loads with **no API key set** — the status
badge shows "LLM: not configured" rather than hanging (Gate 0).

To enable real revisions, put a real Anthropic API key in `.env`
(`ANTHROPIC_API_KEY=...`) and restart. The key is read server-side only
(`server/lib/llmProvider.js`); it is never sent to the browser, logged, or
embedded in any client-visible file.

## Run the test suite (no API key required)

```bash
npm test
```

48 tests pass, covering everything that doesn't require a live model call:
protected-span extraction, the preservation audit, the intervention
planner, the coverage-density engine and fallback ladder, the Detector QA
plumbing, document-map/chunking/job-store logic, and the cadence-deviation
diagnostic regression-tested against the two real labeled fixtures.

## What Phase 2 added

- **`server/data/corpusDocuments.js`** — 52 real per-document evidence
  records (author, year, degree, discipline, region, provenance tier,
  quality, and sentence-length statistics where the corpus note measured
  them), transcribed from the corpus markdown. Totals were checked against
  the corpus note's own "Current corpus status" section and match exactly:
  45 thesis/dissertation, 42 clean-text quantitative, 3 extraction-limited
  qualitative, 5 comparators, 8 duplicates excluded, 41 H1 + 4 H2.
- **`server/lib/corpusEngine.js`** — real coverage-density calculation.
  Given a requested filter combination, it counts actual matching
  independent sources, classifies strength (insufficient / emerging /
  supported against a configurable, explicitly-not-calibrated threshold),
  and — if the requested cell is too sparse — backs off dimension by
  dimension (section → research mode → discipline → degree → region →
  document type) until it reaches a cell with enough evidence, recording
  exactly what was dropped and why.
- **`GET /api/methodology`** — the real coverage table (Section 6.5's
  methodology/evidence screen), rendered as a "Methodology" tab in the UI.
- `server/lib/styleProfileStore.js` is now a thin adapter over
  `corpusEngine.js` instead of a static 2-row lookup table.

**Verified live** (real Anthropic key, run during this build): requesting
`UK + PhD + Finance + quantitative_archival + discussion` — the exact
worked example in Section 7.2 — correctly resolves to 12 real independent
sources and honestly reports that `section` was dropped because the corpus
doesn't track section-level evidence per document, while the rest of the
request was well-evidenced enough to use directly. Requesting
`Sub-Saharan Africa + Sport Science` correctly falls back, because the
corpus only has 2 Sub-Saharan African sources.

## What the Detector QA module added

- **`server/lib/detectorProviders/gptzero.js`** — the only detector this
  build can reach with a real, documented API. **Turnitin has no public
  developer API** — it's licensed directly into institutional LMS
  platforms with no third-party access route, so there is no Turnitin
  adapter here and there will not be one that actually works; faking one
  would violate Section 18.2's "no fake production functions" rule.
- **`server/lib/detectorQA.js`** — orchestrates configured providers,
  always attaches a disclaimer, and is never imported by
  `pipeline.js`/`rewrite.js`/`analyse.js`. That's not a style choice, it's
  the enforcement mechanism for Section 15.4's separation requirement.
- **`GET /api/health/detectors`, `POST /api/detector-scan`** — manual,
  on-demand only. Nothing auto-triggers a scan after a rewrite.
- **Detector QA tab** in the UI — "Scan source" / "Scan revised" buttons,
  a persistent disclaimer, a running results log so you can compare runs.
- **`npm run qa:detector`** (`scripts/detector-qa-report.js`) — a Section
  15.3-style comparison harness for the product team: runs a clean
  technical sample, a deliberately formulaic sample, and (if
  `ANTHROPIC_API_KEY` is set) a raw unedited LLM sample and an
  engine-revised sample through whatever detector is configured, and
  prints what each one reports. All sample text is original, written for
  this script — never copied from real thesis material, to avoid the
  copyright problem of reproducing corpus source text.

**Response parsing is defensive on purpose.** This build has not verified
the exact current GPTZero response schema against a live account — rather
than assert a shape and risk silently misreporting a score, the normalizer
(`normalizeGptZeroResponse`) extracts recognizable fields where present and
sets a visible `parseWarning` instead of guessing when it can't. Tested in
`tests/detectorQA.test.js` against both a well-formed and a malformed
fixture, with no network call needed.

## What Phase 3 added (long-document processing)

Section 14's requirement: chapter/thesis-length documents can't go through
`/api/rewrite` as one giant request. Phase 3 adds a real background-job
pipeline:

- **`server/lib/documentMap.js`** — builds a real document map: detects
  headings (Markdown `#`, numbered `1.2.3`, or ALL-CAPS section titles),
  builds a glossary from `Term (ACR)` / `ACR (Term)` pairs found anywhere
  in the document, and aggregates the full document-wide citation/number/
  quote list via Pass A. Two regex-overmatching bugs were caught and fixed
  by its own test suite during this build (a phrase boundary that could
  cross a paragraph break, and one that let a lowercase run-on sentence get
  mistaken for a defined term) — see `tests/documentMap.test.js`.
- **`server/lib/chunker.js`** — chunks on detected heading boundaries when
  there are at least two; otherwise falls back to paragraph-group chunking.
  A chunk boundary never falls mid-paragraph. Each chunk after the first
  carries a short trailing-sentence excerpt of the previous chunk as
  read-only continuity context (Section 14 point 4) — the excerpt is never
  itself protected-span-checked or repeated in output, it's context only.
  **The heading line is stripped before the chunk is sent to the model and
  reattached verbatim on reassembly** — a concrete implementation of
  "preserve formatting" (Section 14 point 8): section titles are
  structurally incapable of being reworded.
- **`server/lib/jobStore.js`** — an in-memory background job store
  (`createJob`/`getJob`/`retryChunk`). Chunks process sequentially through
  the *same* `pipeline.rewrite()` used by the single-paragraph flow (now
  extended with optional `precedingContext`/`documentGlossary` parameters),
  so long-document revision is not a second, divergent code path. A failed
  chunk never drops content: reassembly falls back to that chunk's
  original source text, clearly marked, so nothing silently disappears
  (Section 14 point 10's "allow retry... rather than losing the whole
  job," honored literally).
- **Document-level consistency pass**: once every chunk has been attempted,
  the full original document and the full reassembled document are run
  through the same `auditPreservation()` used per-chunk, catching anything
  that survived each individual chunk but broke across a chunk boundary.
- **`POST /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/chunks/:index/retry`**
  — exactly the endpoints Section 18.1 specifies, plus the retry-one-chunk
  endpoint Section 14 calls for.
- **"Long Document" tab** in the UI — paste a chapter, start a job, watch
  per-chunk progress with status badges, retry a failed chunk individually,
  view the reassembled output and the document-level preservation audit.

**Verified live** (real Anthropic key, run during this build): a 3-section
document with a defined abbreviation (`Board Independence (BI)`), two
citation styles, and inline statistics was submitted as a job. All 4
chunks (a headless preamble plus 3 sections) completed successfully;
section headings ("1 Introduction", "2 Literature Review", "3 Conclusion")
came back byte-for-byte unchanged; and the document-level preservation
audit reported `numbers_ok: true, citations_ok: true, technical_terms_ok:
true, quotes_ok: true` with zero warnings across the whole reassembled
document — including a case where the model spelled out "Board
Independence" in full in the conclusion instead of reusing "BI," which is
a legitimate stylistic choice the audit correctly did not flag.

**Known limitation, stated plainly:** the job store is in-memory and
single-process — it does not survive a server restart and won't work
across multiple server instances. That's Phase 7 infrastructure (a real
queue/worker), not something Phase 3 was scoped to build; see Section
18.1, which lists "Background job worker/queue" as its own service
boundary for exactly this reason. Chunks also process sequentially, not
concurrently, to keep rate-limit behavior simple and predictable.

## What this update added (Phase 4 seed)

On 2026-08-07 the product owner supplied two documents: one described as
purely AI-generated (an audit-firm-performance thesis chapter), one
described as human-written (a corporate-governance thesis introduction).
Both are saved, clearly labeled, in
`tests/fixtures/detector-benchmark/`. This is **one labeled pair, not a
calibration set** — Section 21.2 specifies what a real evaluation set
needs (historical human corpus, recent authenticated human writing,
multiple LLM outputs, human-edited AI text, polished human writing,
second-language writers, short and long texts, multiple disciplines), and
a pair of two documents does not clear that bar. Nothing here is presented
as calibrated, and no 0-100 score was added.

What the pair *did* make possible: running the existing keyword-based
diagnostics (Pass B — generic phrasing, transition stacking) against both
found **zero hits in either document**, which is itself a useful, honest
result — it shows word-list detection alone would miss this kind of
AI-generated text entirely. What produced a sharp, real difference was
sentence-length distribution:

| | AI-described sample | Human-described sample |
|---|---:|---:|
| Sentences | 96 | 285 |
| Mean sentence length | 41.7 words | 24.5 words |
| Sentences ≥30 words | 79.2% | 30.2% |

For context: across the entire 45-document thesis core already in
`corpusDocuments.js`, the most extreme single document (Chapman, 2016)
averages 32.1 words/sentence. The AI-described sample runs past even that.
The human-described sample sits comfortably inside the historical range.

- **`server/lib/cadenceDeviation.js`** — compares a submitted document's
  own sentence-length distribution against the ACTUAL measured range of
  its resolved corpus family (real per-document numbers from
  `corpusDocuments.js` via `corpusEngine.compileFamily`, not a guessed
  constant), and flags when the document falls outside that range on
  either mean sentence length or proportion of long (30+ word) sentences.
  It refuses to compare at all when the resolved family has fewer than 3
  measured sources (`MIN_FAMILY_SAMPLE`), rather than compare against
  noise — a real case of this firing exists in the corpus today
  (`document_type=journal_article` matches 3 documents but only 1 has
  cadence data measured, covered by `tests/cadenceDeviation.test.js`).
- **Explicitly not an authorship claim.** The module's own `note` field
  says so on every response, and Section 9.1 is blunt about why: "long
  sentences are not automatically AI." This flags a document as sitting
  outside an evidence-based range, nothing more — the same posture as
  every other diagnostic in this codebase.
- Wired into `pipeline.analyse()` as `diagnostics.cadence_deviation`, so
  it appears in both `/api/analyse` and `/api/rewrite` responses and in
  the "Writing Quality" tab, labeled "experimental, Phase 4 seed" in the UI.
- 5 new tests (48 total, all passing), including a direct regression
  check against both real fixtures: the AI-described sample must trigger
  both flags, the human-described sample must trigger neither.

**This is a starting mechanism, not Phase 4 complete.** Section 25 Phase 4
still calls for feature extraction beyond cadence, sentence-level UI
highlighting, a real labelled benchmark (Section 21.2), and calibration
before anything resembling a score is shown (Section 15.2). Growing
`tests/fixtures/detector-benchmark/` with more labeled pairs — more
disciplines, more authors, edited AI text, second-language human writers
— is the direct next step toward that, not a rebuild.

## Architecture

```
server/
  index.js                Express app, mounts routes, serves public/
  routes/
    health.js               GET /api/health, GET /api/health/llm
    styleProfiles.js         GET /api/style-profiles
    methodology.js            GET /api/methodology              (Phase 2)
    analyse.js                POST /api/analyse   (Passes A-C, no LLM call)
    rewrite.js                  POST /api/rewrite    (Passes A-F, calls the LLM)
    detectorScan.js               GET /api/health/detectors, POST /api/detector-scan   (Detector QA)
    jobs.js                         POST /api/jobs, GET /api/jobs/:id, POST /api/jobs/:id/chunks/:index/retry   (Phase 3)
  lib/
    llmProvider.js          Server-side-only Anthropic adapter + health check states
    protect.js                Pass A: citations/numbers/quotes/acronyms extraction
    diagnostics.js             Pass B: rule-based writing-quality diagnostics
    planner.js                   Pass C: per-sentence intervention plan
    promptContract.js             Server-side system prompt (Section 12) + optional chunk context
    preservation.js                Pass E: post-generation preservation audit
    pipeline.js                      Orchestrates A-F; the ONE path used by single-paragraph AND chunked input
    detectorQA.js                      Manual-only detector orchestrator; NEVER imported by pipeline.js
    detectorProviders/gptzero.js         The one detector with a real public API
    corpusEngine.js                    Coverage-density + hierarchical fallback   (Phase 2)
    styleProfileStore.js                 Adapter: corpusEngine -> pipeline's expected shape
    documentMap.js                        Heading/glossary/citation map for a whole document   (Phase 3)
    chunker.js                              Heading- or paragraph-boundary chunking               (Phase 3)
    jobStore.js                               In-memory background job store + reassembly            (Phase 3)
    cadenceDeviation.js                         Sentence-rhythm vs. corpus-family range   (Phase 4 seed)
  data/
    corpusDocuments.js       52 real per-document evidence records         (Phase 2)
public/                    Editor UI + Methodology / Detector QA / Long Document tabs (plain HTML/CSS/JS)
tests/
  fixtures/detector-benchmark/  2 labeled documents (AI-described, human-described)   (Phase 4 seed)
                             node:test suite, runs without any API key
```

`pipeline.js` remains the only entry point into generation — no separate
"demo" code path, and no separate code path for long documents either
(Section 18.2).

## Gate status (Section 22 of the handoff)

| Gate | Description | Status |
|---|---|---|
| 0 — app shell | Starts with no key, shows `NOT_CONFIGURED` | **Passes**, verified live. |
| 1 — API connection | Real key → `READY`; bad key → `AUTH_FAILED` visibly; key never reaches the browser | **Passes**, verified live with a real Anthropic key (`READY`) and a deliberately corrupted key (`AUTH_FAILED`), then the real key was restored. |
| 2 — arbitrary unseen rewrite | Paste new text, get a real (non-echoed) revision through the production path | **Passes**, verified live on multiple passages never used in development, through `/api/rewrite`. |
| 3 — structural rewriting | Deep/Moderate/Auto must show real structural operations, not just synonym swaps | **Passes**, verified live: a 5-sentence formulaic passage was collapsed into 3 restructured sentences in Deep mode, with citation and all three numeric values preserved exactly. |
| 4 — preservation | Numbers, citations, coefficients, technical terms survive revision | **Passes** — automatically, independent of the LLM (`tests/preservation.test.js`), and confirmed live: zero preservation warnings across every live test run. |
| 5 — intensity differentiation | Minor/Moderate/Deep must genuinely differ | **Passes**, verified live: the same formulaic passage produced different edit summaries and different prose in Minor vs. Deep mode (Minor kept 2 sentences unchanged; Deep restructured all but the numeric sentence). |
| 6 — evidence-backed styles | Selectors load from a real store; sparse narrow request triggers visible fallback, not a fabricated profile | **Passes**, verified live: a UK/PhD/Finance/quantitative/discussion request correctly resolved against 12 real sources with an honest fallback message (see "What Phase 2 added" above). |
| 7 — long document | Chunked jobs, progress, retry | **Passes**, verified live: a 3-section document processed as 4 chunks, one failed-chunk retry path is unit-tested (`tests/jobStore.test.js`), and terminology/citations stayed consistent across chunks (document-level audit, zero warnings). |
| 8 — diagnostics | Writing-quality flags hit real spans, no invented detector score | **Passes for what's built.** No 0-100 "AI score" anywhere in this codebase. A first real evidence-grounded flag exists (cadence deviation, verified against 2 labeled fixtures — see "What this update added" above), explicitly labeled experimental and not a score. Full calibration is still Phase 4 territory requiring a real benchmark this build doesn't have (Section 21.2). The Detector QA module separately reports raw third-party outputs, unedited, never a synthesized score of our own. |
| 9 — similarity | Real matches on a copied fixture, no fabricated matches on a clean one | **Not built.** Explicitly Phase 5; needs a licensed/indexed provider. |
| 10 — failure UX | Timeout/error/rate-limit handled gracefully, source text never lost, no infinite spinner | **Passes.** Bounded backoff on transient errors only, `AUTH_FAILED` never retried, specific error shown, source pane never cleared. Same discipline now applies to the detector adapter (`NOT_CONFIGURED`/`AUTH_FAILED`/etc., no indefinite spinner on a scan). |

## What's real vs. not built (Section 27 deliverable)

**Real and working today, no key needed:**
- Editor UI, controls, Changes / Writing Quality / Preservation / Style Profile / Methodology / Detector QA / Long Document tabs
- `/api/health`, `/api/health/llm`, `/api/health/detectors`, `/api/analyse`, `/api/style-profiles`, `/api/methodology`
- Full coverage-density engine and fallback ladder over the real 52-document dataset
- Preservation audit logic (per-chunk and whole-document)
- Detector QA request/response plumbing, defensive response parsing, and the hard boundary keeping it out of the generation path
- Document map extraction, chunking, and job-store state machine (job creation gracefully fails every chunk with a clear `NOT_CONFIGURED` error and still reassembles losing nothing, when no LLM key is present — `tests/jobStore.test.js`)
- Cadence-deviation diagnostic, regression-tested against 2 real labeled fixtures
- 48 automated tests, all passing

**Real code, confirmed working live with a real `ANTHROPIC_API_KEY`:**
- `/api/rewrite` end to end — Gates 1, 2, 3, 5, 6 above were run against a live Anthropic account during this build, not just unit-tested
- `/api/jobs` end to end (Phase 3) — a real 3-section, multi-citation, abbreviation-carrying document was processed, polled to completion, and its reassembled output and document-level preservation audit inspected (see "What Phase 3 added" above)
- `/api/analyse`'s `cadence_deviation` field — confirmed live against the AI-described fixture through a running server

**Real code, not yet exercised against a live account:**
- `/api/detector-scan` and the GPTZero adapter — logic is implemented and unit-tested against fixture responses (`tests/detectorQA.test.js`), but this build has not been run against a real `GPTZERO_API_KEY`. The response normalizer is intentionally defensive (see above) precisely because that live check hasn't happened yet.

**Not implemented — explicitly out of scope for Phases 1-3, only seeded for Phase 4:**
- Calibrated AI-pattern/formulaicity score — cadence deviation is a first real flag, not a score, and not calibrated (needs the Section 21.2 benchmark)
- Sentence-level UI highlighting of flagged spans (Phase 4)
- Similarity/plagiarism checker (Phase 5)
- Citation/reference reconciliation and DOI verification (Phase 6)
- Auth, billing, rate limiting, monitoring, backups (Phase 7) — including a real persistent job queue; the current job store is in-memory/single-process
- Personal style-profile upload (Section 7.3) — corpus-side coverage engine is done; per-user sample blending is not
- A Turnitin adapter — will never be built as a real integration; there is no public API to build it against
- Concurrent chunk processing — chunks currently process one at a time within a job

## Known limitations

- **Discipline/region/research-mode tags in `corpusDocuments.js` are this build's manual classification** of the one-line descriptions in the corpus note, not an independent re-read of each source document. Where the corpus note gave no explicit signal, `researchMode` is `"unspecified"` rather than guessed — see the file's own honesty notes and each record's `researchModeBasis`.
- **Strength thresholds (`insufficient` / `emerging` / `supported`) are a configurable constant** (`STRENGTH_THRESHOLDS` in `corpusEngine.js`), explicitly not empirically calibrated — see Section 10.2's warning against pretending otherwise.
- **`section` is never used to narrow a coverage match** — the corpus note records evidence per document, not per section, so a `section` filter is always dropped (visibly, with a stated reason) rather than silently ignored or fabricated.
- Sentence splitting is regex-based, not a full NLP sentence-boundary model.
- Preservation checks are exact-substring based; a legitimate rewording of a citation's surrounding grammar can trip a false-positive warning that needs human review.
- No datastore/persistence — nothing is saved between requests (Section 6.4/20, not implemented).
- `evidence_alignment` diagnostics (citation-to-claim linking) is still a stub (`[]`).
- This is a 52-document, UK/Accounting-Finance/PhD-concentrated corpus. A cell reading "supported" means well-evidenced *relative to this corpus*, not validated at commercial scale — Section 10.3's list of needed expansion (African universities beyond the current 2 sources, Master's-level work, non-Accounting/Finance disciplines, qualitative/experimental modes, H3 contemporary sources) is still entirely open.

## Known limitations (Detector QA)

- Not yet run against a live GPTZero account — see "Real code, not yet exercised against a live account" above. Get a `GPTZERO_API_KEY` and run `npm run qa:detector` to close this gap.
- Only one provider is genuinely reachable. This is a corpus-access constraint, not a code limitation: no other major detector publishes a public developer API either, and none will be faked here.
- `normalizeGptZeroResponse` was written from general knowledge of GPTZero's API shape, not verified against a current live response — that's exactly why it's defensive (`parseWarning` on anything unrecognized) rather than confidently asserting fields that might not match the real current schema.

## Known limitations (Phase 3)

- The job store is in-memory and single-process — a server restart loses all in-flight and completed jobs. Real durability needs Phase 7's persistent queue/worker (Section 18.1).
- Chunks process sequentially, not concurrently.
- Heading detection is regex-based (Markdown, numbered, ALL-CAPS) and will miss non-standard heading styles; those documents fall back to paragraph-group chunking, which still works but doesn't get heading-verbatim preservation or section-scoped context.
- The document-level consistency pass checks that protected spans (citations/numbers/quotes/acronyms) survive across chunk boundaries. It does not check for more subtle cross-chunk issues, like the same acronym being expanded two different ways in two different chunks — that would need a stronger terminology-consistency checker than currently exists.

## Known limitations (Phase 4 seed)

- **The benchmark is 2 documents.** Every number in "What this update added" is descriptive of this one pair, not a statistically validated finding. Do not present the 15%/margin constants in `cadenceDeviation.js` as calibrated — they are reasonable starting margins, explicitly not fit to data (Section 10.2's warning applies here too).
- **Both fixtures are unverified self-reports.** This build has no independent way to confirm the AI-described sample was actually AI-generated or that the human-described sample had no AI assistance — they're labeled as the product owner described them, and that provenance is recorded, not hidden.
- **Only sentence-length cadence is covered.** Section 15.1's fuller list (repeated structural templates, vague evidence claims, citation anomalies, low local syntactic variation) is untouched. The AI sample's most distinctive tell noticed during this build — every subsection following an identical developed-economies → Asia → Africa → Nigeria template — is exactly the kind of structural-repetition signal this module does NOT yet catch.
- **One discipline, one register.** Both fixtures are business/finance thesis chapters. Section 21.2's requirement for multiple disciplines and both short and long texts is still open.

## Next phase

Continue Phase 4 (Section 25): the most valuable next step is growing
`tests/fixtures/detector-benchmark/` — more labeled pairs, more
disciplines, human-edited AI text, second-language human writers, short
texts — toward the real benchmark Section 21.2 describes, followed by a
structural-template-repetition diagnostic (the gap this build's own
analysis surfaced) and eventually calibration. Do not build a scoring UI
ahead of having a real benchmark (Section 15.2). Do not start Phase 5/6
(similarity, citations) before that. Do not expand corpus coverage claims
without adding real new source documents to `corpusDocuments.js`. Do not,
at any phase, add a code path that feeds a Detector QA result, or a
cadence-deviation flag, back into `/api/rewrite`'s generation loop, or a
long-document job's per-chunk generation loop — that boundary is
load-bearing for the reasons in Section 15.4.
