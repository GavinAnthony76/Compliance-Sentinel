import { Router } from "express";
import { z } from "zod";
import { db, appointmentPhotosTable, appointmentsTable, usersTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
router.use(requireAuth);

const objectStorage = new ObjectStorageService();

const PHOTO_TYPES = ["before", "after", "general"] as const;

const createSchema = z.object({
  appointmentId: z.number().int().positive(),
  objectPath: z.string().min(1),
  type: z.enum(PHOTO_TYPES).default("general"),
  originalFileName: z.string().max(255).optional().nullable(),
  mimeType: z.string().max(120).optional().nullable(),
  sizeBytes: z.number().int().nonnegative().optional().nullable(),
  caption: z.string().max(1000).optional().nullable(),
});

// GET /api/appointment-photos?appointmentId=123 — list photos for an appointment
router.get("/", async (req: any, res) => {
  const { companyId } = req.user;
  const appointmentId = Number(req.query.appointmentId);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ error: "ValidationError", message: "appointmentId query param is required" });
  }

  const [appt] = await db.select().from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, appointmentId), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!appt) return res.status(404).json({ error: "AppointmentNotFound" });

  const photos = await db.select().from(appointmentPhotosTable)
    .where(and(eq(appointmentPhotosTable.appointmentId, appointmentId), eq(appointmentPhotosTable.companyId, companyId)))
    .orderBy(desc(appointmentPhotosTable.createdAt));

  const userIds = [...new Set(photos.map(p => p.uploadedByUserId).filter(Boolean))] as number[];
  const users = userIds.length > 0 ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const userMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

  return res.json({
    photos: photos.map(p => ({
      ...p,
      uploadedByName: p.uploadedByUserId ? userMap[p.uploadedByUserId] ?? null : null,
    })),
  });
});

// POST /api/appointment-photos — record a photo uploaded via presigned URL
router.post("/", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.message });
  }
  const data = parsed.data;

  const [appt] = await db.select().from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, data.appointmentId), eq(appointmentsTable.companyId, companyId))).limit(1);
  if (!appt) return res.status(404).json({ error: "AppointmentNotFound", message: "Appointment not found for this company" });

  // Normalize the object path so it always starts with /objects/
  const fileKey = objectStorage.normalizeObjectEntityPath(data.objectPath);
  const fileUrl = `/api/storage${fileKey}`;

  const [photo] = await db.insert(appointmentPhotosTable).values({
    companyId,
    appointmentId: data.appointmentId,
    uploadedByUserId: userId,
    type: data.type,
    fileUrl,
    fileKey,
    originalFileName: data.originalFileName ?? null,
    mimeType: data.mimeType ?? null,
    sizeBytes: data.sizeBytes ?? null,
    caption: data.caption ?? null,
  }).returning();

  await logActivity({
    companyId, userId,
    action: "appointment_photo.created",
    entityType: "appointment",
    entityId: data.appointmentId,
    metadata: { photoId: photo.id, type: data.type },
  });

  return res.status(201).json(photo);
});

// DELETE /api/appointment-photos/:id — remove a photo record
router.delete("/:id", async (req: any, res) => {
  const { companyId, userId } = req.user;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ValidationError", message: "Invalid id" });

  const [existing] = await db.select().from(appointmentPhotosTable)
    .where(and(eq(appointmentPhotosTable.id, id), eq(appointmentPhotosTable.companyId, companyId))).limit(1);
  if (!existing) return res.status(404).json({ error: "NotFound" });

  await db.delete(appointmentPhotosTable)
    .where(and(eq(appointmentPhotosTable.id, id), eq(appointmentPhotosTable.companyId, companyId)));

  await logActivity({
    companyId, userId,
    action: "appointment_photo.deleted",
    entityType: "appointment",
    entityId: existing.appointmentId,
    metadata: { photoId: id },
  });

  return res.json({ success: true });
});

export default router;
