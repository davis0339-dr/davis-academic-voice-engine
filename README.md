# Davis Academic Voice Engine — Phase 1

This is a real Phase-1 build against the *Academic Writing & Research Style
Engine — Master Build Handoff* (7 Aug 2026). It replaces a previous
chat-builder prototype that looked complete but only changed a couple of
words on arbitrary input (see Section 23 of the handoff for that
diagnosis). This build follows Section 25 Phase 1 scope only: a real
editor, a real multi-pass server-side rewrite pipeline, real preservation
checks, and honest service-health states — not detector/similarity/citation
features, which are explicitly out of scope until later phases.

## Run it

```bash
npm install
cp .env.example .env      # leave ANTHROPIC_API_KEY blank to start
npm run dev                # http://localhost:3000
```

The app starts and the editor loads with **no API key set** — the status
badge in the top bar will show "LLM: not configured" rather than hanging.
This is Gate 0 in Section 22 of the handoff, and it's intentional: adding a
real key is step 5 of the build order in Section 19.2, not a prerequisite
for standing up the app.

To enable real revisions, put a real Anthropic API key in `.env`
(`ANTHROPIC_API_KEY=...`) and restart. The key is read server-side only
(`server/lib/llmProvider.js`); it is never sent to the browser, logged, or
embedded in any client-visible file — you can confirm this yourself by
opening the Network tab while using the app.

## Run the test suite (no API key required)

```bash
npm test
```

18 tests currently pass, covering the parts of the pipeline that don't
require a live model call: protected-span extraction, the preservation
audit, the intervention planner, and the style-profile fallback logic.
These are real assertions against real module code, not smoke tests.

## Architecture

```
server/
  index.js              Express app, mounts routes, serves public/
  routes/
    health.js            GET /api/health, GET /api/health/llm
    styleProfiles.js      GET /api/style-profiles
    analyse.js            POST /api/analyse   (Passes A-C, no LLM call)
    rewrite.js             POST /api/rewrite    (Passes A-F, calls the LLM)
  lib/
    llmProvider.js        Server-side-only Anthropic adapter + health check states
    protect.js             Pass A: citations/numbers/quotes/acronyms extraction
    diagnostics.js          Pass B: rule-based writing-quality diagnostics
    planner.js               Pass C: per-sentence intervention plan
    promptContract.js         Server-side system prompt (Section 12)
    preservation.js            Pass E: post-generation preservation audit
    pipeline.js                  Orchestrates A-F; the ONE path used by demo and real input
    styleProfileStore.js          Section 7 evidence-backed profiles + hierarchical fallback
public/                    Two-pane editor UI (plain HTML/CSS/JS, no build step)
tests/                     node:test suite, runs without any API key
```

`pipeline.js` is deliberately the only entry point into generation — there
is no separate "demo" code path, per Section 18.2's "no fake production
functions" rule.

## Gate status (Section 22 of the handoff)

