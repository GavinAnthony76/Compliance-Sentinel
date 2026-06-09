import { Router } from "express";
import { getCatalog } from "../lib/plan-catalog";

const router = Router();

/**
 * Public plan catalog for the marketing/landing page. No auth — exposes only
 * display data (no Stripe keys). The authenticated in-app billing page uses
 * GET /billing/plans, which serves the same catalog plus the publishable key.
 */
router.get("/", (_req, res) => {
  return res.json({
    plans: getCatalog().map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      interval: p.interval,
      tagline: p.tagline,
      features: p.features,
      isPopular: p.isPopular,
      sortOrder: p.sortOrder,
    })),
  });
});

export default router;
