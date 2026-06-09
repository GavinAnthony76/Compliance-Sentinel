import app from "./app";
import { logger } from "./lib/logger";
import { initPlanCatalog } from "./lib/plan-catalog";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  // Load the plan catalog from the DB before accepting traffic so plan limit
  // enforcement uses fresh values from the first request (falls back to
  // built-in defaults if the DB is unavailable).
  await initPlanCatalog();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

void start();
