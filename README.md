# Davis Academic Voice Engine — Phase 2

Real build against the *Academic Writing & Research Style Engine — Master
Build Handoff* (7 Aug 2026). Phase 1 built the multi-pass rewrite pipeline;
Phase 2 (this update) replaces the two hand-typed "style family" rows from
Phase 1 with a real coverage-density engine computed over an actual
52-document evidence dataset transcribed from `Davis_Academic_Language_Corpus_v0.1.md`
(Baseline v0.9, Batches 1-9). See Section 25 for the phase plan.

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

25 tests pass, covering everything that doesn't require a live model call:
protected-span extraction, the preservation audit, the intervention
planner, and — new in Phase 2 — the coverage-density engine and the
hierarchical fallback ladder over the real corpus dataset.

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
  lib/
    llmProvider.js          Server-side-only Anthropic adapter + health check states
    protect.js                Pass A: citations/numbers/quotes/acronyms extraction
    diagnostics.js             Pass B: rule-based writing-quality diagnostics
    planner.js                   Pass C: per-sentence intervention plan
    promptContract.js             Server-side system prompt (Section 12)
    preservation.js                Pass E: post-generation preservation audit
    pipeline.js                      Orchestrates A-F; the ONE path used by demo and real input
    corpusEngine.js                    Coverage-density + hierarchical fallback   (Phase 2)
    styleProfileStore.js                 Adapter: corpusEngine -> pipeline's expected shape
  data/
    corpusDocuments.js       52 real per-document evidence records         (Phase 2)
public/                    Two-pane editor UI + Methodology tab (plain HTML/CSS/JS)
tests/                     node:test suite, runs without any API key
```

`pipeline.js` remains the only entry point into generation — no separate
"demo" code path (Section 18.2).

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
| 7 — long document | Chunked jobs, progress, retry | **Not built.** Explicitly Phase 3. |
| 8 — diagnostics | Writing-quality flags hit real spans, no invented detector score | **Passes for what's built.** No 0-100 "AI score" anywhere in this codebase (Phase 4 territory, requires calibration this build doesn't have). |
| 9 — similarity | Real matches on a copied fixture, no fabricated matches on a clean one | **Not built.** Explicitly Phase 5; needs a licensed/indexed provider. |
| 10 — failure UX | Timeout/error/rate-limit handled gracefully, source text never lost, no infinite spinner | **Passes.** Bounded backoff on transient errors only, `AUTH_FAILED` never retried, specific error shown, source pane never cleared. |

## What's real vs. not built (Section 27 deliverable)

**Real and working today, no key needed:**
- Editor UI, controls, Changes / Writing Quality / Preservation / Style Profile / Methodology tabs
- `/api/health`, `/api/health/llm`, `/api/analyse`, `/api/style-profiles`, `/api/methodology`
- Full coverage-density engine and fallback ladder over the real 52-document dataset
- Preservation audit logic
- 25 automated tests, all passing

**Real code, confirmed working live with a real `ANTHROPIC_API_KEY`:**
- `/api/rewrite` end to end — Gates 1, 2, 3, 5, 6 above were run against a live Anthropic account during this build, not just unit-tested

**Not implemented — explicitly out of scope for Phases 1-2:**
- Long-document chunking/job queue (Phase 3)
- Calibrated AI-pattern/formulaicity score (Phase 4)
- Similarity/plagiarism checker (Phase 5)
- Citation/reference reconciliation and DOI verification (Phase 6)
- Auth, billing, rate limiting, monitoring, backups (Phase 7)
- Personal style-profile upload (Section 7.3) — corpus-side coverage engine is done; per-user sample blending is not

## Known limitations

- **Discipline/region/research-mode tags in `corpusDocuments.js` are this build's manual classification** of the one-line descriptions in the corpus note, not an independent re-read of each source document. Where the corpus note gave no explicit signal, `researchMode` is `"unspecified"` rather than guessed — see the file's own honesty notes and each record's `researchModeBasis`.
- **Strength thresholds (`insufficient` / `emerging` / `supported`) are a configurable constant** (`STRENGTH_THRESHOLDS` in `corpusEngine.js`), explicitly not empirically calibrated — see Section 10.2's warning against pretending otherwise.
- **`section` is never used to narrow a coverage match** — the corpus note records evidence per document, not per section, so a `section` filter is always dropped (visibly, with a stated reason) rather than silently ignored or fabricated.
- Sentence splitting is regex-based, not a full NLP sentence-boundary model.
- Preservation checks are exact-substring based; a legitimate rewording of a citation's surrounding grammar can trip a false-positive warning that needs human review.
- No datastore/persistence — nothing is saved between requests (Section 6.4/20, not implemented).
- `evidence_alignment` diagnostics (citation-to-claim linking) is still a stub (`[]`).
- This is a 52-document, UK/Accounting-Finance/PhD-concentrated corpus. A cell reading "supported" means well-evidenced *relative to this corpus*, not validated at commercial scale — Section 10.3's list of needed expansion (African universities beyond the current 2 sources, Master's-level work, non-Accounting/Finance disciplines, qualitative/experimental modes, H3 contemporary sources) is still entirely open.

## Next phase

Phase 3 (Section 25): long-document chunking — document map, section-boundary
chunking, shared glossary/style state across chunks, progress/retry, format-
and citation-order-preserving reassembly. Do not start Phase 4/5/6
(diagnostics score, similarity, citations) before that, and do not expand
corpus coverage claims without adding real new source documents to
`corpusDocuments.js` — the coverage engine's honesty depends on the
dataset staying accurate.
