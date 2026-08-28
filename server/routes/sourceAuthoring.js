import { Router } from "express";
import { llmProvider, HealthState } from "../lib/llmProvider.js";
import { extractJsonObject } from "../lib/researcherAgency.js";
import {
  deterministicSourceAssembly,
  normalizeGuidedPlan,
  verifyAssemblyExtracts,
} from "../lib/sourceGroundedAuthoring.js";

export const sourceAuthoringRouter = Router();

const GUIDED_ORDERING_SYSTEM = `You are an academic evidence adjudicator, not a prose writer.
The payload contains author paragraphs or section briefs plus exact candidate passages from uploaded studies. Candidates have already been stripped of obvious title-page furniture and tagged by research function.

Your job is to decide whether a candidate directly supplies the problem, theory/mechanism, method/measure, finding, boundary/contrast, or implication required by the author text. Do not reward shared topic words alone.

NON-NEGOTIABLE RULES:
- Select only supplied extract IDs. Never rewrite, shorten, merge, paraphrase, correct or quote a different passage.
- Never select an article title, byline, affiliation, DOI, page header, reference entry, table fragment or unrelated methodological passage.
- For a citation-bearing author paragraph, the selected source identity must match at least one cited author and year. If the matching study is absent, metadata is uncertain, or no passage directly addresses the claim, return no match for that paragraph.
- A passage can support, contrast with, qualify, define, supply a mechanism, supply a method/measure, or supply a finding. State the relationship honestly.
- Do not force coverage. Abstention is better than a plausible but unrelated extract.
- A link may only name the relationship between adjacent material. It must not invent or restate evidence, and must remain under 28 words.

For an existing draft/template, return:
{"matches":[{"paragraph_id":"section-1-author-1","extract_id":"src-1-extract-1","relationship":"supports|contrasts|qualifies|defines|supplies_mechanism|supplies_method_or_measure|supplies_finding|context","reason":"why this exact passage answers this claim","link":"minimal connection"}]}

For a ground-up manuscript, return:
{"sections":[{"section_id":"section-1","ordered_extract_ids":["src-1-extract-1"],"links":[{"before_extract_id":"src-2-extract-3","relationship":"supports|contrasts|extends|qualifies|context","link":"minimal connection"}]}]}

Return valid JSON only.`;

function cleanString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clientAssembly(assembly) {
  const { candidate_pool: _serverOnlyCandidates, ...safe } = assembly || {};
  return safe;
}

function cleanSources(value) {
  return (Array.isArray(value) ? value : []).slice(0, 12).map((source, index) => ({
    id: cleanString(source?.id, 80) || `source-${index + 1}`,
    title: cleanString(source?.title || source?.name, 300) || `Source ${index + 1}`,
    citation: cleanString(source?.citation, 500),
    bibliographic: {
      title: cleanString(source?.bibliographic?.title || source?.title || source?.name, 500),
      author: cleanString(source?.bibliographic?.author || source?.author, 500),
      year: cleanString(source?.bibliographic?.year || source?.year, 20),
      publication: cleanString(source?.bibliographic?.publication || source?.publication, 500),
      doi: cleanString(source?.bibliographic?.doi || source?.doi, 300),
      url: cleanString(source?.bibliographic?.url || source?.url, 500),
      metadata_confidence: cleanString(source?.bibliographic?.metadata_confidence || source?.metadata_confidence, 30),
    },
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
  const candidateCount = (local.candidate_pool || []).reduce((sum, section) => sum + (section.candidates || []).length, 0);
  if (!local.extract_count && !candidateCount) {
    return res.status(422).json({ error: "NO_RELEVANT_EXTRACTS", message: "No substantive source passages were retrieved. Add clearer section guidance or more closely related studies.", local: clientAssembly(local), requestId: req.requestId });
  }

  if (!guided) {
    return res.json({ ...clientAssembly(local), extraction_verified: verifyAssemblyExtracts(local, sources), persistence: "browser_session", requestId: req.requestId });
  }

  if (!llmProvider.isConfigured()) {
    return res.json({
      ...clientAssembly(local),
      warning: "Deep claim-to-evidence selection was unavailable, so the zero-credit evidence map was returned.",
      extraction_verified: verifyAssemblyExtracts(local, sources),
      persistence: "browser_session",
      requestId: req.requestId,
    });
  }

  try {
    const compact = (local.candidate_pool || []).map((section) => ({
      section_id: section.section_id,
      heading: section.heading,
      paragraphs: (section.paragraphs || []).map((paragraph) => ({
        paragraph_id: paragraph.id,
        text: paragraph.text,
        citation_anchors: paragraph.citation_anchors,
      })),
      candidates: (section.candidates || []).map((block) => ({
        extract_id: block.id,
        source_title: block.source_title,
        citation: block.citation,
        source_author: block.bibliographic?.author,
        source_year: block.bibliographic?.year,
        metadata_confidence: block.bibliographic?.metadata_confidence,
        locator: block.locator,
        research_functions: block.research_functions,
        text: block.text,
      })),
    }));
    const result = await llmProvider.callAnthropic({
      system: GUIDED_ORDERING_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ entry_mode: entryMode, researcher_structure: structureText, sections: compact }) }],
      maxTokens: 4000,
    });
    const guidedAssembly = normalizeGuidedPlan(extractJsonObject(result.text), local);
    const verified = verifyAssemblyExtracts(guidedAssembly, sources);
    if (!verified.exact) {
      return res.json({ ...clientAssembly(local), warning: "Guided selection was rejected because an extract failed exact-source verification; the local exact assembly was retained.", extraction_verified: verifyAssemblyExtracts(local, sources), persistence: "browser_session", requestId: req.requestId });
    }
    return res.json({ ...clientAssembly(guidedAssembly), extraction_verified: verified, persistence: "browser_session", requestId: req.requestId });
  } catch (error) {
    const providerUnavailable = [HealthState.PROVIDER_ERROR, HealthState.PROVIDER_UNAVAILABLE, HealthState.RATE_LIMITED].includes(error?.healthState);
    if (!providerUnavailable) console.error(JSON.stringify({ event: "source_authoring_guided_failure", requestId: req.requestId, message: error?.message || "unknown" }));
    return res.json({ ...clientAssembly(local), warning: "Guided selection could not complete, so the zero-credit evidence map was returned without losing the accepted passages.", extraction_verified: verifyAssemblyExtracts(local, sources), persistence: "browser_session", requestId: req.requestId });
  }
});
