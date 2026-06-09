import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { readFileSync, existsSync } from "node:fs";

// Load .env for local development.
// On Replit these vars are injected by the runtime, so this is a no-op there.
const localEnvFile = path.resolve(import.meta.dirname, ".env");
if (existsSync(localEnvFile)) {
  for (const line of readFileSync(localEnvFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

const SITE_NAME = "GreenSynk";

function replaceMetaTag(html: string, attr: string, name: string, value: string): string {
  const escaped = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const re = new RegExp(`(<meta ${attr}="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" content=")[^"]*(")`);
  return html.replace(re, `$1${escaped}$2`);
}

function injectDevMeta(html: string, title: string, description: string): string {
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} — ${SITE_NAME}`;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${fullTitle}</title>`);
  html = replaceMetaTag(html, "name",     "description",        description);
  html = replaceMetaTag(html, "property", "og:title",           fullTitle);
  html = replaceMetaTag(html, "property", "og:description",     description);
  html = replaceMetaTag(html, "name",     "twitter:title",      fullTitle);
  html = replaceMetaTag(html, "name",     "twitter:description",description);
  return html;
}

function devMetaInjectionPlugin(): Plugin {
  return {
    name: "dev-meta-injection",
    transformIndexHtml: {
      enforce: "pre",
      async handler(html, ctx) {
        if (!ctx.server || !ctx.originalUrl) return html;
        const pathname = ctx.originalUrl.split("?")[0];
        const apiPort  = process.env.API_PORT ?? "8080";

        const bookMatch     = pathname.match(/^\/book\/([^/?#]+)/);
        const estimateMatch = pathname.match(/^\/estimates\/([^/?#]+)\/sign/);

        if (bookMatch) {
          try {
            const r = await fetch(
              `http://localhost:${apiPort}/api/public/book/${encodeURIComponent(bookMatch[1])}`,
              { signal: AbortSignal.timeout(3000) },
            );
            if (r.ok) {
              const d = (await r.json()) as { companyName?: string };
              if (d.companyName) {
                return injectDevMeta(
                  html,
                  `Book with ${d.companyName}`,
                  `Request lawn care services from ${d.companyName}. Choose a service, describe your property, and submit your booking request online.`,
                );
              }
            }
          } catch { /* API may not be running — fall through */ }
        } else if (estimateMatch) {
          try {
            const r = await fetch(
              `http://localhost:${apiPort}/api/public/estimates/${encodeURIComponent(estimateMatch[1])}`,
              { signal: AbortSignal.timeout(3000) },
            );
            if (r.ok) {
              const d = (await r.json()) as { estimateNumber?: string; company?: { name?: string } };
              const company = d.company?.name;
              const num     = d.estimateNumber;
              if (company || num) {
                return injectDevMeta(
                  html,
                  `${num ? `Estimate ${num}` : "Estimate"}${company ? ` from ${company}` : ""}`,
                  company
                    ? `Review and sign your lawn care estimate from ${company}.`
                    : "Review and sign your lawn care estimate.",
                );
              }
            }
          } catch { /* API may not be running — fall through */ }
        }

        return html;
      },
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    devMetaInjectionPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-router": ["wouter"],
          "vendor-ui": [
            "@radix-ui/react-tooltip",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-popover",
          ],
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    // Proxy /api requests to the API server when running locally.
    // On Replit, REPL_ID is set and Replit's own routing layer handles this.
    ...(process.env.REPL_ID === undefined && {
      proxy: {
        "/api": {
          target: `http://localhost:${process.env.API_PORT ?? "8080"}`,
          changeOrigin: true,
        },
      },
    }),
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
