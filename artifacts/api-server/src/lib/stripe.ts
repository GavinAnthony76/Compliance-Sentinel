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

  const data = await response.json();
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
  return new Stripe(secretKey, {
    apiVersion: '2025-08-27.basil' as any,
  });
}

export async function getStripePublishableKey() {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey() {
  const { secretKey } = await getCredentials();
  return secretKey;
}

export const STRIPE_PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 49,
    interval: 'month',
    limits: { maxUsers: 1, maxCustomers: 50, maxAppointmentsPerMonth: 100, maxEstimatesPerMonth: 10, maxInvoicesPerMonth: 25 },
    features: [
      '1 user',
      '50 active customers',
      '100 appointments/month',
      '10 estimates/month',
      '25 invoices/month',
      'Customer CRM',
      'Scheduling calendar',
      'Invoicing & payments',
      'Public booking page',
      'Email reminders',
    ],
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    price: 99,
    interval: 'month',
    limits: { maxUsers: 5, maxCustomers: 250, maxAppointmentsPerMonth: 500, maxEstimatesPerMonth: 100, maxInvoicesPerMonth: 250 },
    features: [
      'Up to 5 users',
      '250 active customers',
      '500 appointments/month',
      '100 estimates/month',
      '250 invoices/month',
      'Route optimization',
      'Recurring plans',
      'Customer portal',
      'SMS notifications',
      'Review requests',
      'GPS tracking',
      'Before/after photos',
      'Follow-up campaigns',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 199,
    interval: 'month',
    limits: { maxUsers: null, maxCustomers: null, maxAppointmentsPerMonth: null, maxEstimatesPerMonth: null, maxInvoicesPerMonth: null },
    features: [
      'Unlimited users',
      'Unlimited customers',
      'Unlimited appointments',
      'Unlimited estimates',
      'Unlimited invoices',
      'AI Estimate Builder',
      'Lead Pipeline',
      'Advanced Analytics',
      'Data Export',
      'API Access',
      'Advanced Automations',
      'Autopay',
      'Priority Support',
    ],
  },
};

/** Maps a plan id to the env var name holding its Stripe price ID. Never hardcode price IDs. */
const STRIPE_PRICE_ID_ENV: Record<keyof typeof STRIPE_PLANS, string> = {
  starter: 'STRIPE_STARTER_PRICE_ID',
  growth: 'STRIPE_GROWTH_PRICE_ID',
  pro: 'STRIPE_PRO_PRICE_ID',
};

/** Returns the configured Stripe price ID for a plan, read from environment variables. */
export function getStripePriceId(planId: keyof typeof STRIPE_PLANS): string | null {
  const envVar = STRIPE_PRICE_ID_ENV[planId];
  return process.env[envVar] || null;
}
