import Stripe from 'stripe';

let connectionSettings: any;

async function getCredentials() {
  // Prefer direct env var keys (e.g. sandbox keys set explicitly) over the Replit connector
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY) {
    return {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      secretKey: process.env.STRIPE_SECRET_KEY,
    };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error('X-Replit-Token not found for repl/depl');
  }

  const connectorName = 'stripe';
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', connectorName);
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Replit-Token': xReplitToken
    }
  });

  const data = (await response.json()) as { items?: any[] };
  connectionSettings = data.items?.[0];

  if (!connectionSettings || (!connectionSettings.settings.publishable || !connectionSettings.settings.secret)) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

export async function getUncachableStripeClient() {
  const { secretKey } = await getCredentials();
  // Do not set apiVersion — the SDK uses the latest version automatically
  return new Stripe(secretKey);
}

export async function getStripePublishableKey() {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey() {
  const { secretKey } = await getCredentials();
  return secretKey;
}

/**
 * Maps a plan id to the env var name holding its Stripe price ID. Never hardcode
 * price IDs. Plan display data and limits live in the DB-backed plan catalog
 * (lib/plan-catalog.ts) — the single source of truth.
 */
const STRIPE_PRICE_ID_ENV: Record<string, string> = {
  starter: 'STRIPE_STARTER_PRICE_ID',
  growth: 'STRIPE_GROWTH_PRICE_ID',
  pro: 'STRIPE_PRO_PRICE_ID',
};

/** Returns the configured Stripe price ID for a plan, read from environment variables. */
export function getStripePriceId(planId: string): string | null {
  const envVar = STRIPE_PRICE_ID_ENV[planId];
  return envVar ? process.env[envVar] || null : null;
}
