// Diagnosis-aware wrapper around intent-discourse-v4.
// Diagnosis chooses WHAT kind of intervention a passage needs. The researcher-selected
// intensity determines HOW DEEP the engine may go. Naturalisation changes HOW an
// authorised intervention is expressed; it must not manufacture structural need.

import { buildInterventionPlan as buildV4Plan } from "./planner.js";

const FORMAL_KEEP_CODES = new Set(["KEEP_QUOTE", "KEEP_TECHNICAL"]);
const MODERATE_FORENSIC_LEVELS = new Set(["KEEP", "MICRO_EDIT"]);
const DEEP_FORENSIC_LEVELS = new Set(["KEEP", "MICRO_EDIT", "SENTENCE_RESTRUCTURE"]);

function summarise(items = []) {
  return items.reduce((acc, item) => {
    acc[item.level] = (acc[item.level] || 0) + 1;
    return acc;
  }, {});
}

function forensicReason(mode) {
  if (mode === "moderate") {
    return [
      "Cross-sentence/cross-paragraph regularity forensics selected this sentence as a leverage point in repeated rhetorical choreography. Moderate + Aggressive permits sentence/flow reconstruction here, but does not authorise wholesale paragraph resequencing.",
      "Change information packaging rather than merely substituting synonyms. Preserve the proposition, evidence attachment, citation, qualification and technical meaning.",
    ];
  }
  return [
    "Cross-paragraph regularity forensics selected this unit as part of repeated rhetorical choreography. Deep + Aggressive/Authorial permits proposition-led repackaging at this diagnosed leverage point.",
    "CAN_CHANGE is not SHOULD_CHANGE: preserve the unit if its existing expression is genuinely author-specific and no local reconstruction is needed after the paragraph-level operation.",
  ];
}

