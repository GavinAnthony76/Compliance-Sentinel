// Seeds three demo companies — one per Goshen pricing tier (Starter, Growth,
// Pro) — with realistic users, customers, properties, services, appointments,
// estimates, and invoices so the new plan limits/usage meters can be exercised
// end to end. Idempotent: re-running skips any company whose slug already exists.
//
// Run with: pnpm --filter @workspace/scripts run seed:pricing-demo
//
// NOTE on the "no frontend-set paid plans" rule: this script sets
// subscriptionPlan/subscriptionStatus directly via a server-side seed script
// (never through a user-facing API), which is the explicitly carved-out local
// demo/seed exception — not a way for real tenants to bypass Stripe.

import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.NEON_DATABASE_URL && !process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.resolve(__dirname, "../../lib/db/.env"));
  } catch {
    // No .env file found — assume the connection string is already in the environment.
  }
}

const {
  db,
  pool,
  companiesTable,
  usersTable,
  customersTable,
  propertiesTable,
  servicesTable,
  appointmentsTable,
  estimatesTable,
  estimateLineItemsTable,
  invoicesTable,
  invoiceLineItemsTable,
} = await import("@workspace/db");
const { eq } = await import("drizzle-orm");

const DEMO_PASSWORD = "Demo1234!";

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Random timestamp within the current calendar month (so monthly-limit counters pick it up). */
function randomDateInCurrentMonth(): Date {
  const now = new Date();
  const day = randomInt(1, now.getDate());
  const hour = randomInt(7, 18);
  const minute = pick([0, 15, 30, 45]);
  return new Date(now.getFullYear(), now.getMonth(), day, hour, minute);
}

