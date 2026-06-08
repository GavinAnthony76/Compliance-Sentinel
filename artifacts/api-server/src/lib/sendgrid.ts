import { logger } from "./logger";

export interface SendGridCredentials {
  apiKey: string;
  fromEmail?: string;
}

// Fetches SendGrid credentials from the Replit-managed connector proxy.
// Credentials are fetched fresh on every call — never cache them, as the
// underlying connection tokens rotate. Returns null when the connector is
// not connected or unreachable.
export async function getConnectorSendGridCredentials(): Promise<SendGridCredentials | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) return null;

  try {
    const res = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=sendgrid`,
      {
        headers: {
          Accept: "application/json",
          X_REPLIT_TOKEN: xReplitToken,
        },
      },
    );

    if (!res.ok) {
      logger.error({ status: res.status }, "Failed to fetch SendGrid connector credentials");
      return null;
    }

    const data = await res.json();
    const settings = data?.items?.[0]?.settings;
    const apiKey = settings?.api_key;
    if (!apiKey) return null;

    return { apiKey, fromEmail: settings?.from_email };
  } catch (err) {
    logger.error({ err }, "Error fetching SendGrid connector credentials");
    return null;
  }
}

// Resolves the active email credentials, preferring the Replit-managed
// SendGrid connector and falling back to a raw SENDGRID_API_KEY env var.
export async function resolveEmailCredentials(): Promise<
  (SendGridCredentials & { source: "connector" | "env" }) | null
> {
  const connector = await getConnectorSendGridCredentials();
  if (connector?.apiKey) {
    return { ...connector, source: "connector" };
  }

  if (process.env.SENDGRID_API_KEY) {
    return {
      apiKey: process.env.SENDGRID_API_KEY,
      fromEmail: process.env.SENDGRID_FROM_EMAIL,
      source: "env",
    };
  }

  return null;
}

// Lightweight check for status/diagnostics surfaces: true when email can be
// delivered via the connector or a raw env API key.
export async function isEmailConfigured(): Promise<boolean> {
  return (await resolveEmailCredentials()) !== null;
}
