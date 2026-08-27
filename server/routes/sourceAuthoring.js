import { Router } from "express";
import { llmProvider, HealthState } from "../lib/llmProvider.js";
import { extractJsonObject } from "../lib/researcherAgency.js";
import {
  deterministicSourceAssembly,
  normalizeGuidedPlan,
  verifyAssemblyExtracts,
} from "../lib/sourceGroundedAuthoring.js";

export const sourceAuthoringRouter = Router();

const GUIDED_ORDERING_SYSTEM = `You organise a source-led academic research scaffold.
The payload contains section headings and candidate passages copied exactly from researcher-supplied studies.
Select and order only the supplied extract IDs. Never rewrite, shorten, merge, paraphrase or correct an extract.
You may add a minimal link before a later extract. A link must only name the relationship between passages; it must not restate evidence, invent a fact, resolve a disagreement, or produce polished synthesis. Keep every link under 28 words.
Do not add an introduction or conclusion. Do not answer the research question. The researcher will review the scaffold and develop the reasoning.
Return valid JSON only:
{"sections":[{"section_id":"section-1","ordered_extract_ids":["src-1-extract-1"],"links":[{"before_extract_id":"src-2-extract-3","relationship":"supports|contrasts|extends|qualifies|context","link":"minimal connection"}]}]}`;

function cleanString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanSources(value) {
  return (Array.isArray(value) ? value : []).slice(0, 12).map((source, index) => ({
    id: cleanString(source?.id, 80) || `source-${index + 1}`,
    title: cleanString(source?.title || source?.name, 300) || `Source ${index + 1}`,
    citation: cleanString(source?.citation, 500),
    locator: cleanString(source?.locator, 200),
    text: cleanString(source?.text, 60000),
  })).filter((source) => source.text);
}

sourceAuthoringRouter.post("/source-authoring/assemble", llmProvider.usageMiddleware, async (req, res) => {
  const entryMode = ["template", "rebuild", "develop"].includes(req.body?.entryMode) ? req.body.entryMode : "develop";
  const structureText = cleanString(req.body?.structureText, 30000);
  const sources = cleanSources(req.body?.sources);
  const guided = req.body?.guided === true;

  if (!structureText) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Provide the template, existing draft, researcher guide or section brief that should govern the extraction.", requestId: req.requestId });
  }
  if (!sources.length) {
    return res.status(400).json({ error: "BAD_REQUEST", message: "Add at least one readable study before building the source-led draft.", requestId: req.requestId });
  }

  const local = deterministicSourceAssembly({ entryMode, structureText, sources });
  if (!local.extract_count) {
    return res.status(422).json({ error: "NO_RELEVANT_EXTRACTS", message: "No relevant verbatim passages were retrieved. Add clearer section guidance or more closely related studies.", local, requestId: req.requestId });
  }

  if (!guided) {
    return res.json({ ...local, extraction_verified: verifyAssemblyExtracts(local, sources), persistence: "browser_session", requestId: req.requestId });
  }

  if (!llmProvider.isConfigured()) {
    return res.json({
      ...local,
      warning: "Guided ordering was unavailable, so the zero-credit local ordering was returned.",
      extraction_verified: verifyAssemblyExtracts(local, sources),
      persistence: "browser_session",
      requestId: req.requestId,
    });
  }

  try {
    const compact = local.sections.map((section) => ({
      section_id: section.id,
      heading: section.heading,
      candidates: section.blocks.filter((block) => block.type === "extract").map((block) => ({
        extract_id: block.id,
        source_title: block.source_title,
        locator: block.locator,
        text: block.text,
      })),
    }));
    const result = await llmProvider.callAnthropic({
      system: GUIDED_ORDERING_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ entry_mode: entryMode, researcher_structure: structureText, sections: compact }) }],
      maxTokens: 3200,
    });
    const guidedAssembly = normalizeGuidedPlan(extractJsonObject(result.text), local);
    const verified = verifyAssemblyExtracts(guidedAssembly, sources);
    if (!verified.exact) {
      return res.json({ ...local, warning: "Guided ordering was rejected because an extract failed exact-source verification; the local exact assembly was retained.", extraction_verified: verifyAssemblyExtracts(local, sources), persistence: "browser_session", requestId: req.requestId });
    }
    return res.json({ ...guidedAssembly, extraction_verified: verified, persistence: "browser_session", requestId: req.requestId });
  } catch (error) {
    const providerUnavailable = [HealthState.PROVIDER_ERROR, HealthState.PROVIDER_UNAVAILABLE, HealthState.RATE_LIMITED].includes(error?.healthState);
    if (!providerUnavailable) console.error(JSON.stringify({ event: "source_authoring_guided_failure", requestId: req.requestId, message: error?.message || "unknown" }));
    return res.json({ ...local, warning: "Guided ordering could not complete, so the zero-credit local ordering was returned without losing the extracted passages.", extraction_verified: verifyAssemblyExtracts(local, sources), persistence: "browser_session", requestId: req.requestId });
  }
});
