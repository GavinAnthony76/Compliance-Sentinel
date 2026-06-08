import Stripe from "stripe";

async function getStripeClient() {
  // Prefer explicit env var (e.g. sandbox key) over Replit connector
  if (process.env.STRIPE_SECRET_KEY) {
    console.log("Using STRIPE_SECRET_KEY env var");
    return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" as any });
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error("Replit connector env vars not set — run this script inside Replit");
  }

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", "development");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
  });
  const data = await response.json();
  const settings = data.items?.[0]?.settings;
  if (!settings?.secret) throw new Error("Stripe development connection not found");

  return new Stripe(settings.secret, { apiVersion: "2025-08-27.basil" as any });
}

const PLANS = [
  { id: "starter", name: "GreenSynk Starter", description: "For solo operators — 1 user, 50 customers", amount: 4900 },
  { id: "growth",  name: "GreenSynk Growth",  description: "For growing crews — 5 users, 250 customers", amount: 9900 },
  { id: "pro",     name: "GreenSynk Pro",      description: "For established businesses — unlimited everything", amount: 19900 },
];

async function main() {
  const stripe = await getStripeClient();
  console.log("Connected to Stripe ✓\n");

  for (const plan of PLANS) {
    console.log(`Creating product: ${plan.name}`);
    const existing = await stripe.products.search({ query: `name:'${plan.name}'` });

    let product: Stripe.Product;
    let price: Stripe.Price;

    if (existing.data.length > 0) {
      product = existing.data[0];
      console.log(`  ↳ Product already exists: ${product.id}`);
      const prices = await stripe.prices.list({ product: product.id, active: true, recurring: { interval: "month" } as any, limit: 1 });
      if (prices.data.length > 0) {
        price = prices.data[0];
        console.log(`  ↳ Price already exists: ${price.id} ($${plan.amount / 100}/mo)`);
      } else {
        price = await stripe.prices.create({
          product: product.id,
          unit_amount: plan.amount,
          currency: "usd",
          recurring: { interval: "month" },
          metadata: { plan: plan.id },
        });
        console.log(`  ↳ Created price: ${price.id} ($${plan.amount / 100}/mo)`);
      }
    } else {
      product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        metadata: { plan: plan.id },
      });
      console.log(`  ↳ Created product: ${product.id}`);

      price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.amount,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { plan: plan.id },
      });
      console.log(`  ↳ Created price: ${price.id} ($${plan.amount / 100}/mo)`);
    }

    console.log(`\n  ✅ STRIPE_${plan.id.toUpperCase()}_PRICE_ID=${price.id}\n`);
  }

  console.log("Done. Copy the price IDs above into your Replit Secrets:\n");
  console.log("  STRIPE_STARTER_PRICE_ID=price_...");
  console.log("  STRIPE_GROWTH_PRICE_ID=price_...");
  console.log("  STRIPE_PRO_PRICE_ID=price_...");
}

main().catch(err => { console.error(err); process.exit(1); });
