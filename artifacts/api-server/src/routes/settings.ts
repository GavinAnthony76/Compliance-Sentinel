import { Router } from "express";
import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { logActivity } from "../lib/activity";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });
  return res.json(company);
});

router.put("/", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const allowed = ["name", "phone", "email", "address", "city", "state", "zip", "website", "timezone", "primaryColor", "logoUrl", "reviewUrl"];
  const updates: any = { updatedAt: new Date() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  const [updated] = await db.update(companiesTable).set(updates).where(eq(companiesTable.id, companyId)).returning();
  await logActivity({ companyId, userId, action: "company.settings_updated", entityType: "company", entityId: companyId });
  return res.json(updated);
});

// GET /settings/payment-config
router.get("/payment-config", async (req: any, res) => {
  const { companyId } = req.user;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) return res.status(404).json({ error: "NotFound" });
  return res.json({
    acceptedPaymentMethods: company.acceptedPaymentMethods ? JSON.parse(company.acceptedPaymentMethods) : ["cash", "check"],
    paymentInstructions: company.paymentInstructions ?? "",
    zelleInfo: company.zelleInfo ?? "",
    venmoHandle: company.venmoHandle ?? "",
    cashAppTag: company.cashAppTag ?? "",
    checkPayableTo: company.checkPayableTo ?? "",
  });
});

// PUT /settings/payment-config
router.put("/payment-config", requireRole("owner", "admin"), async (req: any, res) => {
  const { companyId, userId } = req.user;
  const updates: any = { updatedAt: new Date() };
  if (req.body.acceptedPaymentMethods !== undefined) {
    updates.acceptedPaymentMethods = JSON.stringify(req.body.acceptedPaymentMethods);
  }
  if (req.body.paymentInstructions !== undefined) updates.paymentInstructions = req.body.paymentInstructions;
  if (req.body.zelleInfo !== undefined) updates.zelleInfo = req.body.zelleInfo;
  if (req.body.venmoHandle !== undefined) updates.venmoHandle = req.body.venmoHandle;
  if (req.body.cashAppTag !== undefined) updates.cashAppTag = req.body.cashAppTag;
  if (req.body.checkPayableTo !== undefined) updates.checkPayableTo = req.body.checkPayableTo;
  await db.update(companiesTable).set(updates).where(eq(companiesTable.id, companyId));
  await logActivity({ companyId, userId, action: "company.payment_config_updated", entityType: "company", entityId: companyId });
  return res.json({ success: true, ...req.body });
});

export default router;
