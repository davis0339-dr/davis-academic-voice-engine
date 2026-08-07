import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../server/lib/promptContract.js";
import { texturePromptBlock, TEXTURE_EXEMPLARS } from "../server/data/textureExemplars.js";

const base = {
  styleProfile: {},
  protectedSpans: {},
  plan: { items: [], paragraphReorderSuggested: false },
  grammarIntensity: "standard",
  humanCadence: { measuredSources: 15, meanSentenceLengthMin: 19.5, meanSentenceLengthMax: 32.1, sdMin: 13, sdMax: 18, pctLongMin: 16.7, pctLongMax: 48.5 },
};

test("texture exemplar is included only in aggressive mode", () => {
  const aggressive = buildSystemPrompt({ ...base, naturalisation: "aggressive" });
  const faithful = buildSystemPrompt({ ...base, naturalisation: "faithful" });
  const off = buildSystemPrompt({ ...base, naturalisation: "off" });
  assert.ok(aggressive.includes("TEXTURE EXEMPLAR"));
  assert.ok(!faithful.includes("TEXTURE EXEMPLAR"));
  assert.ok(!off.includes("TEXTURE EXEMPLAR"));
});

test("the texture block instructs the model to match texture but NOT borrow content", () => {
  const block = texturePromptBlock();
  assert.match(block, /MATCH ITS TEXTURE, NOT ITS CONTENT/);
  assert.match(block, /Copying any of its content is a failure/);
});

test("exemplar set is small (guards against content-bleed risk)", () => {
  assert.ok(TEXTURE_EXEMPLARS.length >= 1 && TEXTURE_EXEMPLARS.length <= 3);
});
