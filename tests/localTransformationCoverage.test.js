import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTransformationQuality } from "../server/lib/transformationQuality.js";

const source = `Audit firms operate within competitive markets shaped by regulation and client demand. Performance was historically assessed through fee income and the number of engagements secured. As accountability expectations expanded, audit quality and operational efficiency became increasingly important performance dimensions. Market concentration nevertheless remained high across many developed audit jurisdictions. North American practice illustrates the scale of this concentration among the largest listed entities. The United Kingdom presents a comparable pattern despite repeated competition reforms. Asian markets differ because domestic networks retain a more substantial competitive position. African audit markets face additional pressure from skills shortages and uneven technological capacity. Nigeria combines rapid fee growth with persistent dominance by international audit networks. Lagos contains the largest concentration of major audit practices in the country. Indigenous firms therefore compete for a relatively narrow share of premium engagements. These conditions motivate closer examination of the organisational capabilities associated with sustainable audit-firm performance.`;

// The first four sentences are deliberately untouched, while the remainder is
// substantially rebuilt. The document-wide ratio can look acceptable, but a
// conspicuous local block still fails aggressive transformation coverage.
const localCopyRun = `Audit firms operate within competitive markets shaped by regulation and client demand. Performance was historically assessed through fee income and the number of engagements secured. As accountability expectations expanded, audit quality and operational efficiency became increasingly important performance dimensions. Market concentration nevertheless remained high across many developed audit jurisdictions. Among large listed companies, North America provides one of the clearest examples of concentrated assurance work. Competition reforms have not prevented a similarly concentrated structure from persisting in Britain. A different configuration appears across parts of Asia, where sizeable local networks compete more meaningfully with international affiliates. On the African continent, constraints in professional skills and digital capability add a different set of pressures to market competition. Nigeria brings these issues together because strong growth in audit fees has occurred alongside continued international-network dominance. The country's principal audit practices are concentrated in Lagos, its commercial centre. As a result, locally owned firms contest only a limited portion of the premium engagement market. Understanding sustainable performance therefore requires attention to the internal capabilities that determine how these firms respond to such conditions.`;

test("aggressive mode rejects a concentrated local run of near-source sentences even when the rest is restructured", () => {
  const q = assessTransformationQuality(source, localCopyRun, "aggressive");
  assert.ok(q.max_consecutive_near_source_sentences >= 4);
  assert.equal(q.passed, false);
  assert.ok(q.reasons.some((reason) => reason.includes("local run")));
});
