import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { startAutomationScheduler } from "./lib/automations";

// Simple in-memory rate limiter
const _rateLimitStore = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // The access-control e2e suites run many registrations/logins against a
    // single shared server from one IP inside the rate-limit window; disable the
    // limiter under test so a growing suite list can't trip the shared counter.
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }
    // Use originalUrl so the key is stable regardless of where middleware is mounted
    const key = `${req.ip}:${req.originalUrl.split("?")[0]}`;
    const now = Date.now();
    const entry = _rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
      _rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (entry.count >= maxRequests) {
      res.status(429).json({ error: "TooManyRequests", message: "Too many requests, please try again later." });
      return;
    }
    entry.count++;
    next();
  };
}

const app: Express = express();

// Security headers
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  // Restrictive CSP — allows our own origin, Stripe.js, and the Resend pixel.
  // Inline styles are needed by Tailwind/shadcn; inline scripts are NOT allowed.
  // Update script-src if additional third-party scripts are ever added.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://js.stripe.com"],
      scriptSrcElem: ["'self'", "https://js.stripe.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const allowedOrigins: (string | RegExp)[] = [];
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);
if (process.env.REPL_SLUG) allowedOrigins.push(`https://${process.env.REPL_SLUG}.repl.co`);
// Allow all *.replit.dev and *.riker.replit.dev origins for Replit workspace previews
allowedOrigins.push(/https?:\/\/.*\.(replit\.dev|riker\.replit\.dev|repl\.co)(:\d+)?$/);

app.use(cors({
  // Never fall back to wildcard — if no specific origin is configured the
  // server refuses cross-origin credentialed requests rather than open the door.
  origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));

// Rate limiting: only on mutation auth endpoints, not /me (which is called on every page load)
app.use("/api/auth/login", rateLimit(20, 60_000));
app.use("/api/auth/register", rateLimit(10, 60_000));
app.use("/api/auth/forgot-password", rateLimit(10, 60_000));
app.use("/api/auth/reset-password", rateLimit(10, 60_000));
app.use("/api/admin/auth/login", rateLimit(10, 60_000));
app.use("/api/admin/auth/forgot-password", rateLimit(10, 60_000));
app.use("/api/admin/auth/reset-password", rateLimit(10, 60_000));
app.use("/api/admin/auth/change-password", rateLimit(10, 60_000));
app.use("/api/portal/auth/login", rateLimit(20, 60_000));
app.use("/api/portal/auth/forgot-password", rateLimit(10, 60_000));
app.use("/api/portal/auth/set-password", rateLimit(10, 60_000));
app.use("/api/public/book", rateLimit(15, 60_000));
app.use("/api/public/estimates", rateLimit(15, 60_000));
app.use("/api/export", rateLimit(30, 60_000));

// Raw body capture for Stripe webhooks (must be before express.json())
app.use((req: Request, _res, next) => {
  if (req.path === "/api/billing/webhook" || req.path.endsWith("/billing/webhook")) {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      (req as any).rawBody = data;
      next();
    });
  } else {
    next();
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Global error handler — must have 4 parameters for Express to treat it as an error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction): void => {
  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : "Internal server error";
  logger.error({ err }, "Unhandled error");
  res.status(status).json({ error: "ServerError", message });
});

// Start background automation scheduler (24h appointment reminders)
startAutomationScheduler();

// Start background follow-up campaign processor
import("./lib/follow-ups").then(({ processPendingFollowUps }) => {
  processPendingFollowUps();
  setInterval(processPendingFollowUps, 5 * 60 * 1000);
});

// Materialize appointments from recurring plans (runs hourly).
import("./lib/recurring").then(({ generateDueRecurringAppointments }) => {
  generateDueRecurringAppointments().catch(() => {});
  setInterval(() => { generateDueRecurringAppointments().catch(() => {}); }, 60 * 60 * 1000);
});

// Release invoices stuck mid-payment if an autopay charge was interrupted
// (e.g. server crash/restart). Reconciles with Stripe first (runs every 5 min).
import("./lib/stuck-invoices").then(({ releaseStuckProcessingInvoices }) => {
  releaseStuckProcessingInvoices().catch(() => {});
  setInterval(() => { releaseStuckProcessingInvoices().catch(() => {}); }, 5 * 60 * 1000);
});

export default app;
