// Diagnosis-aware wrapper around intent-discourse-v4.
// Diagnosis chooses WHAT kind of intervention a passage needs. The researcher-selected
// mode determines HOW MUCH authority the engine has to execute that intervention.
// Deep Authorial additionally changes the unit of work: preserve the research ledger,
// then rebuild prose from propositions/evidence rather than paraphrasing source sentences.

import { buildInterventionPlan as buildV4Plan } from "./planner.js";

function deepAuthorialProtocol() {
  return [
    "DEEP AUTHORIAL V4 EXECUTION PROTOCOL: this is not a sentence-by-sentence paraphrase pass. Before drafting each substantive paragraph, recover its protected proposition/evidence ledger: claim(s), evidence/citation attachment, qualification/condition, measurement distinction, mechanism, setting/time context, and rhetorical purpose. Reconstruct from that ledger rather than walking through the source sentence shells in order.",
    "PRESERVE RESEARCH, NOT SURFACE PACKAGING: factual meaning, citations, statistics, variables, hypotheses, methods, chronology, study stage, technical terminology and epistemic strength are immutable. Sentence boundaries, grammatical subjects, clause order, local information packaging and paragraph development are available for reconstruction where the paragraph plan authorises it.",
    "NUMERIC RELATIONSHIPS ARE ATOMIC: copy protected years, year ranges, sample-size ranges, percentages, monetary values and statistical notation without changing their relationship. In particular, a range such as 2015-2024 or 10-15 must never become two comma-separated values such as 2015, 2024 or 10, 15. Preserve the exact source range string when possible.",
    "DO NOT USE SYNONYM DISTANCE AS THE METHOD: replacing rely with depend, important with salient, proposes with advances, or similar lexical recoding is not Deep Authorial execution when the original sentence architecture and paragraph choreography remain recognisable. Prefer ordinary precise academic wording; structural redevelopment must come from reasoning and information organisation.",
    "BREAK SOURCE SENTENCE ALIGNMENT WHERE WARRANTED: one source sentence may supply material to two revised sentences; two or three source sentences may become one analytical unit; a citation-bearing evidential sentence may remain concise while its interpretation moves to a neighbouring sentence. Do not preserve a one-source-sentence -> one-revised-sentence mapping across most substantive prose.",
    "VARY RHETORICAL TRAJECTORY BY FUNCTION, NOT RANDOMNESS: descriptive/context paragraphs may accumulate facts before interpretation; literature paragraphs may juxtapose studies and delay synthesis; conditional findings may foreground the condition; gap paragraphs may accumulate unresolved tensions before narrowing the gap; purpose/method paragraphs should state specifications directly. Do not force every paragraph through topic sentence -> evidence -> interpretation -> polished implication.",
    "ALLOW UNEVEN EMPHASIS: not every paragraph needs a closing synthesis sentence, not every evidence cluster needs an immediate takeaway, and not every sentence must be a self-contained mini-abstract. Some paragraphs may end on evidence, a limitation, a condition, a measurement distinction or an unresolved tension that the next paragraph carries forward.",
    "SUPPRESS EDITORIAL CHOREOGRAPHY: avoid repeated constructions such as 'The salient question...', 'This study/prospectus advances...', 'Prior evidence therefore...', 'In other words...', 'Taken together...', or equivalent tidy summary frames when they are not required by the actual argument. No phrase is banned absolutely; repeated editorial preference across paragraphs is the defect.",
    "SECTION REGISTER MATTERS: problem statements, purpose statements, research questions, hypotheses, operational definitions and methods should remain direct and institutionally recognisable. Do not humanise formal artefacts by rhetorical embellishment. Literature/background prose can carry more varied discourse movement because its job is argumentative rather than formularised.",
    "DEEP DOES NOT MEAN LEXICALLY GRANDER: do not inflate nominalisations, stack abstract nouns, or make every sentence denser. A stronger reconstruction may use simpler verbs, shorter evidential statements, delayed interpretation, or a longer qualified sentence where the reasoning actually requires it.",
    "FINAL SELF-CHECK BEFORE RETURNING: ask whether the candidate is essentially the same paragraph sequence with cleaner synonyms and recast clauses. If yes, the Deep Authorial operation is under-executed. Rebuild the authorised substantive paragraphs from the proposition/evidence ledger while retaining all protected research content.",
    "EXTERNAL CLASSIFIERS ARE DIAGNOSTIC ONLY: do not target a detector score, insert errors, conceal machine provenance, or use tricks. The objective is defensible, heterogeneous, author-like academic discourse produced by better reasoning architecture and fidelity, not score gaming.",
  ];
}

