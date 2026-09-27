import { HUMAN_DISCOURSE_GLOBAL_RULES, HUMAN_DISCOURSE_MOVES, HUMAN_DISCOURSE_PROFILES } from "../data/humanDiscourseProfiles.js";
import { parseTextStructure } from "./textStructure.js";

const ACTIONS = new Set([
  "respond_in_own_words",
  "rephrase_in_own_words",
  "read_back_in_own_words",
  "resolve_contradiction",
  "explain_mechanism",
  "qualify_claim",
  "reorganize_section",
  "contract_repetition",
  "evidence_check",
]);

const SCOPES = new Set(["sentence", "paragraph", "section"]);
const OPERATIONS = new Set(["notes_only", "insert_before", "append_after", "replace_block"]);

function clean(value, max = 4000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildManuscriptDevelopmentUnits(text) {
  const structure = parseTextStructure(text);
  let currentSection = "Unlabelled section";
  return structure.blocks
    .filter((block) => block.type !== "page_artifact")
    .map((block) => {
      if (block.type === "heading") currentSection = block.text;
      return {
        block_id: `block-${String(block.blockIndex + 1).padStart(3, "0")}`,
        block_index: block.blockIndex,
        paragraph_index: block.paragraphOrdinal === null ? null : block.paragraphOrdinal + 1,
        type: block.type,
        section: currentSection,
        text: block.text,
        word_count: block.wordCount,
      };
    });
}

export function buildStudioHumanReasoningGuide(section = "") {
  const job = clean(section, 80).toLowerCase() || "exposition";
  const matching = HUMAN_DISCOURSE_MOVES.filter((move) => move.jobs.includes(job) || move.jobs.includes("exposition"));
  const selected = [];
  for (const profile of HUMAN_DISCOURSE_PROFILES) {
    const profileMoves = matching.filter((move) => move.profileId === profile.id);
    selected.push(...profileMoves.slice(0, 3));
  }
  return {
    purpose: "Use these records to recognise missing intellectual work. Do not imitate wording, grammar or surface style, and do not write the author's answer.",
    profiles: HUMAN_DISCOURSE_PROFILES.map((profile) => ({
      id: profile.id,
      strongest_contribution: profile.strongestContribution,
      longitudinal_architecture: profile.longitudinalArchitecture,
      preserve: profile.preserve,
      avoid: profile.avoid,
    })),
    applicable_moves: selected.map((move) => ({
      id: move.id,
      instruction: move.instruction,
      caution: move.caution,
    })),
    global_rules: HUMAN_DISCOURSE_GLOBAL_RULES,
  };
}

export function normalizeDevelopmentDiagnosis(raw = {}, units = []) {
  const byId = new Map(units.map((unit) => [unit.block_id, unit]));
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.slice(0, 18).map((row, index) => {
    const unit = byId.get(clean(row?.block_id, 80));
    if (!unit || unit.type === "heading") return null;
    const action = clean(row?.action, 80).toLowerCase();
    const scope = clean(row?.scope, 40).toLowerCase();
    const sensitivity = clean(row?.verification_sensitivity, 40).toLowerCase();
    return {
      id: clean(row?.id, 80) || `task-${index + 1}`,
      block_id: unit.block_id,
      paragraph_index: unit.paragraph_index,
      section: clean(row?.section, 200) || unit.section,
      scope: SCOPES.has(scope) ? scope : "paragraph",
      action: ACTIONS.has(action) ? action : "respond_in_own_words",
      anchor: clean(row?.anchor, 500) || unit.text.slice(0, 240),
      diagnosis: clean(row?.diagnosis, 1800),
      question: clean(row?.question, 1800),
      why_it_matters: clean(row?.why_it_matters, 1400),
      preserve: clean(row?.preserve, 1400),
      verification_sensitivity: ["low", "conditional", "high"].includes(sensitivity) ? sensitivity : "conditional",
      source_text: unit.text,
    };
  }).filter((task) => task?.question && task?.diagnosis) : [];

  const tasked = new Set(tasks.map((task) => task.block_id));
  const coverage = units.map((unit) => ({
    block_id: unit.block_id,
    paragraph_index: unit.paragraph_index,
    section: unit.section,
    type: unit.type,
    decision: unit.type === "heading" ? "structural_marker" : tasked.has(unit.block_id) ? "author_action" : "leave_for_now",
  }));
  return {
    overview: clean(raw.overview, 2400),
    tasks,
    coverage,
    diagnosis_version: "researcher-development-v1",
  };
}

export function integrateRawAuthorContributions(manuscriptText, contributions = []) {
  const units = buildManuscriptDevelopmentUnits(manuscriptText);
  const byTarget = new Map();
  for (const row of Array.isArray(contributions) ? contributions.slice(0, 30) : []) {
    const blockId = clean(row?.block_id, 80);
    const rawText = String(row?.raw_text ?? "").trim();
    const status = clean(row?.researcher_status, 40).toLowerCase();
    const operation = clean(row?.operation, 40).toLowerCase();
    if (!blockId || !rawText || status !== "accepted" || !OPERATIONS.has(operation) || operation === "notes_only") continue;
    if (!byTarget.has(blockId)) byTarget.set(blockId, []);
    byTarget.get(blockId).push({
      contribution_id: clean(row?.contribution_id, 80) || `contribution-${byTarget.get(blockId).length + 1}`,
      operation,
      raw_text: rawText,
    });
  }

  const output = [];
  const ledger = [];
  for (const unit of units) {
    const rows = byTarget.get(unit.block_id) || [];
    const before = rows.filter((row) => row.operation === "insert_before");
    const replacements = rows.filter((row) => row.operation === "replace_block");
    const after = rows.filter((row) => row.operation === "append_after");
    output.push(...before.map((row) => row.raw_text));
    output.push(replacements.length ? replacements.map((row) => row.raw_text).join("\n\n") : unit.text);
    output.push(...after.map((row) => row.raw_text));
    for (const row of [...before, ...replacements, ...after]) {
      ledger.push({
        contribution_id: row.contribution_id,
        block_id: unit.block_id,
        paragraph_index: unit.paragraph_index,
        section: unit.section,
        operation: row.operation,
        raw_text: row.raw_text,
        transformation: "none",
      });
    }
  }

  return {
    draft: output.join("\n\n").trim(),
    ledger,
    contribution_count: ledger.length,
    note: "Accepted researcher wording was inserted exactly as supplied. No language model, polishing, paraphrasing or clarity edit was applied.",
  };
}