| Gate | Description | Status |
|---|---|---|
| 0 — app shell | Starts with no key, shows `NOT_CONFIGURED` | **Passes.** Verified by booting the server with `.env` empty and hitting `/api/health/llm`. |
| 1 — API connection | Real key → `READY`; bad key → `AUTH_FAILED` visibly; key never reaches the browser | **Code complete, needs your real key to verify live.** The health states, the 401→`AUTH_FAILED` mapping, and the server-only key handling are implemented and covered by manual inspection instructions above. Not yet exercised against a live Anthropic account from this environment. |
| 2 — arbitrary unseen rewrite | Paste new text, get a real (non-echoed) revision through the production path | **Code complete, needs a live key to run end-to-end.** `/api/rewrite` and `/api/analyse` share one pipeline; there is no hard-coded sample response anywhere in the code. |
| 3 — structural rewriting | Deep/Moderate/Auto must show real structural operations, not just synonym swaps | **Planner logic verified by test** (`tests/planner.test.js` proves Deep/Auto escalate flagged sentences to `SENTENCE_RESTRUCTURE`/`SPLIT_OR_MERGE`, not `MICRO_EDIT`). The LLM's actual prose output still needs a live-key run to confirm the model honors the plan — the prompt contract instructs it to, but that's provider behavior, not something a unit test can prove. |
| 4 — preservation | Numbers, citations, coefficients, technical terms survive revision | **Passes automatically**, independent of any LLM (`tests/preservation.test.js`), and re-runs on every real `/api/rewrite` call. |
| 5 — intensity differentiation | Minor/Moderate/Deep must genuinely differ | **Passes.** `tests/planner.test.js` proves Minor never issues `SENTENCE_RESTRUCTURE` while Deep does, on the same input. |
| 6 — evidence-backed styles | Selectors load from a real store; sparse narrow request triggers visible fallback, not a fabricated profile | **Passes.** `tests/styleProfileStore.test.js` covers both the supported-family case and the fallback case; `GET /api/style-profiles` serves the same store the UI reads from. |
| 7 — long document | Chunked jobs, progress, retry | **Not built.** Explicitly Phase 3 (Section 25). Current pipeline handles single-request passages only. |
| 8 — diagnostics | Writing-quality flags hit real spans, no invented detector score | **Passes for what's built.** `diagnose()` flags real sentence indices for formulaic phrasing/monotony/transition-stacking; there is no 0-100 "AI score" anywhere in this codebase, because Section 15.2 forbids showing one before calibration, and no calibrated detector exists yet (that's Phase 4). |
| 9 — similarity | Real matches on a copied fixture, no fabricated matches on a clean one | **Not built.** Explicitly Phase 5 (Section 25); requires a licensed/indexed provider this build doesn't have. |
| 10 — failure UX | Timeout/error/rate-limit handled gracefully, source text never lost, no infinite spinner | **Passes.** `routes/rewrite.js` maps provider failures to specific HTTP codes and messages, retries only transient states with bounded backoff, and never retries `AUTH_FAILED`. The UI shows the specific error in the status bar; the source pane is never cleared on failure. |

## What's real vs. not built (Section 27 deliverable)

**Real and working today, no key needed:**
- Editor UI, two-pane layout, all controls
- `/api/health`, `/api/health/llm` with the full enumerated state set
- `/api/analyse` (Passes A-C): protected-span extraction, rule-based diagnostics, per-sentence intervention plan
- `/api/style-profiles` + hierarchical fallback logic
- Preservation audit logic (runs against any text, LLM or not)
- 18 automated tests

**Real code, needs a live `ANTHROPIC_API_KEY` to exercise end-to-end:**
- `/api/rewrite` (Pass D generation call + Pass E preservation audit on the real output)
- Gate 1, 2, 3's live-model half

**Not implemented — explicitly out of Phase 1 scope, do not build ahead of this:**
- Long-document chunking/job queue (Phase 3)
- Calibrated AI-pattern/formulaicity score (Phase 4) — only rule-based writing-quality flags exist
- Similarity/plagiarism checker (Phase 5) — no comparison corpus/provider is wired up
- Citation/reference reconciliation and DOI verification (Phase 6)
- Auth, billing, rate limiting, monitoring, backups (Phase 7)
- Personal style-profile upload (Section 7.3)

## Known limitations

- Sentence splitting is regex-based, not a full NLP sentence-boundary model; unusual punctuation can mis-split.
- Preservation checks are exact-substring based. A legitimate rewording of a citation's surrounding grammar (e.g. converting parenthetical to narrative form) can trip a false-positive warning — that's the intentional trade-off (Section: "false warning preferable to silent trust"), but it means warnings need human review, not blind rejection.
- Only two style-profile families are marked `supported` (global default, thesis/dissertation). This is deliberate, not a bug: Section 10.2 explicitly forbids pretending a narrower evidence threshold has been calibrated when it hasn't. Expanding coverage requires the Phase 2 ingestion pipeline in Section 10.1, which is not built here.
- No datastore/persistence yet — nothing is saved between requests. Section 6.4 (document/history screen) and Section 20 (retention/deletion) are not implemented.
- `evidence_alignment` diagnostics (citation-to-claim linking) is a stub (`[]`) — this needs real citation-parsing work beyond regex, not yet built.

## Next phase

Per Section 25: Phase 2 (corpus runtime — real coverage-density calculation
instead of the two hand-seeded families, personal style-profile upload,
methodology screen) is the natural next step, followed by Phase 3
(long-document chunking). Do not start Phase 4/5/6 (diagnostics score,
similarity, citations) before Phase 1's live-key gates (1-3) have actually
been run against a real Anthropic key and confirmed to pass on unseen text.
