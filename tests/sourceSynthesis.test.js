import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSourceSynthesisPacket,
  normalizeSourceSynthesis,
} from "../server/lib/sourceSynthesis.js";

const reviewedSources = [
  {
    id: "anderson",
    citation: "Anderson et al. (2004)",
    bibliographic: {
      title: "Board Characteristics and the Cost of Debt",
      author: "Anderson et al.",
      year: "2004",
      publication: "Journal of Accounting and Economics",
      metadata_confidence: "researcher_reviewed",
    },
    text: "[Page 7]\nGreater board independence is associated with lower debt financing costs because creditors value reliable monitoring arrangements. The relation is stronger where reporting oversight reduces information uncertainty.",
  },
  {
    id: "bradley",
    citation: "Bradley and Chen (2015)",
    bibliographic: {
      title: "Board Independence and Credit Conditions",
      author: "Bradley and Chen",
      year: "2015",
      publication: "Review of Finance",
      metadata_confidence: "researcher_reviewed",
    },
    text: "[Page 11]\nBoard independence reduces debt cost when shareholder and creditor conflict is mild. When that conflict becomes severe, the same governance arrangement can increase creditor exposure and loan spreads.",
  },
];

function makeBuild(extra = {}) {
  return buildSourceSynthesisPacket({
    entryMode: "rebuild",
    structureText: "Literature Review\nBoard independence may reduce creditor uncertainty, although the relationship changes with credit conditions (Anderson et al., 2004; Bradley and Chen, 2015).",
    sources: reviewedSources,
    targetWords: 900,
    quotePolicy: "selective",
    ...extra,
  });
}

function synthesisRaw(build, paragraphText, { quote = null, usedExtractIds = null } = {}) {
  const section = build.packet.sections[0];
  const evidenceIds = usedExtractIds || section.evidence.slice(0, 2).map((row) => row.extract_id);
  return {
    notebook: {
      document_position: "Board independence may reduce debt cost, but the direction is conditional on creditor conflict.",
      sections: [{
        section_id: section.section_id,
        section_purpose: "Compare the baseline monitoring result with its boundary condition.",
        points: [{
          id: "point-1",
          proposition: "Monitoring benefits are conditional rather than universal.",
          relationship: "qualifies",
          author_paragraph_ids: section.author_paragraphs.map((row) => row.paragraph_id),
          evidence_ids: evidenceIds,
          reasoning_note: "Set the studies against one another instead of listing them.",
          tension_or_boundary: "The sign changes as creditor conflict becomes severe.",
        }],
      }],
    },
    sections: [{
      section_id: section.section_id,
      paragraphs: [{ text: paragraphText, used_point_ids: ["point-1"], used_extract_ids: evidenceIds }],
    }],
    quotes: quote ? [quote] : [],
    warnings: [],
  };
}

test("source-synthesis packet excludes unreviewed identities and carries thesis-derived reasoning guidance", () => {
  const unreviewed = {
    ...reviewedSources[1],
    bibliographic: { ...reviewedSources[1].bibliographic, metadata_confidence: "auto_complete_review_required" },
  };
  const build = makeBuild({ sources: [reviewedSources[0], unreviewed] });
  assert.deepEqual(build.packet.source_records.map((row) => row.source_id), ["anderson"]);
  assert.deepEqual(build.packet.excluded_unreviewed_source_ids, ["bradley"]);
  assert.ok(build.candidate_count > 0);
  assert.equal(build.packet.sections[0].human_discourse_guidance.rhetorical_job, "literature");
  assert.ok(build.packet.sections[0].human_discourse_guidance.moves.length > 0);
  assert.ok(build.packet.human_discourse_global_rules.some((rule) => /visible intellectual work/i.test(rule)));
});

test("synthesis resolves controlled citations and inserts an exact verified quotation", () => {
  const build = makeBuild();
  const evidence = build.packet.sections[0].evidence;
  const anderson = evidence.find((row) => row.source_id === "anderson" && row.text.startsWith("Greater board independence"));
  const bradley = evidence.find((row) => row.source_id === "bradley");
  assert.ok(anderson && bradley);
  const raw = synthesisRaw(
    build,
    "The monitoring account begins with [[QUOTE:q1]]. A second study makes the direction conditional on the severity of creditor conflict [[CITE:bradley]].",
    {
      quote: {
        id: "q1",
        extract_id: anderson.extract_id,
        text: "Greater board independence is associated with lower debt financing costs",
      },
      usedExtractIds: [anderson.extract_id, bradley.extract_id],
    },
  );
  const result = normalizeSourceSynthesis(raw, build);
  assert.match(result.synthesis_text, /“Greater board independence is associated with lower debt financing costs”/);
  assert.match(result.synthesis_text, /\(Anderson et al\., 2004, p\. 7\)/);
  assert.match(result.synthesis_text, /\(Bradley and Chen, 2015\)/);
  assert.equal(result.synthesis_audit.verified_quote_count, 1);
  assert.equal(result.synthesis_audit.cited_sources, 2);
  assert.equal(result.synthesis_audit.status, "researcher_review_required");
  assert.equal(result.synthesis_audit.target_range_met, false);
});

test("a used evidence passage receives its citation even when the model omitted the citation token", () => {
  const build = makeBuild({ quotePolicy: "none" });
  const evidence = build.packet.sections[0].evidence.find((row) => row.text.split(/\s+/).length >= 12);
  assert.ok(evidence);
  const raw = synthesisRaw(build, "The result makes monitoring relevant to creditor assessment.", { usedExtractIds: [evidence.extract_id] });
  const result = normalizeSourceSynthesis(raw, build);
  assert.match(result.synthesis_text, /\([^)]+, 20\d{2}\)\.$/m);
  assert.equal(result.synthesis_audit.citation_insertions, 1);
  assert.equal(result.synthesis_audit.status, "researcher_review_required");
  assert.equal(result.synthesis_audit.target_range_met, false);
});

test("a failed quotation check never erases the completed synthesis", () => {
  const build = makeBuild();
  const evidence = build.packet.sections[0].evidence[0];
  const raw = synthesisRaw(build, "The source states [[QUOTE:q-bad]] and the comparison remains conditional [[CITE:anderson]].", {
    quote: { id: "q-bad", extract_id: evidence.extract_id, text: "This sentence was never present in the uploaded source material" },
    usedExtractIds: [evidence.extract_id],
  });
  const result = normalizeSourceSynthesis(raw, build);
  assert.ok(result.synthesis_text.length > 40);
  assert.match(result.synthesis_text, /verbatim passage needs researcher review/i);
  assert.deepEqual(result.synthesis_audit.invalid_quote_ids, ["q-bad"]);
  assert.equal(result.synthesis_audit.status, "researcher_review_required");
});

test("long unmarked source copying is exposed for researcher review", () => {
  const build = makeBuild({ quotePolicy: "none" });
  const evidence = build.packet.sections[0].evidence.find((row) => row.text.split(/\s+/).length >= 12);
  assert.ok(evidence);
  const raw = synthesisRaw(build, `${evidence.text} [[CITE:${evidence.source_id}]]`, { usedExtractIds: [evidence.extract_id] });
  const result = normalizeSourceSynthesis(raw, build);
  assert.ok(result.synthesis_audit.unmarked_verbatim_matches.length > 0);
  assert.equal(result.synthesis_audit.status, "researcher_review_required");
  assert.ok(result.synthesis_text.length > 40);
});
