import { test } from "node:test";
import assert from "node:assert/strict";
import { inferSectionFromHeading, sectionLanguageGuide } from "../server/lib/sectionLanguageGuide.js";
import { resolveProfile } from "../server/lib/styleProfileStore.js";

test("infers common thesis section types from numbered headings", () => {
  assert.equal(inferSectionFromHeading("1.1 Background to the Study"), "background");
  assert.equal(inferSectionFromHeading("1.2 Statement of the Problem"), "statement_of_problem");
  assert.equal(inferSectionFromHeading("3.2 Research Methodology"), "methodology");
  assert.equal(inferSectionFromHeading("4.4 Discussion of Findings"), "discussion");
  assert.equal(inferSectionFromHeading("5.3 Limitations of the Study"), "limitations");
});

test("section guides describe purpose without imposing a rigid template", () => {
  const background = sectionLanguageGuide("background");
  assert.equal(background.section, "background");
  assert.match(background.purpose, /broad-to-narrow/i);
  assert.match(background.instruction, /not a paragraph template/i);
});

test("resolved style profile carries section-specific corpus guidance even though metadata corpus falls back at section level", () => {
  const profile = resolveProfile({ document_type: "thesis", region: "UK", section: "statement_of_problem" });
  assert.equal(profile.effective.requested_section, "statement_of_problem");
  assert.equal(profile.effective.features.section_language_guide.section, "statement_of_problem");
  assert.match(profile.effective.features.section_language_guide.purpose, /gap|study response|unresolved/i);
});
