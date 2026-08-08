// Structured model-response parsing helpers.
// The writing engine must not lose a valid revision merely because a provider
// wrapped JSON in a code fence or emitted surrounding prose. This module does
// deterministic recovery only; semantic/schema validation remains in pipeline.

export function stripCodeFence(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function extractJsonEnvelope(text) {
  const stripped = stripCodeFence(text);
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first < 0 || last <= first) return stripped;
  return stripped.slice(first, last + 1);
}

export function parseStructuredResponseText(text) {
  const candidates = [];
  const stripped = stripCodeFence(text);
  candidates.push(stripped);
  const envelope = extractJsonEnvelope(text);
  if (envelope !== stripped) candidates.push(envelope);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return { ok: true, parsed: JSON.parse(candidate), recovered: candidate !== stripped, error: null };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    parsed: null,
    recovered: false,
    error: lastError || new Error("Unable to parse model response as JSON"),
  };
}

export function buildJsonRepairSystemPrompt() {
  return [
    "You are a syntax-recovery utility, not a writing model.",
    "The user message contains a model response that was intended to be one JSON object with revised_text, edit_summary and diagnostics_notes.",
    "Repair JSON SERIALISATION/SYNTAX ONLY. Do not rewrite, improve, shorten, expand, paraphrase or reinterpret revised_text.",
    "Preserve every character of the prose value as closely as JSON encoding permits; escape embedded quotation marks, backslashes and newlines correctly.",
    "Preserve all edit_summary values and diagnostics_notes content.",
    "If surrounding markdown fences or commentary exist, remove them.",
    "Return exactly one valid JSON object and nothing else.",
  ].join("\n");
}
