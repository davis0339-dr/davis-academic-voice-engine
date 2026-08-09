import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseResidualWriting } from "../server/lib/residualDiagnostics.js";

test("post-rewrite diagnostics flag academic bridge choreography and clause stacking", () => {
  const text = [
    "This problem extends to the way debt cost itself has been studied. Although credit ratings, bond yields, and bank-loan spreads provide useful information, they capture different aspects of borrowing because each measure reflects a different point in the financing relationship, which means that conclusions drawn from one measure may not transfer directly to another.",
    "A similar problem arises with institutional setting. While evidence from other countries can inform the discussion, legal protection, ownership structures, board regulation, and credit-market development may differ, which can affect both governance practice and the way creditors assess firms, even though the underlying governance mechanism appears similar.",
    "This distinction is important for the present study. Although earlier U.S. evidence established useful relationships, the period from 2015 to 2024 contains different financing conditions, which may alter how creditors interpret board characteristics because borrowing conditions changed across the period.",
    "Taken together, these findings suggest that governance relationships cannot be interpreted without considering the conditions in which the firm operates. This evidence therefore supports a contemporary examination of the selected board mechanisms.",
    "The present study addresses this uncertainty by examining the mechanisms together. Although each variable can be estimated separately, the wider board structure remains relevant because the characteristics coexist within the same firm, which makes the empirical setting important when the results are interpreted.",
  ].join("\n\n");

  const result = analyseResidualWriting(text);
  const ids = result.signals.map((signal) => signal.id);
  assert.ok(ids.includes("academic_bridge_choreography"));
  assert.ok(ids.includes("clause_stacking_pressure") || ids.includes("immediate_synthesis_density"));
  assert.ok(result.metrics.academic_bridge_count >= 3);
  assert.equal(result.measurement_version, "residual-writing-v3");
});
