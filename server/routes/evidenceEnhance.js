import { Router } from "express";
import { llmProvider, HealthState } from "../lib/llmProvider.js";
import {
  extractJsonObject,
  normalizeArgumentMap,
  normalizeEvidenceLinks,
} from "../lib/researcherAgency.js";

export const evidenceEnhanceRouter = Router();

const EVIDENCE_ENHANCE_SYSTEM = `You are the evidence-development pass of an academic manuscript system.

The BASE DRAFT is already a reworked manuscript candidate. Improve THAT candidate; do not discard it and write a new generic essay from the argument map.

The researcher's explicitly approved argument map is the intellectual authority. Explicitly approved evidence links are the only external evidence you may introduce. Use no unsupported fact, date, number, citation, theory, finding, variable, method or causal claim.

Your job is selective evidence-led development:
- strengthen an under-supported claim when approved evidence genuinely supports it;
- qualify or narrow a claim when the approved evidence is conditional or mixed;
- distinguish measures, settings, time periods or mechanisms when that distinction improves the argument;
- contextualise a claim when evidence provides relevant setting or temporal information;
- develop an under-explained mechanism only when it is licensed by the approved argument map and/or approved evidence;
- leave already sufficient passages substantially intact.

Do NOT make every paragraph follow claim -> evidence -> interpretation -> synthesis. Do NOT append a polished summary sentence to every paragraph. Do NOT expand simply to increase word count. Do NOT optimise for, target, or claim to defeat any AI detector.

Preserve the BASE DRAFT's formal structure by default: title-page information, degree/programme lines, section and subsection headings, research questions, hypotheses, equations, tables/figure labels, variable names, study period, population, methodology, study stage/tense, existing citations, quotations and numerical claims. If evidence adds a new citation, it must come from the supplied evidence link exactly.

Return VALID JSON ONLY:
{
  "draft": "the evidence-enhanced version of the BASE DRAFT",
  "used_argument_ids": ["arg-1"],
  "used_evidence_ids": ["evidence-1"],
  "warnings": ["anything requiring researcher review"],
  "agency_note": "brief explanation of how the approved reasoning/evidence changed the base draft",
  "evidence_changes": [
    {
      "evidence_id": "evidence-1",
      "argument_id": "arg-1",
      "operation": "support|qualify|contradict|contextualise|distinguish_measure|develop_mechanism",
      "summary": "what changed and why"
    }
  ]
}`;

function shortString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sanitizeStyleFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return {};
  const out = {};
  for (const [key, value] of Object.entries(filters).slice(0, 12)) {
    if (typeof key === "string" && typeof value === "string") out[key.slice(0, 80)] = value.slice(0, 160);
  }
  return out;
}

function providerError(res, err, requestId) {
  const state = err?.healthState || HealthState.PROVIDER_ERROR;
  const status = state === HealthState.NOT_CONFIGURED ? 503 : state === HealthState.RATE_LIMITED ? 429 : 502;
  return res.status(status).json({ error: state, message: err?.message || "Evidence enhancement service unavailable.", requestId });
}

function evidenceLimit(depth) {
  if (depth === "minimal") return 6;
  if (depth === "extensive") return 30;
  return 16;
}

evidenceEnhanceRouter.post("/research/evidence-enhance-candidate", async (req, res) => {
  const baseDraft = shortString(req.body?.baseDraft, 70000);
  const sourceText = shortString(req.body?.sourceText, 70000);
  const argumentMap = normalizeArgumentMap(req.body?.argumentMap || {});
  const evidenceLinks = normalizeEvidenceLinks({ links: req.body?.evidenceLinks || [] });
  const styleFilters = sanitizeStyleFilters(req.body?.styleFilters);
  const constraints = shortString(req.body?.constraints, 4000);
  const evidenceDepth = ["minimal", "targeted", "extensive"].includes(req.body?.evidenceDepth)
    ? req.body.evidenceDepth
    : "targeted";
  const includeEvidence = req.body?.includeEvidence !== false;

  if (!baseDraft) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "A reworked `baseDraft` is required for evidence enhancement.", requestId: req.requestId });
  }
  if (!includeEvidence) {
    return res.status(400).json({ error: "EVIDENCE_DISABLED", message: "Include Evidence is off for this workflow. The base draft was not evidence-enhanced.", requestId: req.requestId });
  }

  const approvedNodes = argumentMap.nodes.filter((node) => ["accepted", "modified"].includes(node.researcher_status));
  if (!approvedNodes.length) {
    return res.status(400).json({ error: "NO_APPROVED_ARGUMENTS", message: "Explicitly accept or modify at least one argument node before evidence enhancement.", requestId: req.requestId });
  }

  const usableEvidence = evidenceLinks
    .filter((link) => ["accepted", "modified"].includes(link.researcher_status))
    .filter((link) => !["insufficient", "candidate"].includes(link.relationship))
    .slice(0, evidenceLimit(evidenceDepth));

  if (!usableEvidence.length) {
    return res.status(400).json({ error: "NO_APPROVED_EVIDENCE", message: "No explicitly researcher-approved evidential links are available. Align evidence and choose Accept link or Accept with my interpretation before enhancing the reworked candidate.", requestId: req.requestId });
  }

  try {
    const result = await llmProvider.callAnthropic({
      system: EVIDENCE_ENHANCE_SYSTEM,
      messages: [{
        role: "user",
        content: JSON.stringify({
          base_draft: baseDraft,
          source_text_for_fidelity_reference: sourceText || null,
          approved_argument_nodes: approvedNodes,
          boundaries: argumentMap.boundaries,
          researcher_decisions: argumentMap.researcher_decisions,
          approved_evidence_links: usableEvidence,
          academic_context: styleFilters,
          evidence_depth: evidenceDepth,
          additional_constraints: constraints || null,
          instruction: "Improve the supplied BASE DRAFT selectively with the explicitly approved evidence. Preserve its research architecture and do not rewrite unaffected passages merely for variation.",
        }),
      }],
      maxTokens: 8000,
    });

    const raw = extractJsonObject(result.text);
    const changes = Array.isArray(raw.evidence_changes) ? raw.evidence_changes.slice(0, 40).map((row) => ({
      evidence_id: shortString(row?.evidence_id, 80),
      argument_id: shortString(row?.argument_id, 80),
      operation: shortString(row?.operation, 80),
      summary: shortString(row?.summary, 1200),
    })).filter((row) => row.summary) : [];

    return res.json({
      draft: shortString(raw.draft, 70000),
      used_argument_ids: Array.isArray(raw.used_argument_ids) ? raw.used_argument_ids.slice(0, 60).map((x) => shortString(x, 80)).filter(Boolean) : [],
      used_evidence_ids: Array.isArray(raw.used_evidence_ids) ? raw.used_evidence_ids.slice(0, 120).map((x) => shortString(x, 80)).filter(Boolean) : [],
      warnings: Array.isArray(raw.warnings) ? raw.warnings.slice(0, 20).map((x) => shortString(x, 1200)).filter(Boolean) : [],
      agency_note: shortString(raw.agency_note, 2400),
      evidence_changes: changes,
      base_draft_used: true,
      evidence_depth: evidenceDepth,
      note: "This pass develops the reworked candidate from explicitly researcher-approved evidence. It does not use detector scores as generation targets.",
      requestId: req.requestId,
    });
  } catch (err) {
    return providerError(res, err, req.requestId);
  }
});
