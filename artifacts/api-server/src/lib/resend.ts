import { logger } from "./logger";

export interface ResendCredentials {
  apiKey: string;
  fromEmail: string;
}

// Resolves Resend credentials from environment variables.
// RESEND_FROM_EMAIL defaults to onboarding@resend.dev so emails work
// immediately in development/testing without domain verification.
// Point it at a verified domain (e.g. noreply@greensynk.com) for production.
export async function resolveEmailCredentials(): Promise<
  (ResendCredentials & { source: "env" }) | null
> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    const msg =
      "RESEND_API_KEY is not set — email delivery is disabled. " +
      "Add the secret in the environment panel to enable sending.";
    if (process.env.NODE_ENV !== "production") {
      logger.warn(`[Email] ${msg}`);
    } else {
      logger.error(`[Email] ${msg}`);
    }
    return null;
  }

  return {
    apiKey,
    fromEmail:
      process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
    source: "env",
  };
}

// Lightweight check for diagnostics: true when email can be delivered.
export async function isEmailConfigured(): Promise<boolean> {
  return (await resolveEmailCredentials()) !== null;
}
