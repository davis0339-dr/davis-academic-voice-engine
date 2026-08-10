# Authorial Texture Diagnostic Redesign

Status: implementation directive

## Blocking problem

The current planner must not treat clarity, grammatical correctness, academic sophistication, citation density, readability, or logical sequencing as direct evidence of strong authorial texture. Those are quality/coherence signals. If they inflate texture strength, polished LLM-assisted academic prose will be over-preserved and meaningful expressive reconstruction will be suppressed.

## Required conceptual separation

The diagnostic layer must score these constructs independently:

1. **Surface Quality** — grammar, clarity, readability, terminology, formal academic correctness.
2. **Discourse Coherence** — logical progression, local flow, paragraph continuity, referential continuity.
3. **Argumentative Sufficiency** — whether claims, mechanisms, evidence, qualifications, measures, context, time and research gap are adequately developed.
4. **Authorial Texture** — observable individuality and natural rhetorical variation in how the argument is expressed.
5. **Machine-Pattern Regularity** — observable structural regularity, template recurrence and predictable discourse behaviour. This is a textual-pattern diagnostic, not an authorship classifier.

## Authorial texture must be evidence-based

Positive texture signals may include:

- non-template sentence architecture variation;
- meaningful variation in rhetorical function and sentence role;
- natural short/long sentence interaction driven by argument rather than randomness;
- locally distinctive phrasing tied to the substantive argument;
- non-mechanical transitions, including justified implicit transitions;
- variable evidence packaging where different studies are handled differently because their argumentative roles differ;
- calibrated epistemic behaviour (qualification, limitation, contrast, inference, implication) used contextually rather than formulaically;
- paragraph-shape diversity that still remains coherent;
- preservation-worthy authorial asymmetry or local rhetorical decisions.

The following MUST NOT independently raise Authorial Texture Strength:

- grammatical correctness;
- clarity;
- general readability;
- academic vocabulary sophistication;
- citation count/density;
- technical terminology;
- argument sophistication;
- generic coherence or logical sequence;
- absence of spelling/grammar errors.

## Machine-pattern regularity layer

Detect observable regularities such as:

- recurring sentence-opening shells;
- repeated claim -> evidence -> interpretation cycles;
- excessive paragraph-shape uniformity;
- repeated transition templates;
- recurring clause packaging;
- uniform sentence closure behaviour;
- high syntactic recurrence;
- repeated reporting-verb structures;
- generic academic connective density;
- low rhetorical asymmetry;
- repeated local cadence patterns;
- over-regular evidence presentation.

Do not label prose as AI-authored. Report the detected textual regularity itself.

## Preservation redesign

Preservation must split into two independent decisions:

### Semantic preservation priority
Protect proposition, factual meaning, evidence, citations, numbers, variables, methods, theoretical relationships, qualifications, epistemic strength and the author's intellectual decisions.

### Expressive preservation priority
Protect wording, sentence architecture, paragraph packaging, cadence and rhetorical sequence only to the degree that genuine authorial texture is supported and machine-pattern regularity is low.

High Surface Quality must NEVER, by itself, restrict expressive reconstruction.

A polished but highly regular passage may therefore yield:

- Surface quality: High
- Discourse coherence: High
- Argument sufficiency: High
- Authorial texture: Low/Moderate
- Machine-pattern regularity: High
- Semantic preservation: Very High
- Expressive preservation: Low/Moderate

That state should permit substantial expressive reconstruction when the user's selected intensity allows it, without changing the underlying argument.

## Planner rule

Intensity is an intervention ceiling, not a change quota.

For every unit, calculate:

1. what may be changed given user authority;
2. what should be changed given diagnosis.

Deep/Authorial permission must not automatically convert clean units into DISCOURSE_REPACKAGE. KEEP remains legal in every mode, including Deep.

Recommended operation vocabulary:

- KEEP_STRONG
- KEEP_TECHNICAL
- KEEP_EVIDENCE
- MICRO_EDIT
- SENTENCE_RESTRUCTURE
- SPLIT_OR_MERGE
- DISCOURSE_REPACKAGE
- DEVELOP_CLAIM
- REBUILD_DISCOURSE

## Required planner sequence

TEXT UNDERSTANDING
-> PROPOSITION / EVIDENCE LEDGER
-> SURFACE QUALITY ASSESSMENT
-> AUTHORIAL TEXTURE ANALYSIS
-> DISCOURSE REGULARITY FORENSICS
-> ARGUMENTATIVE SUFFICIENCY
-> SEMANTIC PRESERVATION DECISION
-> EXPRESSIVE PRESERVATION DECISION
-> USER AUTHORITY RESOLUTION
-> INTERVENTION PLANNING
-> PARAGRAPH OPERATIONS
-> SENTENCE OPERATIONS
-> SURFACE REFINEMENT
-> ARGUMENT INTEGRITY AUDIT

## Acceptance tests before further user testing

1. A polished, coherent, citation-rich but template-regular passage must not receive Strong Authorial Texture merely because it is academically strong.
2. A rough but distinctive human-authored passage may receive low Surface Quality while retaining Moderate/High Authorial Texture.
3. High Surface Quality alone must not force High Expressive Preservation.
4. High Machine-Pattern Regularity must lower expressive-preservation pressure while leaving semantic preservation intact.
5. Deep + Authorial on a high-quality/high-regularity passage must allow structural reconstruction without changing propositions/evidence.
6. Deep + Authorial on a genuinely high-texture/low-regularity passage must still retain KEEP operations for clean units.
7. The UI must expose why texture was rated as it was: positive texture signals, regularity penalties/signals, and resulting preservation decisions.
8. No further planner evaluation should rely on a single opaque `Strong Existing Texture` percentage.

