import { Router } from "express";
import { db, companiesTable, reviewsTable } from "@workspace/db";
import { eq, and, desc, gte } from "drizzle-orm";
import { logActivity } from "../lib/activity";
import { z } from "zod";

const router = Router();

const submitSchema = z.object({
  reviewerName: z.string().min(1).max(120),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional().nullable(),
});

// GET /public/reviews-featured — approved reviews across companies for the GreenSynk
// landing page testimonials (4-5 stars only, most recent first).
router.get("/reviews-featured", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 9, 24);
  const rows = await db
    .select({
      reviewerName: reviewsTable.reviewerName,
      rating: reviewsTable.rating,
      comment: reviewsTable.comment,
      createdAt: reviewsTable.createdAt,
      companyName: companiesTable.name,
    })
    .from(reviewsTable)
    .innerJoin(companiesTable, eq(reviewsTable.companyId, companiesTable.id))
    .where(and(eq(reviewsTable.status, "approved"), gte(reviewsTable.rating, 4)))
    .orderBy(desc(reviewsTable.createdAt))
    .limit(limit);
  return res.json({ reviews: rows });
});

// GET /public/reviews/:slug — company branding + approved reviews for the public page.
router.get("/reviews/:slug", async (req, res) => {
  const [company] = await db.select().from(companiesTable).where(and(eq(companiesTable.slug, req.params.slug), eq(companiesTable.isActive, true))).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound", message: "Company not found" });

  const reviews = await db
    .select({ reviewerName: reviewsTable.reviewerName, rating: reviewsTable.rating, comment: reviewsTable.comment, createdAt: reviewsTable.createdAt })
    .from(reviewsTable)
    .where(and(eq(reviewsTable.companyId, company.id), eq(reviewsTable.status, "approved")))
    .orderBy(desc(reviewsTable.createdAt))
    .limit(50);

  return res.json({
    companyName: company.name,
    logoUrl: company.logoUrl,
    primaryColor: company.primaryColor,
    reviews,
  });
});

// POST /public/reviews/:slug — submit a review (lands as pending for moderation).
router.post("/reviews/:slug", async (req, res) => {
  const [company] = await db.select().from(companiesTable).where(and(eq(companiesTable.slug, req.params.slug), eq(companiesTable.isActive, true))).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound", message: "Company not found" });

  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const [review] = await db.insert(reviewsTable).values({
    companyId: company.id,
    reviewerName: parsed.data.reviewerName,
    rating: parsed.data.rating,
    comment: parsed.data.comment ?? null,
    status: "pending",
    source: "public",
  }).returning();

  await logActivity({ companyId: company.id, action: "review.submitted", entityType: "review", entityId: review.id, metadata: { rating: parsed.data.rating } });
  return res.status(201).json({ success: true, message: "Thank you for your review!" });
});

export default router;
