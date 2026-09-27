import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import {
  sourceAuthoringRouter,
  planSynthesisGroups,
  estimateSynthesisTokens,
  mergeSynthesisGroups,
  SYNTHESIS_MAX_TOKENS,
} from "../server/routes/sourceAuthoring.js";

const source = {
  id: "anderson",
  title: "Anderson et al. (2004)",
  bibliographic: { title: "Board Characteristics and the Cost of Debt", author: "Anderson et al.", year: "2004", metadata_confidence: "researcher_reviewed" },
  text: "[Page 7]\nGreater board independence is associated with lower debt financing costs because creditors value reliable monitoring arrangements. The relation is stronger where reporting oversight reduces information uncertainty. Audit committee independence is associated with lower bond yields because lenders rely on accounting information when pricing debt. Ownership concentration can weaken board monitoring and raise the cost of debt where controlling shareholders extract private benefits.",
};

const HEADINGS = [
  "Introduction", "Conceptual Review", "Board Independence", "Board Size", "Audit Committee",
  "Ownership Structure", "Institutional Ownership", "Managerial Ownership", "Cost of Debt",
  "Agency Theory", "Stakeholder Theory", "Empirical Review", "Board Diversity", "Research Gap", "Summary",
];
const chapter = `CHAPTER TWO\n\n${HEADINGS.map((heading) => `${heading}\nBoard independence, audit committee monitoring and ownership structure may reduce the cost of debt because lenders price monitoring and information quality (Anderson et al., 2004).`).join("\n\n")}`;

// A stand-in provider that answers whatever sections it is sent, like the real model.
function answerFor(packet, { quoteText } = {}) {
  const sections = packet.sections.map((section) => section.section_id);
  return {
    notebook: {
      document_position: "Monitoring lowers the cost of debt, conditionally.",
      sections: packet.sections.map((section) => ({
        section_id: section.section_id,
        section_purpose: "Relate the evidence to the section's claim.",
        points: [{ id: `${section.section_id}-point-1`, proposition: "Monitoring matters to lenders.", relationship: "supports", author_paragraph_ids: section.author_paragraphs.map((row) => row.paragraph_id), evidence_ids: section.evidence.slice(0, 1).map((row) => row.extract_id), reasoning_note: "Compare, do not list.", tension_or_boundary: "Depends on ownership." }],
      })),
    },
    sections: packet.sections.map((section) => ({
      section_id: section.section_id,
      paragraphs: [{
        text: `In ${section.heading.toLowerCase()}, lenders appear to price monitoring quality [[CITE:anderson]]${quoteText ? " [[QUOTE:quote-1]]" : ""}.`,
        used_point_ids: [`${section.section_id}-point-1`],
        used_extract_ids: section.evidence.slice(0, 1).map((row) => row.extract_id),
      }],
    })),
    quotes: quoteText ? [{ id: "quote-1", extract_id: packet.sections.find((row) => row.evidence.length)?.evidence[0].extract_id, text: quoteText }] : [],
    warnings: [],
    _sections: sections,
  };
}

async function postSynthesis(structureText, provider, { targetWords = 1500, quotePolicy = "selective" } = {}) {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousFetch = global.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key";
  const requests = [];
  global.fetch = async (url, options) => {
    if (!String(url).startsWith("https://api.anthropic.com")) return previousFetch(url, options);
    const body = JSON.parse(options.body);
    const packet = JSON.parse(body.messages[0].content);
    requests.push({ body, packet });
    const reply = provider(packet, requests.length);
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  };
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", sourceAuthoringRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await previousFetch(`http://127.0.0.1:${server.address().port}/api/source-authoring/synthesize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryMode: "rebuild", structureText, targetWords, quotePolicy, sources: [source] }),
    });
    return { status: response.status, body: await response.json(), requests };
  } finally {
    server.close();
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
}

