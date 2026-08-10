// Diagnosis-aware wrapper around intent-discourse-v4.
// Diagnosis chooses WHAT kind of intervention a passage needs. The researcher-selected
// intensity determines HOW DEEP the engine may go. Naturalisation changes HOW an
// authorised intervention is expressed; it must not manufacture structural need.

import { buildInterventionPlan as buildV4Plan } from "./planner.js";

function deepAuthorialProtocol() {
  return [
    "DEEP AUTHORIAL V4 EXECUTION PROTOCOL: this is not a sentence-by-sentence paraphrase pass. Before drafting each authorised substantive paragraph, recover its protected proposition/evidence ledger: claim(s), evidence/citation attachment, qualification/condition, measurement distinction, mechanism, setting/time context, and rhetorical purpose. Reconstruct from that ledger rather than walking through source sentence shells in order.",
    "PRESERVE RESEARCH, NOT AUTOMATICALLY SURFACE PACKAGING: factual meaning, citations, statistics, variables, hypotheses, methods, chronology, study stage, technical terminology and epistemic strength are immutable. Sentence boundaries, grammatical subjects, clause order, local information packaging and paragraph development are available for reconstruction only where diagnosis supports intervention.",
    "NUMERIC RELATIONSHIPS ARE ATOMIC: copy protected years, year ranges, sample-size ranges, percentages, monetary values and statistical notation without changing their relationship. In particular, a range such as 2015-2024 or 10-15 must never become two comma-separated values such as 2015, 2024 or 10, 15. Preserve the exact source range string when possible.",
    "DO NOT USE SYNONYM DISTANCE AS THE METHOD: replacing rely with depend, important with salient, proposes with advances, or similar lexical recoding is not Deep Authorial execution when the original sentence architecture and paragraph choreography remain recognisable. Prefer ordinary precise academic wording; structural redevelopment must come from reasoning and information organisation.",
    "BREAK SOURCE SENTENCE ALIGNMENT WHERE WARRANTED: one source sentence may supply material to two revised sentences; two or three source sentences may become one analytical unit; a citation-bearing evidential sentence may remain concise while its interpretation moves to a neighbouring sentence. Do not preserve a one-source-sentence -> one-revised-sentence mapping merely as a habit.",
    "VARY RHETORICAL TRAJECTORY BY FUNCTION, NOT RANDOMNESS: descriptive/context paragraphs may accumulate facts before interpretation; literature paragraphs may juxtapose studies and delay synthesis; conditional findings may foreground the condition; gap paragraphs may accumulate unresolved tensions before narrowing the gap; purpose/method paragraphs should state specifications directly. Do not force every paragraph through topic sentence -> evidence -> interpretation -> polished implication.",
    "ALLOW UNEVEN EMPHASIS: not every paragraph needs a closing synthesis sentence, not every evidence cluster needs an immediate takeaway, and not every sentence must be a self-contained mini-abstract. Some paragraphs may end on evidence, a limitation, a condition, a measurement distinction or an unresolved tension that the next paragraph carries forward.",
    "SUPPRESS EDITORIAL CHOREOGRAPHY: avoid repeated constructions such as 'The salient question...', 'This study/prospectus advances...', 'Prior evidence therefore...', 'In other words...', 'Taken together...', or equivalent tidy summary frames when they are not required by the actual argument. No phrase is banned absolutely; repeated editorial preference across paragraphs is the defect.",
    "SECTION REGISTER MATTERS: problem statements, purpose statements, research questions, hypotheses, operational definitions and methods should remain direct and institutionally recognisable. Do not naturalise formal artefacts by rhetorical embellishment. Literature/background prose can carry more varied discourse movement because its job is argumentative rather than formularised.",
    "DEEP DOES NOT MEAN LEXICALLY GRANDER: do not inflate nominalisations, stack abstract nouns, or make every sentence denser. A stronger reconstruction may use simpler verbs, shorter evidential statements, delayed interpretation, or a longer qualified sentence where the reasoning actually requires it.",
    "CAN CHANGE IS NOT SHOULD CHANGE: Deep/Authorial supplies broad permission, not a quota. A technically clean sentence or paragraph may still be kept when its authorial texture is genuine and no discourse-regularity or argumentative diagnosis warrants intervention.",
    "FINAL SELF-CHECK BEFORE RETURNING: for paragraphs actually authorised for reconstruction, ask whether the candidate is essentially the same paragraph sequence with cleaner synonyms and recast clauses. If yes, the authorised Deep Authorial operation is under-executed. Rebuild that authorised material from the proposition/evidence ledger while retaining all protected research content.",
    "EXTERNAL CLASSIFIERS ARE DIAGNOSTIC ONLY: do not target a detector score, insert errors, conceal machine provenance, or use tricks. The objective is defensible, heterogeneous, author-like academic discourse produced by better reasoning architecture and fidelity, not score gaming.",
  ];
}