export function buildDiagnosisScopedPlan(diagnostics, options = {}) {
  const requestedNaturalisation = String(options.naturalisation || "faithful").toLowerCase();
  const requestedLength = String(options.lengthPreference || "auto").toLowerCase();
  const requestedIntensity = String(options.rewriteIntensity || "auto").toLowerCase();
  const authorialAuthority = requestedIntensity === "deep" && ["aggressive", "authorial"].includes(requestedNaturalisation);

  // Minor/Moderate remain ceilings. Auto remains diagnostic. Deep is different:
  // when the researcher explicitly combines Deep with Aggressive/Authorial, the
  // planner must receive that authority instead of silently downgrading it to Auto
  // + Faithful. The v4 planner still diagnoses paragraph operations and protects
  // headings, quotations, evidence-bearing content and technical material.
  const diagnosticIntensity = requestedIntensity;
  const plannerNaturalisation = requestedNaturalisation === "off"
    ? "off"
    : authorialAuthority
      ? "aggressive"
      : requestedNaturalisation === "aggressive" && requestedIntensity !== "minor"
        ? "aggressive"
        : "faithful";

  const plan = buildV4Plan(diagnostics, {
    ...options,
    rewriteIntensity: diagnosticIntensity,
    naturalisation: plannerNaturalisation,
    // Expansion is still evidence/argument driven. Deep Authorial may reconstruct
    // clean prose, but Expand does not become a quota to lengthen every sentence.
    lengthPreference: requestedLength === "concise" ? "concise" : requestedLength === "expand" ? "expand" : "maintain",
  });

  plan.intensity = requestedIntensity;
  plan.diagnosticIntensity = diagnosticIntensity;
  plan.naturalisation = requestedNaturalisation;
  plan.lengthPreference = requestedLength;
  plan.authorialAuthorityActive = authorialAuthority;
  plan.scopePolicyVersion = authorialAuthority
    ? "proposition-led-authorial-reconstruction-v4"
    : "diagnosis-guided-authority-v4";
  plan.scopePrinciples = [
    "Diagnosis selects the rhetorical/argument operation; the researcher-selected mode supplies the intervention authority.",
    "Minor remains local and restrained; Moderate remains selective; Deep permits structural redevelopment.",
    "Deep + Aggressive/Authorial authorises paragraph-level discourse reconstruction even where individual sentences are technically clean, while preserving research meaning, evidence and formal artefacts.",
    "A Deep/Authorial request must not be silently collapsed into Faithful local polishing merely because an isolated chunk looks grammatically acceptable.",
    "Expand develops diagnosed reasoning, evidence, qualification, context, measurement or gap work; it is not a word-growth quota.",
    "Keep decisions remain legitimate for quotations, headings, equations, technical labels and genuinely author-specific passages; they are not a blanket licence to leave most substantive prose untouched in a Deep/Authorial job.",
    ...(authorialAuthority ? deepAuthorialProtocol() : []),
  ];
  plan.documentGuidance = [
    ...(plan.documentGuidance || []),
    ...plan.scopePrinciples,
  ];
  plan.intent = {
    ...plan.intent,
    rationale: [
      ...(plan.intent?.rationale || []),
      authorialAuthority
        ? "Deep Authorial authority is active: reconstruct from protected propositions, evidence relationships and rhetorical purpose rather than performing sentence-aligned paraphrase. Preserve the research; sentence architecture is not the fidelity target."
        : requestedIntensity === "deep"
          ? "Deep structural authority is active, but the selected naturalisation level remains restrained unless the researcher also chose Aggressive/Authorial treatment."
          : null,
      requestedNaturalisation === "aggressive" && requestedIntensity !== "minor"
        ? "Aggressive treatment is allowed to execute paragraph-level reconstruction within the selected intensity ceiling."
        : null,
      requestedLength === "expand"
        ? "Expand is permission to develop diagnosed intellectual work from available content/evidence; no global word-growth quota is created."
        : null,
    ].filter(Boolean),
  };
  return plan;
}
