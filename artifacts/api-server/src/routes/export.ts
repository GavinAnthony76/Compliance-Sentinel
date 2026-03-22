import { Router } from "express";
import { db, customersTable, appointmentsTable, invoicesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";

const router = Router();
router.use(requireAuth);
router.use(requireFeature("csv_export"));

function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (v: string | number | null | undefined): string => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [headers.join(","), ...rows.map(row => row.map(escape).join(","))].join("\n");
}

router.get("/customers", async (req: any, res) => {
  const { companyId } = req.user;
  const customers = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.companyId, companyId))
    .orderBy(customersTable.firstName);

  const csv = toCSV(
    ["ID", "First Name", "Last Name", "Email", "Phone", "Address", "City", "State", "ZIP", "Notes", "Created At"],
    customers.map(c => [c.id, c.firstName, c.lastName, c.email, c.phone, c.address, c.city, c.state, c.zip, c.notes, c.createdAt?.toISOString()])
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(csv);
});

router.get("/appointments", async (req: any, res) => {
  const { companyId } = req.user;
  const appointments = await db
    .select()
    .from(appointmentsTable)
    .where(eq(appointmentsTable.companyId, companyId))
    .orderBy(desc(appointmentsTable.scheduledStart));

  const csv = toCSV(
    ["ID", "Title", "Status", "Scheduled Start", "Scheduled End", "Duration (min)", "Price", "Address", "Notes", "Created At"],
    appointments.map(a => [a.id, a.title, a.status, a.scheduledStart?.toISOString(), a.scheduledEnd?.toISOString(), a.duration, a.price, a.address, a.notes, a.createdAt?.toISOString()])
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="appointments-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(csv);
});

router.get("/invoices", async (req: any, res) => {
  const { companyId } = req.user;
  const invoices = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.companyId, companyId))
    .orderBy(desc(invoicesTable.createdAt));

  const csv = toCSV(
    ["ID", "Invoice #", "Status", "Subtotal", "Tax", "Total", "Due Date", "Paid At", "Notes", "Created At"],
    invoices.map(i => [i.id, i.invoiceNumber, i.status, i.subtotal, i.tax, i.total, i.dueDate?.toISOString(), i.paidAt?.toISOString(), i.notes, i.createdAt?.toISOString()])
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="invoices-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(csv);
});

export default router;