export function buildDiagnosisScopedPlan(diagnostics, options = {}) {
  const requestedNaturalisation = String(options.naturalisation || "faithful").toLowerCase();
  const requestedLength = String(options.lengthPreference || "auto").toLowerCase();
  const requestedIntensity = String(options.rewriteIntensity || "auto").toLowerCase();
  const authorialAuthority = requestedIntensity === "deep" && ["aggressive", "authorial"].includes(requestedNaturalisation);

  // The base planner must diagnose scope independently of naturalisation style.
  // Passing an aggressive flag into the legacy v4 intent inference could silently
  // manufacture DISCOURSE_RECONSTRUCTION even when the document diagnosis did not
  // support it. Therefore scope diagnosis is always run in faithful mode (or off).
  // Requested aggressive/authorial treatment is restored afterwards as execution
  // authority within the user's explicit intensity ceiling.
  const diagnosticIntensity = requestedIntensity;
  const plannerNaturalisation = requestedNaturalisation === "off" ? "off" : "faithful";

  const plan = buildV4Plan(diagnostics, {
    ...options,
    rewriteIntensity: diagnosticIntensity,
    naturalisation: plannerNaturalisation,
    // Expansion is evidence/argument driven. It is never a quota to lengthen text.
    lengthPreference: requestedLength === "concise" ? "concise" : requestedLength === "expand" ? "expand" : "maintain",
  });

  plan.intensity = requestedIntensity;
  plan.diagnosticIntensity = diagnosticIntensity;
  plan.naturalisation = requestedNaturalisation;
  plan.diagnosticNaturalisation = plannerNaturalisation;
  plan.lengthPreference = requestedLength;
  plan.authorialAuthorityActive = authorialAuthority;
  plan.scopePolicyVersion = "diagnosis-guided-authority-v4";
  plan.authorialProtocolVersion = authorialAuthority ? "proposition-led-authorial-reconstruction-v5" : null;
  plan.scopePrinciples = [
    "Diagnosis selects the rhetorical/argument operation; the researcher-selected intensity supplies the intervention ceiling.",
    "Naturalisation changes how authorised work is expressed; it does not manufacture paragraph/discourse authority.",
    "Minor remains local and restrained; Moderate permits sentence/flow restructuring and selective diagnosed development; Deep permits diagnosed structural redevelopment.",
    "Deep + Aggressive/Authorial authorises paragraph-level reconstruction where paragraph/discourse diagnosis or machine-pattern regularity supports it, even if individual sentences are grammatically clean.",
    "CAN_CHANGE and SHOULD_CHANGE are separate decisions. Deep authority never creates a requirement to rewrite every clean unit.",
    "A Deep/Authorial request must not be silently collapsed into local synonym polishing where genuine reconstruction has been diagnosed.",
    "Expand develops diagnosed reasoning, evidence, qualification, context, measurement or gap work; it is not a word-growth quota.",
    "Keep decisions remain legitimate in every mode for headings, quotations, equations, technical labels, evidence, and genuinely author-specific passages that do not warrant intervention.",
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
        ? "Deep Authorial authority is active for diagnosed material: reconstruct from protected propositions, evidence relationships and rhetorical purpose rather than performing sentence-aligned paraphrase. Preserve the research; source sentence architecture is not automatically the fidelity target."
        : requestedIntensity === "deep"
          ? "Deep structural authority is available where diagnosis supports it; permission does not itself create a need to reconstruct clean material."
          : null,
      ["aggressive", "authorial"].includes(requestedNaturalisation) && requestedIntensity === "moderate"
        ? "Aggressive/Authorial expression is permitted at the sentence/flow level, but the Moderate ceiling blocks silent paragraph resequencing or wholesale discourse reconstruction."
        : null,
      requestedLength === "expand"
        ? "Expand is permission to develop diagnosed intellectual work from available content/evidence; no global word-growth quota is created."
        : null,
    ].filter(Boolean),
  };
  return plan;
}
