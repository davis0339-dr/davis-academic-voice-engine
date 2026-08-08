// Legacy texture-exemplar hook.
//
// Early builds used one owner-supplied paragraph that an external detector had
// rated as human. That was useful as an experiment, but it is intentionally no
// longer injected into production prompts. A single detector-selected passage
// is not a defensible model of human academic writing and can encourage
// overfitting to one writer's rhythm.
//
// The benchmark fixture remains in tests/fixtures/detector-benchmark for
// historical evaluation only. Production naturalisation now relies on the
// multi-document corpus, source-specific language fingerprints, qualitative
// discourse diagnostics and preservation controls.

export const TEXTURE_EXEMPLARS = [];

export function texturePromptBlock() {
  return "";
}