function forensicExecutionScope(plan, diagnostics, { requestedIntensity, requestedNaturalisation }) {
  const forensic = diagnostics?.discourse_regularity_forensics;
  const aggressiveExpression = ["aggressive", "authorial"].includes(requestedNaturalisation);
  const available = Boolean(forensic?.available && Array.isArray(forensic?.priority_sentence_indices));

  if (!aggressiveExpression || !available || requestedIntensity === "minor" || requestedIntensity === "auto") {
    return plan;
  }

  const sourceIndices = forensic.priority_sentence_indices.filter((index) => Number.isInteger(index));
  if (!sourceIndices.length) {
    plan.forensicExecution = {
      available: true,
      version: forensic.version,
      regularity_score: forensic.score,
      regularity_label: forensic.label,
      targeted_sentence_count: 0,
      newly_escalated_sentence_count: 0,
      mode: "diagnostic_only",
      reason: "No sentence received a priority forensic index; no expressive intervention was manufactured from mode selection alone.",
    };
    return plan;
  }

  // The forensic engine identifies leverage points (openings, evidence-entry points,
  // closures and repeated signposts), not a quota to rewrite the narrative.
  const ratioCap = requestedIntensity === "deep" ? 0.65 : 0.45;
  const maxTargets = Math.max(1, Math.floor((plan.items?.length || 1) * ratioCap));
  const targetIndices = new Set(sourceIndices.slice(0, maxTargets));
  let targeted = 0;
  let escalated = 0;
  const executedTargetIndices = [];

  plan.items = (plan.items || []).map((item) => {
    if (!targetIndices.has(item.sentenceIndex)) return item;
    if (FORMAL_KEEP_CODES.has(item.decisionCode)) return item;

    targeted += 1;
    executedTargetIndices.push(item.sentenceIndex);

    if (requestedIntensity === "moderate") {
      if (MODERATE_FORENSIC_LEVELS.has(item.level)) {
        escalated += 1;
        return {
          ...item,
          level: "SENTENCE_RESTRUCTURE",
          decisionCode: "FORENSIC_SENTENCE_FLOW_RESTRUCTURE",
          reasons: [...(item.reasons || []), ...forensicReason("moderate")],
        };
      }
      if (item.level === "SENTENCE_RESTRUCTURE") {
        return {
          ...item,
          decisionCode: "FORENSIC_SENTENCE_FLOW_RESTRUCTURE",
          reasons: [...(item.reasons || []), ...forensicReason("moderate")],
        };
      }
      return {
        ...item,
        reasons: [...(item.reasons || []), ...forensicReason("moderate")],
      };
    }

    if (requestedIntensity === "deep") {
      if (DEEP_FORENSIC_LEVELS.has(item.level)) {
        escalated += 1;
        return {
          ...item,
          level: "DISCOURSE_REPACKAGE",
          decisionCode: "FORENSIC_DISCOURSE_SCOPE",
          reasons: [...(item.reasons || []), ...forensicReason("deep")],
        };
      }
      if (item.level === "DISCOURSE_REPACKAGE") {
        return {
          ...item,
          decisionCode: "FORENSIC_DISCOURSE_SCOPE",
          reasons: [...(item.reasons || []), ...forensicReason("deep")],
        };
      }
      return {
        ...item,
        reasons: [...(item.reasons || []), ...forensicReason("deep")],
      };
    }

    return item;
  });

  plan.summary = summarise(plan.items);
  plan.forensicExecution = {
    available: true,
    version: forensic.version,
    regularity_score: forensic.score,
    regularity_label: forensic.label,
    rhetorical_asymmetry_score: forensic.rhetorical_asymmetry_score,
    source_priority_sentence_count: sourceIndices.length,
    target_cap: maxTargets,
    targeted_sentence_count: targeted,
    newly_escalated_sentence_count: escalated,
    targeted_sentence_indices: executedTargetIndices,
    formal_artifacts_excluded: forensic.formal_artifact_block_count || 0,
    mode: requestedIntensity === "deep" ? "targeted_discourse_repackage" : "targeted_sentence_flow_restructure",
    principle: "Diagnosis determines SHOULD_CHANGE; intensity determines CAN_CHANGE; naturalisation determines HOW the authorised change is expressed.",
  };

  return plan;
}

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
    "MODERN MACHINE-LANGUAGE SELF-CHECK: polished academic language can still be machine-shaped. Do not repeatedly stage reasoning through 'not X but Y', 'not merely', 'more than', 'does not imply', 'the difficulty is', 'the more instructive result', 'the unresolved issue', 'becomes more evident', 'adds further complexity', or equivalent editorial pivots. Keep any such construction only when it is the clearest way to express a real distinction. Recurrence across the passage is a defect even when each sentence is individually grammatical and sophisticated.",
    "DO NOT ANNOUNCE THE PARAGRAPH WHEN THE CONTENT CAN DO THE WORK: abstract openings should not repeatedly preview content that the paragraph itself already makes clear. But preserve or reconstruct openings that narrow the inquiry, locate a jurisdiction/time/level of analysis, frame a concept, establish contrast or connect the argument across paragraphs; those are intellectual functions, not padding.",
    "PREFER PROPOSITIONS TO DISCOURSE MANAGEMENT: if a sentence only labels a point important, complex or unresolved without adding a relationship, it may be absorbed. A sentence that interprets evidence, explains relevance, qualifies scope, distinguishes concepts or moves the funnel adds a proposition/function and must survive in defensible wording.",
    "PREFER ACTORS AND DIRECT VERBS WHEN TECHNICALLY APPROPRIATE: firms borrow, lenders price and monitor, boards oversee, studies report, effects vary, conditions change. Do not replace valid construct names or technical abstractions simply to force directness, but avoid unnecessary noun-heavy packaging when a precise verb carries the same meaning.",
    "SECTION REGISTER MATTERS: problem statements, purpose statements, research questions, hypotheses, operational definitions and methods should remain direct and institutionally recognisable. Do not naturalise formal artefacts by rhetorical embellishment. Literature/background prose can carry more varied discourse movement because its job is argumentative rather than formularised.",
    "DEEP DOES NOT MEAN LEXICALLY GRANDER: do not inflate nominalisations, stack abstract nouns, or make every sentence denser. A stronger reconstruction may use simpler verbs, shorter evidential statements, delayed interpretation, or a longer qualified sentence where the reasoning actually requires it.",
    "CAN CHANGE IS NOT SHOULD CHANGE: Deep/Authorial supplies broad permission, not a quota. A technically clean sentence or paragraph may still be kept when its authorial texture is genuine and no discourse-regularity or argumentative diagnosis warrants intervention.",
    "FINAL SELF-CHECK BEFORE RETURNING: for paragraphs actually authorised for reconstruction, ask whether the candidate is essentially the same paragraph sequence with cleaner synonyms and recast clauses. Also ask whether the candidate has accumulated polished editorial pivots, abstract signposts or tidy synthesis sentences that were not required by the argument. If either is true, the authorised Deep Authorial operation is under-executed or over-regularised. Rebuild that authorised material from the proposition/evidence ledger while retaining all protected research content.",
    "EXTERNAL CLASSIFIERS ARE DIAGNOSTIC ONLY: do not target a detector score, insert errors, conceal machine provenance, or use tricks. The objective is defensible, heterogeneous, author-like academic discourse produced by better reasoning architecture and fidelity, not score gaming.",
  ];
}

