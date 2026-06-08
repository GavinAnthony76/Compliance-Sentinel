import { Router } from "express";
import { db, customersTable, appointmentsTable, invoicesTable, servicesTable, usersTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../lib/features";

const router = Router();
router.use(requireAuth);
router.use(requireFeature("data_export"));

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
    customers.map(c => [c.id, c.firstName, c.lastName, c.email, c.phone, c.addressLine1, c.city, c.state, c.zip, c.notes, c.createdAt?.toISOString()])
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

  const customerIds = [...new Set(appointments.map(a => a.customerId))];
  const serviceIds = [...new Set(appointments.map(a => a.serviceId).filter(Boolean))] as number[];
  const userIds = [...new Set(appointments.map(a => a.assignedUserId).filter(Boolean))] as number[];

  const [customers, services, users] = await Promise.all([
    customerIds.length > 0 ? db.select().from(customersTable).where(inArray(customersTable.id, customerIds)) : [],
    serviceIds.length > 0 ? db.select().from(servicesTable).where(inArray(servicesTable.id, serviceIds)) : [],
    userIds.length > 0 ? db.select().from(usersTable).where(inArray(usersTable.id, userIds)) : [],
  ]);

  const customerMap = Object.fromEntries(customers.map(c => [c.id, `${c.firstName} ${c.lastName}`]));
  const serviceMap = Object.fromEntries(services.map(s => [s.id, s.name]));
  const userMap = Object.fromEntries(users.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

  const csv = toCSV(
    ["ID", "Customer", "Service", "Assigned To", "Status", "Scheduled Start", "Scheduled End", "Price", "Notes", "Created At"],
    appointments.map(a => [
      a.id,
      customerMap[a.customerId] ?? a.customerId,
      a.serviceId ? serviceMap[a.serviceId] ?? "" : "",
      a.assignedUserId ? userMap[a.assignedUserId] ?? "" : "",
      a.status,
      a.scheduledStart?.toISOString(),
      a.scheduledEnd?.toISOString() ?? "",
      a.price ?? "",
      a.notes ?? "",
      a.createdAt?.toISOString(),
    ])
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

  const customerIds = [...new Set(invoices.map(i => i.customerId))];
  const customers = customerIds.length > 0
    ? await db.select().from(customersTable).where(inArray(customersTable.id, customerIds))
    : [];
  const customerMap = Object.fromEntries(customers.map(c => [c.id, `${c.firstName} ${c.lastName}`]));

  const csv = toCSV(
    ["ID", "Invoice #", "Customer", "Status", "Subtotal", "Tax", "Total", "Due Date", "Paid At", "Notes", "Created At"],
    invoices.map(i => [i.id, i.invoiceNumber, customerMap[i.customerId] ?? "", i.status, i.subtotal, i.tax, i.total, i.dueDate?.toISOString() ?? "", i.paidAt?.toISOString() ?? "", i.notes ?? "", i.createdAt?.toISOString()])
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="invoices-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(csv);
});

export default router;
