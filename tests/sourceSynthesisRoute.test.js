import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { sourceAuthoringRouter, synthesisMaxTokens } from "../server/routes/sourceAuthoring.js";

const source = {
  id: "anderson",
  title: "Anderson et al. (2004)",
  bibliographic: { title: "Board Characteristics and the Cost of Debt", author: "Anderson et al.", year: "2004", metadata_confidence: "researcher_reviewed" },
  text: "[Page 7]\nGreater board independence is associated with lower debt financing costs because creditors value reliable monitoring arrangements. The relation is stronger where reporting oversight reduces information uncertainty.",
};

async function postSynthesis(providerResponse) {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousFetch = global.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key";
  let sentBody = null;
  global.fetch = async (url, options) => {
    if (!String(url).startsWith("https://api.anthropic.com")) return previousFetch(url, options);
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify(providerResponse), { status: 200, headers: { "content-type": "application/json" } });
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
      body: JSON.stringify({ entryMode: "rebuild", structureText: "Literature Review\nBoard independence may reduce creditor uncertainty and debt financing costs (Anderson et al., 2004).", targetWords: 1500, quotePolicy: "source_heavy", sources: [source] }),
    });
    return { status: response.status, body: await response.json(), sentBody };
  } finally {
    server.close();
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
}

test("the synthesis budget grows with sections but stays inside the non-streaming ceiling", () => {
  assert.ok(synthesisMaxTokens(1500, 1) >= 8000);
  assert.ok(synthesisMaxTokens(1500, 8) > synthesisMaxTokens(1500, 1));
  assert.equal(synthesisMaxTokens(6000, 30), 16000);
});

test("a synthesis cut off at the token limit returns a clear message instead of a JSON parser error", async () => {
  const cutOff = '{"notebook":{"document_position":"x","sections":[{"section_id":"section-1","points":[{"id":"p1","proposition":"Monitoring';
  const { status, body, sentBody } = await postSynthesis({ content: [{ type: "text", text: cutOff }], stop_reason: "max_tokens", usage: { input_tokens: 10, output_tokens: 10 } });
  assert.equal(status, 502);
  assert.equal(body.error, "SYNTHESIS_TRUNCATED");
  assert.match(body.message, /cut off/);
  assert.doesNotMatch(body.message, /JSON|position/);
  assert.equal(sentBody.max_tokens, synthesisMaxTokens(1500, 1));
  assert.equal(JSON.parse(sentBody.messages[0].content).response_token_limit, sentBody.max_tokens);
});

test("an unreadable synthesis response is reported plainly", async () => {
  const { status, body } = await postSynthesis({ content: [{ type: "text", text: '{"notebook": {"sections": [1 2]}}' }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } });
  assert.equal(status, 502);
  assert.equal(body.error, "SYNTHESIS_UNREADABLE");
  assert.doesNotMatch(body.message, /JSON|position/);
});
