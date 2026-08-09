import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("editor loads rewrite lineage before other fetch-wrapping enhancers", () => {
  const optional = fs.readFileSync(new URL("../public/optionalFeatures.js", import.meta.url), "utf8");
  const lineageIndex = optional.indexOf('/rewriteLineage.js');
  const detectorIndex = optional.indexOf('/detectorQuickBridge.js');
  const authorialIndex = optional.indexOf('/authorialTextureUI.js');
  assert.ok(lineageIndex >= 0);
  assert.ok(detectorIndex > lineageIndex);
  assert.ok(authorialIndex > lineageIndex);
});

test("rewrite lineage wrapper injects root-source metadata only on rewrite POSTs", () => {
  const script = fs.readFileSync(new URL("../public/rewriteLineage.js", import.meta.url), "utf8");
  assert.ok(script.includes("\\/api\\/rewrite"));
  assert.match(script, /rewriteLineage/);
  assert.match(script, /rootSourceText/);
  assert.match(script, /sourceGeneration/);
  assert.match(script, /localStorage/);
});
