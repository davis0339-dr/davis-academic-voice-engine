# Researcher Agency v1

## Product principle

The engine is not designed to evade authorship detection or make academic writing artificially rough. Its purpose is to preserve and develop researcher intellectual agency while using generative AI as a controlled collaborator.

The central design distinction is between:

1. **Language form** — who or what produced the present wording.
2. **Reasoning visibility** — whether the manuscript visibly contains claims, mechanisms, qualifications, choices, boundaries, interpretations and evidential relationships.
3. **Reasoning provenance** — where those intellectual decisions came from when an earlier draft or researcher interaction is available.

A final manuscript alone cannot reliably prove reasoning provenance. The Researcher Studio therefore records the reasoning process before final prose is reconstructed.

## Intellectual basis carried into the build

The design incorporates lessons from the project's human-written thesis/report corpus and the Edmond machine-writing material:

- Procedure matters, not merely textual output.
- Human/machine authorship can be collaborative rather than binary.
- Lexical substitution is not a substitute for argument development.
- Sentence and paragraph variation should follow rhetorical workload, not randomised burstiness.
- Meaningful irregularity should not be erased simply because it is uncommon.
- Epistemic strength must be preserved; `may suggest` must not silently become `demonstrates`.
- Literature synthesis should express relationships between sources rather than stack citations.
- Conceptual transitions are preferable to decorative transition phrases.
- The minimum necessary intervention remains the default revision policy.

## New Researcher Studio workflow

### 1. Explain what you really mean

The researcher supplies rough thoughts in ordinary language. The reasoning endpoint recovers an argument map rather than immediately writing polished prose.

Supported argument-node functions:

- claim
- mechanism
- qualification
- assumption
- counterargument
- interpretation
- implication
- boundary
- evidence need
- methodological choice

Each node records an origin (`researcher`, `system_suggestion`, or `shared`) and a researcher review status (`unreviewed`, `accepted`, `modified`, or `rejected`).

### 2. Researcher approval

The researcher can edit, accept, modify or reject nodes. Rejected nodes are excluded from controlled reconstruction. The system is therefore not allowed to treat its own suggested reasoning as automatically approved.

### 3. Evidence Workspace

The beta accepts up to eight sources. Source parsing currently supports:

- TXT / Markdown
- DOCX
- selectable-text PDF
- CSV
- XLSX

The file limit remains 5 MB per source. Evidence requests currently cap extracted source text at 40,000 characters per source so a project cannot turn every LLM call into an unbounded full-library prompt.

PDF page markers and Excel sheet markers are retained during import. XLSX parsing reads workbook data but does not execute formulas or macros. Macro-enabled workbooks are not accepted.

Evidence alignment occurs in two stages:

1. deterministic lexical retrieval narrows source passages against argument nodes;
2. the LLM conservatively classifies a retrieved passage as `supports`, `qualifies`, `contradicts`, `contextualises`, or `insufficient`.

If the LLM is not configured, retrieval still works but links remain unclassified candidates.

The engine must not invent a citation or pretend lexical overlap proves evidential support.

### 4. Challenge mode

Challenge mode asks at most two high-value questions. It targets material issues such as an unsupported mechanism, causal escalation, competing explanation, evidential mismatch, boundary ambiguity, or methodological implication.

The questions do not automatically alter the argument map. The researcher decides what to change.

### 5. Controlled academic reconstruction

Reconstruction is governed by the approved argument map, explicit researcher boundaries and accepted evidence links.

Hard constraints include:

- no invented citations;
- no unapproved variables, moderators, methods, findings or theoretical claims;
- no silent increase in causal or epistemic strength;
- no removal of qualifications merely for smoother prose;
- no compulsory paragraph symmetry;
- no artificial error injection or random sentence-length variation.

### 6. Argument Integrity Check

A later version edited by another LLM, supervisor, editor or grammar tool can be compared against the approved argument map.

The integrity audit looks for:

- preserved / strengthened / weakened / lost / contradicted argument nodes;
- new unlicensed claims;
- lost boundaries;
- changed causal or epistemic strength.

This is a reasoning-fidelity audit, not an AI detector.

## Detector policy

Live third-party detector integrations are disabled by design. The branch removes the GPTZero and Copyleaks provider modules, detector credentials, provider orchestration and live QA harness.

The Detector Research Lab remains for two purposes only:

1. first-party measurement of observable writing-pattern characteristics;
2. manual recording of external results that a researcher independently obtained elsewhere.

External detector observations are never automatically fed into generation.

## Security and resource controls

The Researcher Studio uses the existing same-origin, rate-limit and concurrency controls. New `/api/research/*` POST endpoints are treated as expensive operations and share the same cost/concurrency gate as rewrite and analyse operations.

Research material is request-scoped in this beta; the new API does not persist manuscripts, source text, argument maps or detector observations.

## What is deliberately not in v1

### Voice capture

Voice reasoning is a planned front end to the same argument-map endpoint, but it should not be added by quietly enabling browser/vendor speech services. The next implementation should include explicit microphone consent, a clear transcription privacy model and secure audio limits before the Permissions Policy is opened.

### PNG/JPG and scanned-PDF OCR

Image-only source ingestion is deliberately deferred until a bounded, isolated OCR path is selected. The current PDF importer rejects image-only PDFs rather than silently producing incomplete evidence.

### Large persistent evidence libraries

The beta does not yet maintain server-side projects or vector indexes. The eight-source limit is intentional. Larger project libraries should be introduced with persistent project storage, source provenance, chunk indexing, deletion controls and privacy retention rules rather than by simply raising request-size limits.

## QA strategy

The next testing corpus should include, at minimum:

- strong human-written academic sections;
- weak human-written drafts;
- human-origin text heavily polished by an LLM;
- LLM-origin text substantially corrected by a researcher;
- raw LLM academic text from multiple models;
- quantitative, qualitative and mixed-methods material;
- literature reviews, methodology, findings, discussion and introductions;
- multiple disciplines, regions and academic levels;
- source-grounded passages with supporting, contradictory and merely contextual evidence.

Evaluation should ask more than whether prose 'sounds human'. Test:

- core-claim preservation;
- qualification preservation;
- causal-strength preservation;
- evidence-to-claim fit;
- citation fidelity;
- argument progression;
- source-function diversity;
- intervention proportionality;
- researcher acceptance/rejection fidelity;
- false-positive risk in first-party pattern diagnostics;
- whether the reconstructed text is materially more useful than ordinary paraphrasing.

Human review remains essential. The engine should improve through versioned corpus evidence and regression tests, not by silently changing itself from uncontrolled user uploads.
