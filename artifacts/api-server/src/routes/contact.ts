import { Router } from "express";
import { z } from "zod";
import { sendEmail } from "../lib/notifications";
import { logger } from "../lib/logger";
import { getPlatformSettings } from "../lib/platform-settings";

const router = Router();

const schema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  company: z.string().max(100).optional(),
  message: z.string().max(2000).optional(),
});

router.post("/demo-request", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "ValidationError", message: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { name, email, phone, company, message } = parsed.data;

  try {
    const settings = await getPlatformSettings();
    const toEmail = process.env.CONTACT_EMAIL || settings.contactEmailGeneral || process.env.RESEND_FROM_EMAIL;
    await sendEmail({
      to: toEmail,
      subject: `New Demo Request — ${name}${company ? ` (${company})` : ""}`,
      body: [
        `Name: ${name}`,
        `Email: ${email}`,
        phone ? `Phone: ${phone}` : null,
        company ? `Company: ${company}` : null,
        message ? `\nMessage:\n${message}` : null,
      ].filter(Boolean).join("\n"),
      replyTo: email,
    });

    logger.info({ name, email }, "Demo request submitted");
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to send demo request email");
    return res.status(500).json({ error: "SendFailed", message: "Could not send your request. Please try again." });
  }
});

export default router;