const FIRST_NAMES = ["James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda", "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Christopher", "Nancy", "Daniel", "Lisa", "Matthew", "Margaret", "Anthony", "Betty", "Mark", "Sandra", "Donald", "Ashley", "Steven", "Dorothy", "Paul", "Kimberly", "Andrew", "Emily", "Joshua", "Donna"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores"];
const STREET_NAMES = ["Maple", "Oak", "Cedar", "Pine", "Elm", "Birch", "Willow", "Sycamore", "Magnolia", "Chestnut", "Walnut", "Spruce", "Aspen", "Poplar", "Hickory", "Dogwood", "Juniper", "Cypress", "Laurel", "Holly"];
const STREET_TYPES = ["St", "Ave", "Rd", "Dr", "Ln", "Ct", "Way", "Blvd", "Trl", "Cir"];
const CITIES = [
  { city: "Goshen", state: "IN", zip: "46526" },
  { city: "Elkhart", state: "IN", zip: "46514" },
  { city: "Mishawaka", state: "IN", zip: "46544" },
  { city: "South Bend", state: "IN", zip: "46601" },
  { city: "Nappanee", state: "IN", zip: "46550" },
];
const SERVICE_TEMPLATES = [
  { name: "Weekly Mowing", description: "Standard weekly lawn mowing and trimming", durationMinutes: 45, basePrice: "65.00", category: "mowing" },
  { name: "Bi-Weekly Mowing", description: "Mowing and edging every other week", durationMinutes: 45, basePrice: "60.00", category: "mowing" },
  { name: "Fertilization Treatment", description: "Seasonal fertilizer application", durationMinutes: 30, basePrice: "85.00", category: "treatment" },
  { name: "Aeration & Overseeding", description: "Core aeration with overseeding", durationMinutes: 90, basePrice: "175.00", category: "treatment" },
  { name: "Spring Cleanup", description: "Full property spring cleanup", durationMinutes: 120, basePrice: "225.00", category: "cleanup" },
  { name: "Fall Cleanup", description: "Leaf removal and fall debris haul-away", durationMinutes: 120, basePrice: "210.00", category: "cleanup" },
  { name: "Mulch Installation", description: "Bed edging and mulch installation", durationMinutes: 90, basePrice: "150.00", category: "landscaping" },
  { name: "Hedge Trimming", description: "Shrub and hedge shaping", durationMinutes: 60, basePrice: "95.00", category: "landscaping" },
];

function randomPerson() {
  return { firstName: pick(FIRST_NAMES), lastName: pick(LAST_NAMES) };
}
function randomPhone() {
  return `(574) ${randomInt(200, 999)}-${String(randomInt(0, 9999)).padStart(4, "0")}`;
}
function randomAddress() {
  const loc = pick(CITIES);
  return {
    addressLine1: `${randomInt(100, 9999)} ${pick(STREET_NAMES)} ${pick(STREET_TYPES)}`,
    city: loc.city,
    state: loc.state,
    zip: loc.zip,
  };
}

interface DemoSpec {
  slug: string;
  companyName: string;
  plan: "starter" | "growth" | "pro";
  emailDomain: string;
  ownerName: { firstName: string; lastName: string };
  staffCount: number;
  customerCount: number;
  appointmentCount: number;
  estimateCount: number;
  invoiceCount: number;
}

// Numbers below match the spec's required demo counts exactly for Starter and
// Growth, and exceed the stated thresholds (>250 customers, >5 users) for Pro
// so the "unlimited" tier is visibly demonstrated.
const SPECS: DemoSpec[] = [
  {
    slug: "goshen-starter-demo",
    companyName: "Hometown Lawn Care (Starter Demo)",
    plan: "starter",
    emailDomain: "starter-demo.goshen.app",
    ownerName: { firstName: "Jamie", lastName: "Carter" },
    staffCount: 0,
    customerCount: 45,
    appointmentCount: 80,
    estimateCount: 8,
    invoiceCount: 20,
  },
  {
    slug: "goshen-growth-demo",
    companyName: "Evergreen Property Care (Growth Demo)",
    plan: "growth",
    emailDomain: "growth-demo.goshen.app",
    ownerName: { firstName: "Morgan", lastName: "Reyes" },
    staffCount: 3,
    customerCount: 180,
    appointmentCount: 350,
    estimateCount: 70,
    invoiceCount: 150,
  },
  {
    slug: "goshen-pro-demo",
    companyName: "Summit Grounds Group (Pro Demo)",
    plan: "pro",
    emailDomain: "pro-demo.goshen.app",
    ownerName: { firstName: "Taylor", lastName: "Brooks" },
    staffCount: 7,
    customerCount: 260,
    appointmentCount: 420,
    estimateCount: 160,
    invoiceCount: 320,
  },
];

const APPOINTMENT_STATUSES = ["pending", "confirmed", "completed", "completed", "cancelled"];
const ESTIMATE_STATUSES = ["draft", "sent", "accepted", "accepted", "rejected"];
const INVOICE_STATUSES = ["draft", "sent", "paid", "paid", "overdue"];

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

async function seedCompany(spec: DemoSpec) {
  const existing = await db.select().from(companiesTable).where(eq(companiesTable.slug, spec.slug)).limit(1);
  if (existing.length > 0) {
    console.log(`Skipping ${spec.slug} — already seeded (company #${existing[0].id})`);
    return;
  }

  const hq = randomAddress();
  const [company] = await db.insert(companiesTable).values({
    name: spec.companyName,
    slug: spec.slug,
    phone: randomPhone(),
    email: `hello@${spec.emailDomain}`,
    address: hq.addressLine1,
    city: hq.city,
    state: hq.state,
    zip: hq.zip,
    timezone: "America/Indiana/Indianapolis",
    subscriptionPlan: spec.plan,
    subscriptionStatus: "active",
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    isActive: true,
  }).returning();

  // --- Users ---
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userRows = [{
    companyId: company.id,
    firstName: spec.ownerName.firstName,
    lastName: spec.ownerName.lastName,
    email: `owner@${spec.emailDomain}`,
    passwordHash,
    role: "owner",
    phone: randomPhone(),
    isActive: true,
  }];
  for (let i = 1; i <= spec.staffCount; i++) {
    const person = randomPerson();
    userRows.push({
      companyId: company.id,
      firstName: person.firstName,
      lastName: person.lastName,
      email: `staff${i}@${spec.emailDomain}`,
      passwordHash,
      role: "staff",
      phone: randomPhone(),
      isActive: true,
    });
  }
  const users = await db.insert(usersTable).values(userRows).returning();

  // --- Customers ---
  const customerRows = Array.from({ length: spec.customerCount }, () => {
    const person = randomPerson();
    const addr = randomAddress();
    return {
      companyId: company.id,
      firstName: person.firstName,
      lastName: person.lastName,
      email: `${person.firstName.toLowerCase()}.${person.lastName.toLowerCase()}${randomInt(1, 999)}@example.com`,
      phone: randomPhone(),
      addressLine1: addr.addressLine1,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      leadSource: pick(["referral", "google", "facebook", "yard_sign", "repeat_customer"]),
    };
  });
  const customers = (await Promise.all(
    chunk(customerRows, 100).map((batch) => db.insert(customersTable).values(batch).returning()),
  )).flat();

  // --- Properties (one per customer) ---
  const propertyRows = customers.map((c) => ({
    companyId: company.id,
    customerId: c.id,
    propertyName: "Primary residence",
    addressLine1: c.addressLine1 ?? randomAddress().addressLine1,
    city: c.city,
    state: c.state,
    zip: c.zip,
    yardSize: pick(["small", "medium", "large"]),
  }));
  const properties = (await Promise.all(
    chunk(propertyRows, 100).map((batch) => db.insert(propertiesTable).values(batch).returning()),
  )).flat();
  const propertyByCustomerId = new Map(properties.map((p) => [p.customerId, p]));

  // --- Services ---
  const serviceCount = spec.plan === "starter" ? 4 : spec.plan === "growth" ? 6 : 8;
  const services = await db.insert(servicesTable)
    .values(SERVICE_TEMPLATES.slice(0, serviceCount).map((s) => ({ companyId: company.id, ...s })))
    .returning();

  // --- Appointments ---
  // createdAt must fall within the current calendar month — that's how
  // features.ts counts "appointments this month" against the plan limit.
  const appointmentRows = Array.from({ length: spec.appointmentCount }, () => {
    const customer = pick(customers);
    const property = propertyByCustomerId.get(customer.id) ?? pick(properties);
    const service = pick(services);
    const created = randomDateInCurrentMonth();
    const start = new Date(created.getTime() + randomInt(1, 6) * 24 * 60 * 60 * 1000);
    return {
      companyId: company.id,
      customerId: customer.id,
      propertyId: property.id,
      serviceId: service.id,
      assignedUserId: pick(users).id,
      status: pick(APPOINTMENT_STATUSES),
      scheduledStart: start,
      scheduledEnd: new Date(start.getTime() + (service.durationMinutes ?? 60) * 60 * 1000),
      price: service.basePrice,
      createdAt: created,
      updatedAt: created,
    };
  });
  for (const batch of chunk(appointmentRows, 100)) {
    await db.insert(appointmentsTable).values(batch);
  }

  // --- Estimates (+ one line item each) ---
  let estimateSeq = 1;
  for (const batch of chunk(Array.from({ length: spec.estimateCount }), 50)) {
    const built = batch.map(() => {
      const customer = pick(customers);
      const property = propertyByCustomerId.get(customer.id) ?? pick(properties);
      const service = pick(services);
      const created = randomDateInCurrentMonth();
      const lineAmount = Number(service.basePrice ?? "100") * randomInt(1, 3);
      const tax = Math.round(lineAmount * 0.07 * 100) / 100;
      const total = lineAmount + tax;
      return {
        row: {
          companyId: company.id,
          customerId: customer.id,
          propertyId: property.id,
          estimateNumber: `EST-${company.id}-${String(estimateSeq++).padStart(4, "0")}`,
          status: pick(ESTIMATE_STATUSES),
          subtotal: lineAmount.toFixed(2),
          tax: tax.toFixed(2),
          total: total.toFixed(2),
          validUntil: new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000),
          createdAt: created,
          updatedAt: created,
        },
        lineDescription: service.name,
        lineAmount,
      };
    });
    const inserted = await db.insert(estimatesTable).values(built.map((b) => b.row)).returning();
    await db.insert(estimateLineItemsTable).values(inserted.map((est, idx) => ({
      estimateId: est.id,
      companyId: company.id,
      description: built[idx].lineDescription,
      quantity: "1",
      unitPrice: built[idx].lineAmount.toFixed(2),
      total: built[idx].lineAmount.toFixed(2),
      sortOrder: 0,
    })));
  }

  // --- Invoices (+ one line item each) ---
  let invoiceSeq = 1;
  for (const batch of chunk(Array.from({ length: spec.invoiceCount }), 50)) {
    const built = batch.map(() => {
      const customer = pick(customers);
      const service = pick(services);
      const created = randomDateInCurrentMonth();
      const lineAmount = Number(service.basePrice ?? "100") * randomInt(1, 2);
      const tax = Math.round(lineAmount * 0.07 * 100) / 100;
      const total = lineAmount + tax;
      const status = pick(INVOICE_STATUSES);
      return {
        row: {
          companyId: company.id,
          customerId: customer.id,
          invoiceNumber: `INV-${company.id}-${String(invoiceSeq++).padStart(4, "0")}`,
          status,
          subtotal: lineAmount.toFixed(2),
          tax: tax.toFixed(2),
          total: total.toFixed(2),
          dueDate: new Date(created.getTime() + 14 * 24 * 60 * 60 * 1000),
          paidAt: status === "paid" ? new Date(created.getTime() + randomInt(1, 10) * 24 * 60 * 60 * 1000) : null,
          createdAt: created,
          updatedAt: created,
        },
        lineDescription: service.name,
        lineAmount,
      };
    });
    const inserted = await db.insert(invoicesTable).values(built.map((b) => b.row)).returning();
    await db.insert(invoiceLineItemsTable).values(inserted.map((inv, idx) => ({
      invoiceId: inv.id,
      description: built[idx].lineDescription,
      quantity: "1",
      unitPrice: built[idx].lineAmount.toFixed(2),
      lineTotal: built[idx].lineAmount.toFixed(2),
      sortOrder: 0,
    })));
  }

  console.log(`Seeded ${spec.companyName} (#${company.id}, plan=${spec.plan}):`);
  console.log(`  ${users.length} users, ${customers.length} customers, ${appointmentRows.length} appointments this month, ${spec.estimateCount} estimates this month, ${spec.invoiceCount} invoices this month`);
  console.log(`  Login: owner@${spec.emailDomain} / ${DEMO_PASSWORD}`);
}

async function main() {
  console.log("Seeding Goshen pricing-tier demo companies...\n");
  for (const spec of SPECS) {
    await seedCompany(spec);
  }
  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
