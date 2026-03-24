import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

// Simple in-memory rate limiter
const _rateLimitStore = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip}:${req.path}`;
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

const allowedOrigin = process.env.FRONTEND_URL
  || (process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.repl.co` : undefined);
app.use(cors({
  origin: allowedOrigin || true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));

// Rate limiting: stricter on auth and export endpoints
app.use("/api/auth", rateLimit(20, 60_000));
app.use("/api/admin/auth", rateLimit(10, 60_000));
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

export default app;