const ok = (payload) => ({ content: [{ type: "text", text: JSON.stringify(payload) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } });

test("chapter sections are split into groups that each fit one call with headroom", () => {
  const sections = HEADINGS.map((heading, index) => ({ section_id: `section-${index + 1}`, heading }));
  const groups = planSynthesisGroups(sections, 1500);
  assert.ok(groups.length > 1);
  assert.deepEqual(groups.flatMap((group) => group.sections), sections);
  for (const group of groups) assert.ok(estimateSynthesisTokens(group.targetWords, group.sections.length) <= 9000);
  assert.equal(planSynthesisGroups(sections.slice(0, 1), 1500).length, 1);
});

test("a full chapter synthesis returns every section across several calls", async () => {
  const { status, body, requests } = await postSynthesis(chapter, (packet) => ok(answerFor(packet)));
  assert.equal(status, 200, body.message);
  assert.ok(requests.length > 1);
  assert.equal(body.model_calls, requests.length);
  const sentSections = requests.flatMap((request) => request.packet.sections.map((section) => section.section_id));
  assert.equal(new Set(sentSections).size, sentSections.length);
  for (const request of requests) assert.equal(request.body.max_tokens, SYNTHESIS_MAX_TOKENS);
  for (const heading of HEADINGS) assert.match(body.synthesis_text, new RegExp(`In ${heading.toLowerCase()}`));
});

test("quotations keep the right text after groups are merged", () => {
  const merged = mergeSynthesisGroups([
    { sections: [{ section_id: "section-1", paragraphs: [{ text: "A [[QUOTE:quote-1]]", used_point_ids: ["point-1"] }] }], quotes: [{ id: "quote-1", text: "first" }] },
    { sections: [{ section_id: "section-2", paragraphs: [{ text: "B [[QUOTE:quote-1]]", used_point_ids: ["point-1"] }] }], quotes: [{ id: "quote-1", text: "second" }] },
  ]);
  assert.deepEqual(merged.quotes.map((quote) => quote.id), ["g1-quote-1", "g2-quote-1"]);
  assert.equal(merged.sections[0].paragraphs[0].text, "A [[QUOTE:g1-quote-1]]");
  assert.equal(merged.sections[1].paragraphs[0].text, "B [[QUOTE:g2-quote-1]]");
  assert.deepEqual(merged.sections[1].paragraphs[0].used_point_ids, ["g2-point-1"]);
});

test("a group that runs past the limit is split and retried instead of failing the draft", async () => {
  const { status, body, requests } = await postSynthesis(chapter, (packet) => (
    packet.sections.length > 4
      ? { content: [{ type: "text", text: '{"notebook":{"sections":[{"section_id":"section-1","points":[' }], stop_reason: "max_tokens", usage: { input_tokens: 10, output_tokens: 10 } }
      : ok(answerFor(packet))
  ));
  assert.equal(status, 200, body.message);
  assert.ok(requests.some((request) => request.packet.sections.length <= 4));
  for (const heading of HEADINGS) assert.match(body.synthesis_text, new RegExp(`In ${heading.toLowerCase()}`));
});

test("a single section that still runs past the limit returns a plain message", async () => {
  const { status, body } = await postSynthesis("Literature Review\nBoard independence may reduce debt financing costs (Anderson et al., 2004).", () => (
    { content: [{ type: "text", text: '{"notebook":' }], stop_reason: "max_tokens", usage: { input_tokens: 10, output_tokens: 10 } }
  ));
  assert.equal(status, 502);
  assert.equal(body.error, "SYNTHESIS_TRUNCATED");
  assert.doesNotMatch(body.message, /JSON|position/);
});

test("an unreadable synthesis response is reported plainly", async () => {
  const { status, body } = await postSynthesis("Literature Review\nBoard independence may reduce debt financing costs (Anderson et al., 2004).", () => (
    { content: [{ type: "text", text: '{"notebook": {"sections": [1 2]}}' }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }
  ));
  assert.equal(status, 502);
  assert.equal(body.error, "SYNTHESIS_UNREADABLE");
});

test("each group's exact quotation is verified and inserted after merging", async () => {
  const { status, body, requests } = await postSynthesis(chapter, (packet) => {
    const words = String(packet.sections.find((row) => row.evidence.length)?.evidence[0].text || "").split(/\s+/).slice(0, 8).join(" ");
    return ok(answerFor(packet, { quoteText: words }));
  }, { quotePolicy: "selective" });
  assert.equal(status, 200, body.message);
  assert.equal((body.verified_quotes || []).length, requests.length);
  assert.equal(new Set(body.verified_quotes.map((quote) => quote.id)).size, requests.length);
  assert.doesNotMatch(body.synthesis_text, /\[\[QUOTE:/);
  assert.deepEqual(body.synthesis_audit.missing_planned_point_ids, []);
});
