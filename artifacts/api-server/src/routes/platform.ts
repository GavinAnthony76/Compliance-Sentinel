import { Router } from "express";
import { getPlatformSettings } from "../lib/platform-settings";

const router = Router();

/**
 * Public platform contact addresses. Read by the marketing site, the legal
 * pages, and SEO/structured-data builders so contact emails live in the DB
 * (the single source of truth) rather than being hardcoded in the frontend.
 *
 * No auth: these are the same addresses already published on public pages.
 */
router.get("/contact-info", async (_req, res) => {
  const s = await getPlatformSettings();
  res.json({
    generalEmail: s.contactEmailGeneral,
    supportEmail: s.contactEmailSupport,
    salesEmail: s.contactEmailSales,
    privacyEmail: s.contactEmailPrivacy,
    legalEmail: s.contactEmailLegal,
  });
});

export default router;
