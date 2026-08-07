#!/usr/bin/env node
// Section 15.3 "Detector QA" starter harness. This is a lightweight
// comparison tool for the product team, not the full evaluation set
// Section 21.2 eventually calls for (that needs a real held-out human
// writing benchmark and labelled AI-generated set, which this build does
// not have -- see README "Known limitations").
//
// It runs a small set of ORIGINAL samples (written for this script, not
// copied from any real thesis -- avoids the copyright problem of using
// actual corpus source text) through whatever detector provider is
// configured, so the team can observe how the configured detector responds
// to human-style vs formulaic vs engine-revised text. Purely observational
// -- this script has no connection to the live rewrite pipeline's runtime
// behavior; it never feeds a result back into generation.

import "dotenv/config";
import { scanWithAllConfigured, listDetectorHealth } from "../server/lib/detectorQA.js";
import { llmProvider } from "../server/lib/llmProvider.js";
import { rewrite } from "../server/lib/pipeline.js";

const HUMAN_STYLE_SAMPLE = {
  label: "clean_technical_human_style",
  description: "Original text written for this script, styled after the corpus's clean-text quantitative core (citation- and number-dense, evidence-led).",
  text: "The regression results indicate a positive and statistically significant association between audit committee financial expertise and disclosure quality (β = 0.28, p < 0.01, adj. R² = 0.34). The sample comprised 214 UK-listed firms over the period 2010-2019. This finding is consistent with agency theory (Fama & Jensen, 1983) and extends prior evidence from Rahman (2018).",
};

const FORMULAIC_SAMPLE = {
  label: "formulaic_filler_style",
  description: "Original text written for this script, deliberately stuffed with generic/formulaic phrasing and repetitive transitions.",
  text: "It is important to note that corporate governance plays a crucial role in firm performance. Furthermore, board independence is important. Moreover, board independence is significant. Additionally, prior studies have shown that board independence matters (Al-Najjar, 2012; Chen, 2015). The sample included 187 firms and the mean board size was 8.4 members, with an average of 34.2% independent directors.",
};

async function buildSampleSet() {
  const samples = [HUMAN_STYLE_SAMPLE, FORMULAIC_SAMPLE];

  if (llmProvider.isConfigured()) {
    try {
      const raw = await llmProvider.callAnthropic({
        system: "Write exactly one short academic-style paragraph (60-90 words) about corporate governance and firm performance. Output only the paragraph, no preamble.",
        messages: [{ role: "user", content: "Write the paragraph." }],
        maxTokens: 300,
      });
      samples.push({
        label: "raw_llm_unedited",
        description: "Live LLM output generated directly for this script (NOT through the app's rewrite pipeline) -- an unedited baseline.",
        text: raw.text.trim(),
      });
    } catch (err) {
      console.warn(`Skipping raw_llm_unedited sample: ${err.message}`);
    }

    try {
      const revised = await rewrite({
        sourceText: FORMULAIC_SAMPLE.text,
        styleFilters: { document_type: "thesis" },
        rewriteIntensity: "deep",
        grammarIntensity: "standard",
        lengthPreference: "auto",
      });
      samples.push({
        label: "engine_revised",
        description: "formulaic_filler_style run through this app's actual /api/rewrite pipeline (Deep intensity).",
        text: revised.revised_text,
      });
    } catch (err) {
      console.warn(`Skipping engine_revised sample: ${err.message}`);
    }
  } else {
    console.log("ANTHROPIC_API_KEY not configured -- skipping raw_llm_unedited and engine_revised samples (only static human/formulaic samples will run).");
  }

  return samples;
}

async function main() {
  const health = await listDetectorHealth();
  console.log("Detector provider health:", health.map((h) => `${h.label}: ${h.state}`).join(", "));

  const anyConfigured = health.some((h) => h.state !== "NOT_CONFIGURED");
  if (!anyConfigured) {
    console.log("\nNo detector provider is configured (set GPTZERO_API_KEY). Nothing to scan. Exiting.");
    return;
  }

  const samples = await buildSampleSet();

  console.log(`\nScanning ${samples.length} sample(s)...\n`);
  for (const sample of samples) {
    console.log(`--- ${sample.label} ---`);
    console.log(sample.description);
    const { results } = await scanWithAllConfigured(sample.text);
    for (const r of results) {
      if (r.state === "NOT_CONFIGURED") {
        console.log(`  ${r.label}: not configured`);
      } else if (r.state !== "READY") {
        console.log(`  ${r.label}: ${r.state} (${r.error || ""})`);
      } else if (r.parseWarning) {
        console.log(`  ${r.label}: ${r.parseWarning}`);
      } else {
        console.log(`  ${r.label}: predicted_class=${r.summary?.predictedClass ?? "n/a"}, completely_generated_prob=${r.summary?.completelyGeneratedProb ?? "n/a"}`);
      }
    }
    console.log("");
  }

  console.log("These are observations for your own product QA -- not a target the rewrite engine optimizes toward (Section 15.4).");
}

main().catch((err) => {
  console.error("detector-qa-report failed:", err);
  process.exitCode = 1;
});
