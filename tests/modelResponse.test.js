import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripCodeFence,
  extractJsonEnvelope,
  parseStructuredResponseText,
  buildJsonRepairSystemPrompt,
} from "../server/lib/modelResponse.js";

test("parses a normal structured model response", () => {
  const raw = JSON.stringify({
    revised_text: "The writer asks, \"How can I rewrite this?\" before revising the passage.",
    edit_summary: {
      kept: 1,
      micro_edits: 0,
      sentence_restructures: 1,
      split_or_merge: 0,
      paragraph_reorders: 0,
      flags_for_author: [],
    },
    diagnostics_notes: "Quotation marks remain safe inside JSON.",
  });
  const result = parseStructuredResponseText(raw);
  assert.equal(result.ok, true);
  assert.match(result.parsed.revised_text, /"How can I rewrite this\?"/);
});

test("recovers JSON wrapped in a markdown fence", () => {
  const raw = "```json\n{\"revised_text\":\"Text\",\"edit_summary\":{},\"diagnostics_notes\":\"ok\"}\n```";
  assert.equal(stripCodeFence(raw).startsWith("{"), true);
  assert.equal(parseStructuredResponseText(raw).ok, true);
});

test("recovers an otherwise valid JSON envelope from surrounding provider prose", () => {
  const raw = "Here is the requested object:\n{\"revised_text\":\"Text\",\"edit_summary\":{},\"diagnostics_notes\":\"ok\"}\nDone.";
  assert.equal(extractJsonEnvelope(raw).startsWith("{"), true);
  const result = parseStructuredResponseText(raw);
  assert.equal(result.ok, true);
  assert.equal(result.recovered, true);
});

test("malformed embedded quotes are rejected deterministically for the one-pass syntax repair path", () => {
  const malformed = '{"revised_text":"The engine asks "How can I rewrite this?" before acting","edit_summary":{},"diagnostics_notes":"x"}';
  const result = parseStructuredResponseText(malformed);
  assert.equal(result.ok, false);
  assert.match(buildJsonRepairSystemPrompt(), /syntax-recovery utility/i);
  assert.match(buildJsonRepairSystemPrompt(), /Do not rewrite/i);
});
