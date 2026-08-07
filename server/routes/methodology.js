import { Router } from "express";
import { listCoverageTable } from "../lib/styleProfileStore.js";

export const methodologyRouter = Router();

// Section 6.5: methodology/evidence screen. Shows the actual, currently
// countable evidence behind the style engine -- not a marketing claim.
methodologyRouter.get("/methodology", (_req, res) => {
  res.json(listCoverageTable());
});
