import { test } from "node:test";
import assert from "node:assert/strict";
import { measureLanguageFingerprint } from "../server/lib/languageFingerprint.js";

test("language fingerprint measures cadence, paragraph shape, stance and evidence features", () => {
  const text = `This study examines audit quality in listed firms. The evidence may differ across institutional settings because regulatory enforcement is uneven (Smith, 2020).\n\nAlthough prior work reports a positive association, we find that the relationship becomes weaker when ownership concentration is high; this result suggests that governance context matters (Jones, 2019). However, the estimate should be interpreted cautiously because the available sample covers only one market.`;
  const fp = measureLanguageFingerprint(text);

  assert.equal(fp.measurement_version, "language-fingerprint-v1");
  assert.ok(fp.word_count > 50);
  assert.ok(fp.sentence_count >= 4);
  assert.ok(fp.sentence_mean > 0);
  assert.ok(fp.sentence_sd > 0);
  assert.ok(fp.hedge_per_1k > 0);
  assert.ok(fp.first_person_per_1k > 0);
  assert.ok(fp.parenthetical_citations_per_1k > 0);
  assert.ok(fp.transition_per_100_sent > 0);
  assert.ok(fp.sentence_initial_diversity > 0);
});

test("language fingerprint detects mechanically repeated content frames", () => {
  const repeated = Array.from({ length: 10 }, (_, i) => `The evidence indicates that audit quality affects market confidence in firm ${i + 1}.`).join(" ");
  const varied = `Across the sample, audit quality is associated with market confidence. Investors respond to assurance differently when firms operate under stronger governance institutions. Where regulatory monitoring is weak, however, the same audit signal carries less weight. This variation suggests that institutional context changes how assurance is interpreted by market participants.`;

  const repeatedFp = measureLanguageFingerprint(repeated);
  const variedFp = measureLanguageFingerprint(varied);
  assert.ok(repeatedFp.repeated_content_4gram_per_1k > variedFp.repeated_content_4gram_per_1k);
  assert.ok(repeatedFp.sentence_initial_diversity < variedFp.sentence_initial_diversity);
});
