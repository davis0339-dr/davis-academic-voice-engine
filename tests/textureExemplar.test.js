import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../server/lib/promptContract.js";
import { texturePromptBlock, TEXTURE_EXEMPLARS } from "../server/data/textureExemplars.js";

const base = {
  styleProfile: {},
  protectedSpans: {},
  plan: {
    items: [],
    paragraphReorderSuggested: false,
    documentGuidance: [
      "Several neighbouring sentences behave like independent mini-topic statements rather than one developing argument. Create local dependency where the reasoning supports it.",
    ],
  },
  grammarIntensity: "standard",
  humanCadence: { measuredSources: 15, meanSentenceLengthMin: 19.5, meanSentenceLengthMax: 32.1, sdMin: 13, sdMax: 18, pctLongMin: 16.7, pctLongMax: 48.5 },
};

test("detector-selected texture exemplar is no longer injected in any naturalisation mode", () => {
  const aggressive = buildSystemPrompt({ ...base, naturalisation: "aggressive" });
  const faithful = buildSystemPrompt({ ...base, naturalisation: "faithful" });
  const off = buildSystemPrompt({ ...base, naturalisation: "off" });
  assert.ok(!aggressive.includes("TEXTURE EXEMPLAR"));
  assert.ok(!faithful.includes("TEXTURE EXEMPLAR"));
  assert.ok(!off.includes("TEXTURE EXEMPLAR"));
  assert.deepEqual(TEXTURE_EXEMPLARS, []);
});

test("aggressive prompt receives evidence-safe authorial guidance instead of a detector-selected sample", () => {
  const block = texturePromptBlock();
  assert.match(block, /AUTHORIAL RECONSTRUCTION GUIDANCE/i);
  assert.match(block, /first two prose paragraphs/i);
  assert.match(block, /citation scope/i);
  assert.match(block, /methodological labels/i);
  assert.match(block, /do not optimise for any third-party authorship classifier/i);
});

test("aggressive prompt receives qualitative discourse and authorial reconstruction guidance", () => {
  const aggressive = buildSystemPrompt({ ...base, naturalisation: "aggressive" });
  assert.match(aggressive, /independent mini-topic statements/i);
  assert.match(aggressive, /local dependency/i);
  assert.match(aggressive, /paragraph as a unit of reasoning/i);
  assert.match(aggressive, /first two prose paragraphs/i);
  assert.match(aggressive, /citation scope/i);
});
