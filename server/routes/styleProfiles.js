import { Router } from "express";
import { listProfiles, listSelectableDimensions } from "../lib/styleProfileStore.js";

export const styleProfilesRouter = Router();

styleProfilesRouter.get("/style-profiles", (_req, res) => {
  res.json({
    profiles: listProfiles(),
    selectable_dimensions: listSelectableDimensions(),
  });
});