export function buildDiagnosisScopedPlan(diagnostics, options = {}) {
  const requestedNaturalisation = String(options.naturalisation || "faithful").toLowerCase();
  const requestedLength = String(options.lengthPreference || "auto").toLowerCase();
  const requestedIntensity = String(options.rewriteIntensity || "auto").toLowerCase();
  const authorialAuthority = requestedIntensity === "deep" && ["aggressive", "authorial"].includes(requestedNaturalisation);

  // Scope diagnosis is deliberately independent of aggressive/authorial style.
  // Naturalisation must not manufacture a structural problem that diagnosis did
  // not find. Requested style is restored afterwards as execution authority.
  const diagnosticIntensity = requestedIntensity;
  const plannerNaturalisation = requestedNaturalisation === "off" ? "off" : "faithful";

  let plan = buildV4Plan(diagnostics, {
    ...options,
    rewriteIntensity: diagnosticIntensity,
    naturalisation: plannerNaturalisation,
    lengthPreference: requestedLength === "concise" ? "concise" : requestedLength === "expand" ? "expand" : "maintain",
  });

  plan = forensicExecutionScope(plan, diagnostics, {
    requestedIntensity,
    requestedNaturalisation,
  });

  plan.intensity = requestedIntensity;
  plan.diagnosticIntensity = diagnosticIntensity;
  plan.naturalisation = requestedNaturalisation;
  plan.diagnosticNaturalisation = plannerNaturalisation;
  plan.lengthPreference = requestedLength;
  plan.authorialAuthorityActive = authorialAuthority;

  // Keep the established public identifiers stable for downstream compatibility.
  // New forensic behaviour is versioned independently instead of forcing callers
  // to interpret a compatibility-string bump as a different policy contract.
  plan.scopePolicyVersion = "diagnosis-guided-authority-v3";
  plan.authorialProtocolVersion = authorialAuthority ? "proposition-led-authorial-reconstruction-v4.1" : null;
  plan.scopeImplementationVersion = "diagnosis-guided-authority-v5.1";
  plan.forensicScopeVersion = diagnostics?.discourse_regularity_forensics?.version || null;
  plan.machineLanguageForensicsVersion = diagnostics?.machine_language_forensics?.version || null;

  const machineLanguage = diagnostics?.machine_language_forensics;
  plan.scopePrinciples = [
    "Diagnosis selects the rhetorical/argument operation; the researcher-selected mode supplies the intervention authority, while intensity remains the hard structural ceiling.",
    "Naturalisation changes how authorised work is expressed; it does not manufacture paragraph/discourse authority.",
    "Cross-paragraph regularity forensics examines recurring rhetorical sequencing, evidence placement, tidy closures, paragraph signatures, signposting and rhetorical asymmetry in narrative prose; formal academic artefacts are excluded from that score.",
    "Modern machine-language forensics examines recurrence of polished editorial pivots, abstract issue-framing, binary qualification, compressed synthesis, discourse-management wording and nominalisation pressure. It is a style diagnostic, not an authorship classifier, and no single phrase is banned in isolation.",
    "High grammar, clarity and sophistication do not override machine-language or discourse-regularity evidence. An academically polished candidate may still require reconstruction when its language repeatedly manages the reader through predictable editorial frames rather than allowing the substantive reasoning to carry the prose.",
    "Minor remains local and restrained; Moderate permits sentence/flow restructuring and selective diagnosed development; Deep permits diagnosed structural redevelopment.",
    "Moderate + Aggressive may substantially restructure the diagnosed sentence/flow leverage points identified by discourse forensics, while still blocking silent paragraph resequencing or wholesale discourse reconstruction.",
    "Deep + Aggressive/Authorial authorises paragraph-level reconstruction where paragraph/discourse diagnosis or machine-pattern regularity supports it, even if individual sentences are grammatically clean.",
    "CAN_CHANGE and SHOULD_CHANGE are separate decisions. Deep authority never creates a requirement to rewrite every clean unit.",
    "A Deep/Authorial request must not be silently collapsed into local synonym polishing where genuine reconstruction has been diagnosed.",
    "Expand develops diagnosed reasoning, evidence, qualification, context, measurement or gap work; it is not a word-growth quota.",
    "Keep decisions remain legitimate in every mode for headings, quotations, equations, technical labels, evidence, formal research artefacts, and genuinely author-specific passages that do not warrant intervention.",
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
      diagnostics?.discourse_regularity_forensics?.available
        ? `Cross-paragraph discourse regularity: ${diagnostics.discourse_regularity_forensics.label} (${diagnostics.discourse_regularity_forensics.score}). Formal academic artefacts excluded: ${diagnostics.discourse_regularity_forensics.formal_artifact_block_count || 0}.`
        : null,
      machineLanguage?.available
        ? `Modern machine-language density: ${machineLanguage.label} (${machineLanguage.score}); ${machineLanguage.metrics?.hit_sentence_count || 0} of ${machineLanguage.metrics?.sentence_count || 0} substantive sentences contain at least one monitored lexical-rhetorical framing pattern. This is density evidence, not an authorship claim.`
        : null,
      authorialAuthority
        ? "Deep Authorial authority is active for diagnosed material: reconstruct from protected propositions, evidence relationships and rhetorical purpose rather than performing sentence-aligned paraphrase. Preserve the research; source sentence architecture is not automatically the fidelity target. Prevent polished machine-language accumulation during generation rather than relying only on post-output cleanup."
        : requestedIntensity === "deep"
          ? "Deep structural authority is available where diagnosis supports it; permission does not itself create a need to reconstruct clean material."
          : null,
      ["aggressive", "authorial"].includes(requestedNaturalisation) && requestedIntensity === "moderate"
        ? "Aggressive/Authorial expression is permitted at the sentence/flow level. Cross-paragraph forensic leverage points may receive substantive sentence restructuring, but the Moderate ceiling blocks silent paragraph resequencing or wholesale discourse reconstruction."
        : null,
      requestedLength === "expand"
        ? "Expand is permission to develop diagnosed intellectual work from available content/evidence; no global word-growth quota is created."
        : null,
    ].filter(Boolean),
  };
  return plan;
}

