// Hierarchical intervention planner.
// Sequence: text understanding -> intent inference -> discourse diagnosis ->
// paragraph intervention planning -> sentence operations -> surface refinement.
// This prevents sentence-level fluency from masking document-level regularity
// and separates strong existing texture from argumentative sufficiency.

import { selectHumanDiscourseGuidance } from "./humanDiscourseRetrieval.js";

const PLACEHOLDER_MARKERS = /\[(citation needed|TBD|TODO|XXX)\]/i;
const CITATION_OR_NUMBER_RE = /(?:\([^\)\n]{0,180}(?:18|19|20)\d{2}[a-z]?[^\)\n]*\)|\b(?:18|19|20)\d{2}\b|\b\d+(?:\.\d+)?%\b|\b[ββα]\s*=|\bp\s*[<=>])/i;
const DIRECT_QUOTE_RE = /^\s*[“\"][\s\S]+[”\"]\s*$/;
const FIRST_PERSON_RE = /\b(?:I|we|my|our|ours)\b/;
const TECHNICAL_RE = /(?:\b[A-Z]{2,}\b|\b(?:regression|estimator|coefficient|hypothesis|construct|variable|panel|logit|logistic|OLS|GLS|ANOVA|SEM|IFRS|IAS)\b)/i;

export const PLANNER_SEQUENCE = Object.freeze([
  "TEXT_UNDERSTANDING",
  "INTENT_INFERENCE",
  "DISCOURSE_DIAGNOSIS",
  "ARGUMENTATIVE_SUFFICIENCY",
  "INTERVENTION_PLANNING",
  "PARAGRAPH_OPERATIONS",
  "SENTENCE_OPERATIONS",
  "SURFACE_REFINEMENT",
]);

export const INTERVENTION_INTENTS = Object.freeze({
  PRESERVE_POLISH: "preserve_polish",
  CLARITY_FLOW: "clarity_flow",
  CONTEXT_SCHOLARLY_STRENGTHENING: "context_scholarly_strengthening",
  DISCOURSE_RECONSTRUCTION: "discourse_reconstruction",
  DEEP_REDEVELOPMENT: "deep_redevelopment",
});

export const PARAGRAPH_ACTIONS = Object.freeze({
  KEEP_PARAGRAPH: "KEEP_PARAGRAPH",
  PRESERVE_AUTHORIAL_PASSAGE: "PRESERVE_AUTHORIAL_PASSAGE",
  RESEQUENCE: "RESEQUENCE",
  CONDENSE: "CONDENSE",
  EXPAND_FROM_EXISTING_CONTENT: "EXPAND_FROM_EXISTING_CONTENT",
  DEVELOP_EVIDENCE: "DEVELOP_EVIDENCE",
  EXPLAIN_MECHANISM: "EXPLAIN_MECHANISM",
  QUALIFY_EVIDENCE: "QUALIFY_EVIDENCE",
  DISTINGUISH_MEASURES: "DISTINGUISH_MEASURES",
  CONTEXTUALISE_SETTING: "CONTEXTUALISE_SETTING",
  TEMPORALISE_EVIDENCE: "TEMPORALISE_EVIDENCE",
  BUILD_GAP: "BUILD_GAP",
  MERGE_WITH_PREVIOUS: "MERGE_WITH_PREVIOUS",
  MERGE_WITH_NEXT: "MERGE_WITH_NEXT",
  BREAK_ARGUMENT: "BREAK_ARGUMENT",
  REMOVE_REDUNDANT_CLOSURE: "REMOVE_REDUNDANT_CLOSURE",
  REDUCE_SIGNPOSTING: "REDUCE_SIGNPOSTING",
  SYNTHESISE_EVIDENCE: "SYNTHESISE_EVIDENCE",
  REBUILD_DISCOURSE: "REBUILD_DISCOURSE",
});

export const KEEP_CLASSES = Object.freeze({
  KEEP_VOICE: "KEEP_VOICE",
  KEEP_EVIDENCE: "KEEP_EVIDENCE",
  KEEP_QUOTE: "KEEP_QUOTE",
  KEEP_TECHNICAL: "KEEP_TECHNICAL",
  KEEP_NATURAL: "KEEP_NATURAL",
});

const LEVELS = Object.freeze({
  KEEP: "KEEP",
  MICRO_EDIT: "MICRO_EDIT",
  SENTENCE_RESTRUCTURE: "SENTENCE_RESTRUCTURE",
  SPLIT_OR_MERGE: "SPLIT_OR_MERGE",
  PARAGRAPH_REORDER: "PARAGRAPH_REORDER",
  CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT: "CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT",
  COMPRESS: "COMPRESS",
  DISCOURSE_REPACKAGE: "DISCOURSE_REPACKAGE",
  FLAG_FOR_AUTHOR: "FLAG_FOR_AUTHOR",
});

const INTENT_BUDGETS = Object.freeze({
  [INTERVENTION_INTENTS.PRESERVE_POLISH]: { label: "restrained", conceptualStructuralChangeRange: "5-20%" },
  [INTERVENTION_INTENTS.CLARITY_FLOW]: { label: "moderate", conceptualStructuralChangeRange: "15-35%" },
  [INTERVENTION_INTENTS.CONTEXT_SCHOLARLY_STRENGTHENING]: { label: "developmental", conceptualStructuralChangeRange: "20-55%" },
  [INTERVENTION_INTENTS.DISCOURSE_RECONSTRUCTION]: { label: "deep", conceptualStructuralChangeRange: "35-70%" },
  [INTERVENTION_INTENTS.DEEP_REDEVELOPMENT]: { label: "extensive", conceptualStructuralChangeRange: "55-90%" },
});

function issueCoversSentence(issue, index) {
  if (Array.isArray(issue?.sentenceIndices)) return issue.sentenceIndices.includes(index);
  return issue?.sentenceIndex === index;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function architectureSignalForSentence(diagnostics, index) {
  return (diagnostics.discourse_architecture?.signals || []).find((signal) => issueCoversSentence(signal, index));
}

function developmentSignalsForSentence(diagnostics, index) {
  return (diagnostics.argumentative_sufficiency?.signals || []).filter((signal) => issueCoversSentence(signal, index));
}

function inferPreservationClass(sentence) {
  if (DIRECT_QUOTE_RE.test(sentence)) return KEEP_CLASSES.KEEP_QUOTE;
  if (CITATION_OR_NUMBER_RE.test(sentence)) return KEEP_CLASSES.KEEP_EVIDENCE;
  if (FIRST_PERSON_RE.test(sentence)) return KEEP_CLASSES.KEEP_VOICE;
  if (TECHNICAL_RE.test(sentence)) return KEEP_CLASSES.KEEP_TECHNICAL;
  return KEEP_CLASSES.KEEP_NATURAL;
}

function inferIntent(diagnostics, intensity, naturalisation) {
  const discourseSignals = diagnostics.qualitative_human_discourse?.signals || [];
  const contrastiveSignals = diagnostics.contrastive_language?.signals || [];
  const architectureSignals = diagnostics.discourse_architecture?.signals || [];
  const sufficiency = diagnostics.argumentative_sufficiency || {};
  const developmentSignals = sufficiency.signals || [];
  const placeholderCount = diagnostics.sentences.filter((sentence) => PLACEHOLDER_MARKERS.test(sentence)).length;
  const highDiscourse = discourseSignals.filter((signal) => signal.severity === "high").length;
  const highContrastive = contrastiveSignals.filter((signal) => signal.severity === "high").length;
  const highArchitecture = architectureSignals.filter((signal) => signal.severity === "high").length;
  const mediumArchitecture = architectureSignals.filter((signal) => signal.severity === "medium").length;
  const paragraphPatternCount = diagnostics.paragraph_patterns?.length || 0;
  const structuralIssueCount = diagnostics.structural_monotony?.length || 0;
  const cohesionIssueCount = diagnostics.cohesion?.length || 0;
  const genericCount = diagnostics.generic_phrasing?.length || 0;
  const developmentNeed = sufficiency.development_need || "low";
  const highDevelopment = developmentSignals.filter((signal) => signal.severity === "high").length;
  const mediumDevelopment = developmentSignals.filter((signal) => signal.severity === "medium").length;

  let recommended = INTERVENTION_INTENTS.PRESERVE_POLISH;
  const rationale = [];

  if (placeholderCount > 0) {
    recommended = INTERVENTION_INTENTS.DEEP_REDEVELOPMENT;
    rationale.push(`${placeholderCount} unresolved placeholder(s) require author-level redevelopment rather than blind polishing.`);
  } else if (highDiscourse + highContrastive + highArchitecture > 0 || mediumArchitecture >= 2) {
    recommended = INTERVENTION_INTENTS.DISCOURSE_RECONSTRUCTION;
    rationale.push("Document-level discourse diagnostics show patterned organisation that cannot be corrected reliably through local wording edits alone.");
    if (developmentNeed !== "low") {
      rationale.push("Argumentative-sufficiency diagnostics also show compressed evidential or contextual development, so reconstruction should complete the intellectual work without padding or inventing content.");
    }
  } else if (developmentNeed === "high" || highDevelopment > 0 || mediumDevelopment >= 2) {
    recommended = INTERVENTION_INTENTS.CONTEXT_SCHOLARLY_STRENGTHENING;
    rationale.push("The prose is academically usable, but evidence, conditions, measures or context are compressed enough that local polishing would preserve the under-development.");
    rationale.push("Development must come only from the source, supplied manuscript context or researcher-provided evidence. Word-count growth is not a target.");
  } else if (developmentNeed === "moderate") {
    recommended = INTERVENTION_INTENTS.CONTEXT_SCHOLARLY_STRENGTHENING;
    rationale.push("Selective argumentative development is warranted in diagnosed paragraphs even though the source does not require full discourse reconstruction.");
  } else if (paragraphPatternCount > 0 || cohesionIssueCount > 0 || structuralIssueCount >= 2) {
    recommended = INTERVENTION_INTENTS.CLARITY_FLOW;
    rationale.push("The source is substantively usable but its sequencing, cohesion or structural flow warrants intervention above simple proofreading.");
  } else if (genericCount > 0) {
    recommended = INTERVENTION_INTENTS.PRESERVE_POLISH;
    rationale.push("The main diagnosed weakness is local phrasing, so restrained editing is preferable to unnecessary reconstruction.");
  } else {
    rationale.push("No strong structural or argumentative-development defect was diagnosed; preserve existing reasoning and intervene lightly.");
  }

  let effective = recommended;
  let overrideApplied = false;
  if (naturalisation === "aggressive") {
    effective = recommended === INTERVENTION_INTENTS.DEEP_REDEVELOPMENT
      ? recommended
      : INTERVENTION_INTENTS.DISCOURSE_RECONSTRUCTION;
    overrideApplied = effective !== recommended;
    rationale.push("Aggressive naturalisation explicitly authorises deep structural restyling while factual preservation remains mandatory.");
  } else if (intensity === "minor") {
    effective = INTERVENTION_INTENTS.PRESERVE_POLISH;
    overrideApplied = effective !== recommended;
    rationale.push("Minor rewrite intensity caps intervention at local repair except where preservation or author flags require otherwise.");
  } else if (intensity === "moderate") {
    if (recommended === INTERVENTION_INTENTS.DISCOURSE_RECONSTRUCTION) {
      effective = INTERVENTION_INTENTS.CONTEXT_SCHOLARLY_STRENGTHENING;
      rationale.push("Moderate intensity does not authorise wholesale discourse reconstruction, but it does permit selective paragraph development where the diagnosis shows compressed evidence or reasoning.");
    } else {
      effective = recommended;
    }
    overrideApplied = effective !== recommended;
  } else if (intensity === "deep" && recommended === INTERVENTION_INTENTS.PRESERVE_POLISH) {
    effective = INTERVENTION_INTENTS.CLARITY_FLOW;
    overrideApplied = true;
    rationale.push("Deep intensity permits structural improvement even though the source did not trigger a full discourse-reconstruction recommendation.");
  }

  return {
    recommended,
    effective,
    overrideApplied,
    rationale: unique(rationale),
    budget: INTENT_BUDGETS[effective],
    evidence: {
      placeholderCount,
      highDiscourseSignalCount: highDiscourse,
      highContrastiveSignalCount: highContrastive,
      highArchitectureSignalCount: highArchitecture,
      mediumArchitectureSignalCount: mediumArchitecture,
      paragraphPatternCount,
      structuralIssueCount,
      cohesionIssueCount,
      genericPhraseCount: genericCount,
      argumentativeDevelopmentNeed: developmentNeed,
      argumentativeDevelopmentScore: sufficiency.development_score ?? 0,
      argumentativeDevelopmentSignalCount: developmentSignals.length,
      highArgumentativeDevelopmentSignalCount: highDevelopment,
      mediumArgumentativeDevelopmentSignalCount: mediumDevelopment,
    },
  };
}

function paragraphHasSentence(block, sentenceIndex) {
  return Array.isArray(block?.sentenceIndices) && block.sentenceIndices.includes(sentenceIndex);
}

function developmentActionsForSignal(signal) {
  switch (signal.id) {
    case "evidence_compression":
      return [PARAGRAPH_ACTIONS.DEVELOP_EVIDENCE, PARAGRAPH_ACTIONS.EXPAND_FROM_EXISTING_CONTENT];
    case "conditional_finding_compression":
      return [PARAGRAPH_ACTIONS.QUALIFY_EVIDENCE, PARAGRAPH_ACTIONS.EXPLAIN_MECHANISM, PARAGRAPH_ACTIONS.EXPAND_FROM_EXISTING_CONTENT];
    case "measurement_bundle_compression":
      return [PARAGRAPH_ACTIONS.DISTINGUISH_MEASURES, PARAGRAPH_ACTIONS.EXPAND_FROM_EXISTING_CONTENT];
    case "institutional_context_compression":
      return [PARAGRAPH_ACTIONS.CONTEXTUALISE_SETTING, PARAGRAPH_ACTIONS.EXPAND_FROM_EXISTING_CONTENT];
    case "temporal_context_compression":
      return [PARAGRAPH_ACTIONS.TEMPORALISE_EVIDENCE, PARAGRAPH_ACTIONS.EXPAND_FROM_EXISTING_CONTENT];
    case "premature_local_synthesis":
      return [PARAGRAPH_ACTIONS.REMOVE_REDUNDANT_CLOSURE];
    default:
      return [PARAGRAPH_ACTIONS.EXPAND_FROM_EXISTING_CONTENT];
  }
}

function buildParagraphPlan(diagnostics, intent, naturalisation) {
  const structure = diagnostics.text_structure || { blocks: [] };
  const discourseSignals = diagnostics.qualitative_human_discourse?.signals || [];
  const architectureSignals = diagnostics.discourse_architecture?.signals || [];
  const developmentSignals = diagnostics.argumentative_sufficiency?.signals || [];
  const repeatedParagraphLogic = discourseSignals.some((signal) => signal.issue === "repeated_paragraph_logic");
  const overSignposted = discourseSignals.some((signal) => signal.issue === "over_signposted_cohesion");

  return structure.blocks.map((block) => {
    const actions = [];
    const reasons = [];

    if (block.type === "heading") {
      return {
        blockIndex: block.blockIndex,
        blockType: block.type,
        sentenceIndices: block.sentenceIndices,
        primaryAction: PARAGRAPH_ACTIONS.KEEP_PARAGRAPH,
        actions: [PARAGRAPH_ACTIONS.KEEP_PARAGRAPH],
        reasons: ["Heading/section label is a structural landmark, not a prose sentence to naturalise."],
      };
    }

    if (block.type === "quotation") {
      return {
        blockIndex: block.blockIndex,
        blockType: block.type,
        sentenceIndices: block.sentenceIndices,
        primaryAction: PARAGRAPH_ACTIONS.PRESERVE_AUTHORIAL_PASSAGE,
        actions: [PARAGRAPH_ACTIONS.PRESERVE_AUTHORIAL_PASSAGE],
        reasons: ["Stand-alone quotation is evidence/authorial wording and should not be rewritten."],
      };
    }

    const repeatedOpening = (diagnostics.paragraph_patterns || []).some(
      (pattern) => Number.isInteger(pattern.sentenceIndex) && paragraphHasSentence(block, pattern.sentenceIndex) && pattern.issue === "repeated_paragraph_opening_frame"
    );
    if (repeatedOpening) {
      actions.push(PARAGRAPH_ACTIONS.REDUCE_SIGNPOSTING);
      reasons.push("Paragraph enters through a frame repeated elsewhere in the document.");
    }

    const scaffolded = (diagnostics.rhetorical_scaffolding || []).some((issue) =>
      block.sentenceIndices.some((index) => issueCoversSentence(issue, index))
    );
    if (scaffolded) {
      actions.push(PARAGRAPH_ACTIONS.REBUILD_DISCOURSE);
      reasons.push("Paragraph participates in a labelled/checklist rhetorical scaffold; preserve distinctions but rebuild the reasoning path.");
    }

    const localArchitectureSignals = architectureSignals.filter((signal) =>
      block.sentenceIndices.some((index) => issueCoversSentence(signal, index))
    );
    for (const signal of localArchitectureSignals) {
      if (["argument_packaging", "enumeration_saturation", "transition_saturation"].includes(signal.id)) {
        actions.push(PARAGRAPH_ACTIONS.REDUCE_SIGNPOSTING);
      } else if (signal.id === "closure_regularisation") {
        actions.push(PARAGRAPH_ACTIONS.REMOVE_REDUNDANT_CLOSURE);
      } else if (["aphoristic_compression", "rhetorical_symmetry", "triadic_enumeration_saturation"].includes(signal.id)) {
        actions.push(PARAGRAPH_ACTIONS.REBUILD_DISCOURSE);
      }
      reasons.push(signal.interpretation);
    }

    const localDevelopmentSignals = developmentSignals.filter((signal) =>
      block.sentenceIndices.some((index) => issueCoversSentence(signal, index)) || signal.blockIndex === block.blockIndex
    );
    if (intent.effective !== INTERVENTION_INTENTS.PRESERVE_POLISH) {
      for (const signal of localDevelopmentSignals) {
        actions.push(...developmentActionsForSignal(signal));
        reasons.push(`${signal.interpretation} ${signal.action}`);
      }
    }

    if (repeatedParagraphLogic && block.type === "paragraph" && block.sentenceCount >= 2 && intent.effective === INTERVENTION_INTENTS.DISCOURSE_RECONSTRUCTION) {
      actions.push(PARAGRAPH_ACTIONS.REBUILD_DISCOURSE);
      reasons.push("The document repeats the same paragraph-level rhetorical recipe; this paragraph must be judged as part of that global pattern, not sentence by sentence.");
    }

    if (overSignposted && block.type === "paragraph") {
      actions.push(PARAGRAPH_ACTIONS.REDUCE_SIGNPOSTING);
      reasons.push("Document-level cohesion is over-signposted; allow local lexical and evidential continuity to carry more of the progression.");
    }

    if (naturalisation === "aggressive" && block.type === "paragraph" && actions.length === 0) {
      actions.push(PARAGRAPH_ACTIONS.REBUILD_DISCOURSE);
      reasons.push("Aggressive structural mode authorises paragraph-level repackaging even where individual sentences are technically clean; preserve the argument and evidence, not the original sentence recipe.");
    }

    if (actions.length === 0) {
      actions.push(PARAGRAPH_ACTIONS.KEEP_PARAGRAPH);
      reasons.push(block.type === "list_item"
        ? "List item is treated as one semantic unit; preserve its enumerator and conceptual role unless a diagnosed pattern requires local sentence reconstruction."
        : "No paragraph-level defect or development need was diagnosed.");
    }

    const dedupedActions = unique(actions);
    const precedence = [
      PARAGRAPH_ACTIONS.RESEQUENCE,
      PARAGRAPH_ACTIONS.REBUILD_DISCOURSE,
      PARAGRAPH_ACTIONS.DEVELOP_EVIDENCE,
      PARAGRAPH_ACTIONS.QUALIFY_EVIDENCE,
      PARAGRAPH_ACTIONS.DISTINGUISH_MEASURES,
      PARAGRAPH_ACTIONS.CONTEXTUALISE_SETTING,
      PARAGRAPH_ACTIONS.TEMPORALISE_EVIDENCE,
      PARAGRAPH_ACTIONS.EXPLAIN_MECHANISM,
      PARAGRAPH_ACTIONS.BUILD_GAP,
      PARAGRAPH_ACTIONS.SYNTHESISE_EVIDENCE,
      PARAGRAPH_ACTIONS.REMOVE_REDUNDANT_CLOSURE,
      PARAGRAPH_ACTIONS.REDUCE_SIGNPOSTING,
      PARAGRAPH_ACTIONS.BREAK_ARGUMENT,
      PARAGRAPH_ACTIONS.CONDENSE,
      PARAGRAPH_ACTIONS.EXPAND_FROM_EXISTING_CONTENT,
      PARAGRAPH_ACTIONS.MERGE_WITH_PREVIOUS,
      PARAGRAPH_ACTIONS.MERGE_WITH_NEXT,
      PARAGRAPH_ACTIONS.KEEP_PARAGRAPH,
    ];
    const primaryAction = precedence.find((action) => dedupedActions.includes(action)) || dedupedActions[0];

    return {
      blockIndex: block.blockIndex,
      blockType: block.type,
      sentenceIndices: block.sentenceIndices,
      primaryAction,
      actions: dedupedActions,
      reasons: unique(reasons),
    };
  });
}

function paragraphDecisionForSentence(paragraphPlan, index) {
  return paragraphPlan.find((item) => item.sentenceIndices.includes(index)) || null;
}

function sentenceSignals(sentence, index, diagnostics) {
  const hasGenericPhrase = diagnostics.generic_phrasing.some((h) => h.sentenceIndex === index);
  const isOverloaded = diagnostics.monotony.overloaded.some((o) => o.sentenceIndex === index);
  const isChoppy = diagnostics.monotony.choppy.some((c) => c.sentenceIndex === index);
  const hasRepeatedOpening = diagnostics.structural_monotony.some(
    (m) => m.sentenceIndex === index && m.issue === "repeated_opening"
  );
  const hasRepeatedParagraphFrame = diagnostics.structural_monotony.some(
    (m) => m.sentenceIndex === index && m.issue === "repeated_paragraph_opening_frame"
  );
  const gapScaffoldIssue = (diagnostics.rhetorical_scaffolding || []).find(
    (m) => m.issue === "gap_label_scaffolding" && issueCoversSentence(m, index)
  );
  const proxyScaffoldIssue = (diagnostics.rhetorical_scaffolding || []).find(
    (m) => m.issue === "proxy_label_scaffolding" && issueCoversSentence(m, index)
  );
  const demonstrativeBridgeIssue = (diagnostics.rhetorical_scaffolding || []).find(
    (m) => m.issue === "demonstrative_bridge_overuse" && issueCoversSentence(m, index)
  );
  const choppyRunIssue = (diagnostics.rhetorical_scaffolding || []).find(
    (m) => m.issue === "choppy_sentence_run" && issueCoversSentence(m, index)
  );
  const architectureIssue = architectureSignalForSentence(diagnostics, index);
  const developmentSignals = developmentSignalsForSentence(diagnostics, index);
  const isPlaceholder = PLACEHOLDER_MARKERS.test(sentence);
  return {
    hasGenericPhrase,
    isOverloaded,
    isChoppy,
    hasRepeatedOpening,
    hasRepeatedParagraphFrame,
    gapScaffoldIssue,
    proxyScaffoldIssue,
    demonstrativeBridgeIssue,
    choppyRunIssue,
    architectureIssue,
    developmentSignals,
    isPlaceholder,
  };
}

function paragraphHasDevelopmentAction(paragraphDecision) {
  const actions = paragraphDecision?.actions || [];
  return actions.some((action) => [
    PARAGRAPH_ACTIONS.EXPAND_FROM_EXISTING_CONTENT,
    PARAGRAPH_ACTIONS.DEVELOP_EVIDENCE,
    PARAGRAPH_ACTIONS.EXPLAIN_MECHANISM,
    PARAGRAPH_ACTIONS.QUALIFY_EVIDENCE,
    PARAGRAPH_ACTIONS.DISTINGUISH_MEASURES,
    PARAGRAPH_ACTIONS.CONTEXTUALISE_SETTING,
    PARAGRAPH_ACTIONS.TEMPORALISE_EVIDENCE,
    PARAGRAPH_ACTIONS.BUILD_GAP,
  ].includes(action));
}

function planSentence(sentence, index, diagnostics, options) {
  const { intensity, lengthPreference, naturalisation, intent, paragraphDecision } = options;
  const s = sentenceSignals(sentence, index, diagnostics);
  const reasons = [];
  const preservationClass = inferPreservationClass(sentence);

  if (s.isPlaceholder) {
    reasons.push("Sentence contains an unresolved placeholder marker.");
    return { level: LEVELS.FLAG_FOR_AUTHOR, reasons, preservationClass, decisionCode: "FLAG_FOR_AUTHOR" };
  }

  if (preservationClass === KEEP_CLASSES.KEEP_QUOTE) {
    return {
      level: LEVELS.KEEP,
      reasons: ["Direct quotation is preserved verbatim; surrounding prose may be rebuilt instead."],
      preservationClass,
      decisionCode: KEEP_CLASSES.KEEP_QUOTE,
    };
  }

  if (paragraphDecision?.blockType === "heading") {
    return {
      level: LEVELS.KEEP,
      reasons: ["Heading/section label is not sentence-level rewrite material."],
      preservationClass: KEEP_CLASSES.KEEP_TECHNICAL,
      decisionCode: KEEP_CLASSES.KEEP_TECHNICAL,
    };
  }

  if (s.gapScaffoldIssue) {
    reasons.push("This sentence is part of a labelled gap scaffold. Preserve the distinct gap content, but rebuild the sequence as a connected scholarly argument rather than retaining the checklist labels.");
    return { level: LEVELS.SENTENCE_RESTRUCTURE, reasons, preservationClass, decisionCode: "REWRITE_PATTERN" };
  }

  if (s.proxyScaffoldIssue) {
    reasons.push("This sentence is part of a consecutive category scaffold. Preserve every performance dimension and its evidence, but connect the dimensions through consequence and comparison rather than repeating a category-led checklist structure.");
    return { level: LEVELS.SENTENCE_RESTRUCTURE, reasons, preservationClass, decisionCode: "REWRITE_PATTERN" };
  }

  if (s.choppyRunIssue) {
    reasons.push("This sentence is part of a consecutive micro-sentence run. Merge or redistribute the reasoning so short sentences arise from argument, not manufactured rhythm variation.");
    return { level: LEVELS.SPLIT_OR_MERGE, reasons, preservationClass, decisionCode: "REWRITE_PATTERN" };
  }

  if (s.isOverloaded) {
    reasons.push("Sentence has exceptional clause load. Restructure or redistribute only if every contrastive, causal, concessive, comparative or parallel relationship remains explicit; sentence length alone does not authorise splitting.");
    return { level: LEVELS.SPLIT_OR_MERGE, reasons, preservationClass, decisionCode: LEVELS.SPLIT_OR_MERGE };
  }

  if (s.architectureIssue && (naturalisation === "aggressive" || intensity === "deep" || intent.effective === INTERVENTION_INTENTS.DISCOURSE_RECONSTRUCTION)) {
    reasons.push(`Document-level pattern (${s.architectureIssue.id}): ${s.architectureIssue.interpretation}`);
    reasons.push(s.architectureIssue.action);
    reasons.push("This is discourse-level scope: execute the paragraph action first rather than treating the source sentence as an obligatory standalone rewrite.");
    return { level: LEVELS.DISCOURSE_REPACKAGE, reasons, preservationClass, decisionCode: "DISCOURSE_SCOPE" };
  }

  if (paragraphDecision?.actions.includes(PARAGRAPH_ACTIONS.REBUILD_DISCOURSE) &&
      (naturalisation === "aggressive" || intent.effective === INTERVENTION_INTENTS.DISCOURSE_RECONSTRUCTION)) {
    reasons.push("Sentence belongs to a paragraph selected for discourse reconstruction. Preserve its proposition/evidence while allowing the paragraph-level operation to keep, move, merge, split or recast it as needed. Do not convert the paragraph action into a one-sentence-one-rewrite quota.");
    return { level: LEVELS.DISCOURSE_REPACKAGE, reasons, preservationClass, decisionCode: "DISCOURSE_SCOPE" };
  }

  if (paragraphHasDevelopmentAction(paragraphDecision) && paragraphDecision?.sentenceIndices?.[0] === index) {
    reasons.push("This paragraph has a diagnosed argumentative-development need. Develop the existing evidence/qualification/context at paragraph level; do not inflate every sentence or add unsupported content.");
    for (const signal of s.developmentSignals) reasons.push(`${signal.interpretation} ${signal.action}`);
    return {
      level: LEVELS.CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT,
      reasons: unique(reasons),
      preservationClass,
      decisionCode: "SELECTIVE_ARGUMENT_DEVELOPMENT",
    };
  }

  if (s.demonstrativeBridgeIssue && naturalisation === "aggressive") {
    reasons.push("This sentence sits inside a cluster of repeated demonstrative bridge subjects. Keep the referential connection, but vary how the sentence grows from the preceding evidence so cohesion is not mechanically signposted.");
    return { level: LEVELS.SENTENCE_RESTRUCTURE, reasons, preservationClass, decisionCode: "REWRITE_PATTERN" };
  }

  if (naturalisation === "aggressive") {
    if (lengthPreference === "concise" && s.hasGenericPhrase) {
      reasons.push("Aggressive naturalisation plus Concise preference: compress formulaic padding and rebuild the sentence.");
      return { level: LEVELS.COMPRESS, reasons, preservationClass, decisionCode: LEVELS.COMPRESS };
    }
    if (s.hasRepeatedParagraphFrame || s.hasGenericPhrase || s.hasRepeatedOpening || s.isChoppy) {
      reasons.push("Aggressive naturalisation: diagnosed wording/structure requires substantive reconstruction.");
      return { level: LEVELS.SENTENCE_RESTRUCTURE, reasons, preservationClass, decisionCode: "REWRITE_PATTERN" };
    }
    reasons.push("Aggressive naturalisation authorises structural restyling where no higher-level discourse action already governs the material; preserve factual/technical content and avoid cosmetic synonym swapping.");
    return { level: LEVELS.SENTENCE_RESTRUCTURE, reasons, preservationClass, decisionCode: LEVELS.SENTENCE_RESTRUCTURE };
  }

  if (s.hasRepeatedParagraphFrame) {
    reasons.push("Paragraph opening repeats a structural frame used across several paragraphs.");
    if (intensity === "minor") return { level: LEVELS.MICRO_EDIT, reasons, preservationClass, decisionCode: LEVELS.MICRO_EDIT };
    return { level: LEVELS.SENTENCE_RESTRUCTURE, reasons, preservationClass, decisionCode: "REWRITE_PATTERN" };
  }

  if (lengthPreference === "concise" && s.hasGenericPhrase) {
    reasons.push("Contains formulaic filler and length preference is Concise.");
    return { level: LEVELS.COMPRESS, reasons, preservationClass, decisionCode: LEVELS.COMPRESS };
  }

  const flagged = s.hasGenericPhrase || s.hasRepeatedOpening || s.isChoppy;

  switch (intensity) {
    case "minor":
      if (flagged) {
        reasons.push("Flagged wording, Minor intensity permits local repair only.");
        return { level: LEVELS.MICRO_EDIT, reasons, preservationClass, decisionCode: LEVELS.MICRO_EDIT };
      }
      return { level: LEVELS.KEEP, reasons: ["No flagged issue; preserve rather than over-edit."], preservationClass, decisionCode: preservationClass };

    case "moderate":
      if (flagged) {
        reasons.push("Flagged wording/structure under Moderate intensity.");
        return { level: LEVELS.SENTENCE_RESTRUCTURE, reasons, preservationClass, decisionCode: LEVELS.SENTENCE_RESTRUCTURE };
      }
      return { level: LEVELS.MICRO_EDIT, reasons: ["Unflagged; light pass only unless a paragraph-level development action governs the material."], preservationClass, decisionCode: LEVELS.MICRO_EDIT };

    case "deep":
      if (flagged) {
        reasons.push("Flagged wording/structure under Deep intensity.");
        return { level: LEVELS.SENTENCE_RESTRUCTURE, reasons, preservationClass, decisionCode: LEVELS.SENTENCE_RESTRUCTURE };
      }
      if (lengthPreference === "expand") {
        reasons.push("Deep intensity + Expand preference on an otherwise clean sentence.");
        return { level: LEVELS.CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT, reasons, preservationClass, decisionCode: LEVELS.CLARIFY_OR_EXPAND_FROM_EXISTING_CONTENT };
      }
      return { level: LEVELS.MICRO_EDIT, reasons: ["Unflagged locally; deep mode still permits cadence/flow refinement without inventing content."], preservationClass, decisionCode: LEVELS.MICRO_EDIT };

    case "auto":
    default:
      if (flagged) {
        reasons.push("Flagged wording/structure; Auto mode escalates only where diagnostics found an issue.");
        return { level: LEVELS.SENTENCE_RESTRUCTURE, reasons, preservationClass, decisionCode: LEVELS.SENTENCE_RESTRUCTURE };
      }
      return { level: LEVELS.KEEP, reasons: ["No local or document-level issue requires alteration."], preservationClass, decisionCode: preservationClass };
  }
}

export function buildInterventionPlan(diagnostics, { rewriteIntensity, lengthPreference, naturalisation } = {}) {
  const intensity = (rewriteIntensity || "auto").toLowerCase();
  const length = (lengthPreference || "auto").toLowerCase();
  const naturalisationLevel = (naturalisation || "faithful").toLowerCase();
  const intent = inferIntent(diagnostics, intensity, naturalisationLevel);
  const baseParagraphPlan = buildParagraphPlan(diagnostics, intent, naturalisationLevel);
  const humanDiscourseEvidence = selectHumanDiscourseGuidance(diagnostics, baseParagraphPlan);
  const discourseByBlock = new Map(
    humanDiscourseEvidence.paragraphAssignments.map((row) => [row.blockIndex, row])
  );
  const paragraphPlan = baseParagraphPlan.map((row) => {
    const assignment = discourseByBlock.get(row.blockIndex);
    return {
      ...row,
      rhetoricalJob: assignment?.rhetoricalJob || null,
      humanDiscourseMoveIds: assignment?.moveIds || [],
    };
  });

  const items = diagnostics.sentences.map((sentence, index) => {
    const paragraphDecision = paragraphDecisionForSentence(paragraphPlan, index);
    const result = planSentence(sentence, index, diagnostics, {
      intensity,
      lengthPreference: length,
      naturalisation: naturalisationLevel,
      intent,
      paragraphDecision,
    });
    return {
      sentenceIndex: index,
      sentence,
      level: result.level,
      reasons: result.reasons,
      preservationClass: result.preservationClass,
      decisionCode: result.decisionCode,
      paragraphBlockIndex: paragraphDecision?.blockIndex ?? null,
      paragraphAction: paragraphDecision?.primaryAction ?? null,
    };
  });

  const discourseSignals = diagnostics.qualitative_human_discourse?.signals || [];
  const contrastiveSignals = diagnostics.contrastive_language?.signals || [];
  const architectureSignals = diagnostics.discourse_architecture?.signals || [];
  const developmentSignals = diagnostics.argumentative_sufficiency?.signals || [];
  const trainingPrinciples = [
    "Intent before intervention: diagnose what the writer needs before choosing rewrite depth.",
    "Strong existing authorial texture and sufficient argumentative development are separate questions. Preserve good surface voice while still developing compressed evidence or reasoning where diagnosed.",
    "Expand intellectual workload, not word count. Added words are justified only when they complete a rhetorical function already licensed by the source, manuscript context or researcher-provided evidence.",
    "Judge local sentences in global context: an individually strong sentence may still participate in a paragraph-level reconstruction when it contributes to repetitive document architecture.",
    "A discourse-level action is not a quota requiring every source sentence in that paragraph to be independently rewritten; preserve, move, merge, split or recast material according to the paragraph's reasoning needs.",
    "Selective argumentative development is also not a sentence-length exercise. Develop evidence, mechanisms, conditions, measurement distinctions, institutional context, temporal context or the empirical gap only where those functions are diagnosed.",
    "Preserve authorial reasoning, evidence, technical meaning and lexical identity; do not confuse human variation with deliberate errors or randomisation.",
    "Prefer evidence-assembled reasoning over pre-packaged claim/explanation/implication templates when the source supports that development.",
    "Do not force local synthesis after every small evidence cluster. Some paragraphs may end with evidence, a qualification or an unresolved tension that carries forward.",
    "Contextual grounding must come from the source, supplied context or verifiable user material; never invent local realities to make prose appear situated.",
    "Retain scholarly trace: citations, short quotations, author attributions, disagreement and qualification should remain visible where they are part of the source's intellectual development.",
    "Aim for high global scholarly competence with non-uniform local optimisation; not every sentence or paragraph needs a polished rhetorical payoff.",
  ];

  const documentGuidance = [
    ...trainingPrinciples,
    ...discourseSignals.map((signal) => `${signal.interpretation} ${signal.action}`),
    ...contrastiveSignals.map((signal) => `Contrastive language signal (${signal.label}): ${signal.interpretation} ${signal.action}`),
    ...architectureSignals.map((signal) => `Discourse architecture signal (${signal.id}): ${signal.interpretation} ${signal.action}`),
    ...developmentSignals.map((signal) => `Argumentative sufficiency signal (${signal.id}): ${signal.interpretation} ${signal.action}`),
  ];

  const paragraphReorderSuggested = diagnostics.structural_monotony.some(
    (m) => m.issue === "uniform_paragraph_length" || m.issue === "gap_label_scaffolding" || m.issue === "proxy_label_scaffolding"
  ) || paragraphPlan.some((item) => item.actions.includes(PARAGRAPH_ACTIONS.RESEQUENCE));

  const summary = items.reduce((acc, item) => {
    acc[item.level] = (acc[item.level] || 0) + 1;
    return acc;
  }, {});

  const paragraphSummary = paragraphPlan.reduce((acc, item) => {
    acc[item.primaryAction] = (acc[item.primaryAction] || 0) + 1;
    return acc;
  }, {});

  return {
    plannerVersion: "intent-discourse-v4",
    sequence: PLANNER_SEQUENCE,
    intensity,
    lengthPreference: length,
    naturalisation: naturalisationLevel,
    intent,
    interventionBudget: intent.budget,
    argumentativeSufficiency: diagnostics.argumentative_sufficiency || null,
    items,
    paragraphPlan,
    paragraphSummary,
    humanDiscourseEvidence,
    documentGuidance,
    trainingPrinciples,
    qualitativeDiscourseSignalCount: discourseSignals.length,
    contrastiveLanguageSignalCount: contrastiveSignals.length,
    discourseArchitectureSignalCount: architectureSignals.length,
    argumentativeDevelopmentSignalCount: developmentSignals.length,
    paragraphReorderSuggested,
    summary,
  };
}

export { LEVELS };

