import dns from "dns";
import net from "net";
import { logger } from "./logger";

/**
 * Returns true when an IP address belongs to a private, loopback, link-local,
 * or otherwise non-public range that must never be reachable from a
 * server-side fetch of user-supplied URLs (SSRF protection).
 */
function isPrivateIp(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // unknown / unparseable — treat as unsafe
}

/**
 * Safely fetch a remote image (e.g. a tenant-supplied company logo) for
 * server-side use such as PDF rendering. Guards against SSRF by requiring
 * HTTPS, rejecting hosts that resolve to private/loopback/link-local IPs, and
 * refusing redirects (which could otherwise bypass the host check). Returns the
 * image bytes, or null if the URL is unsafe, not an image, or the fetch fails.
 */
export async function fetchImageBufferSafe(url: string, timeoutMs = 5000): Promise<Buffer | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  try {
    const { address } = await dns.promises.lookup(parsed.hostname);
    if (isPrivateIp(address)) {
      logger.warn({ host: parsed.hostname }, "Blocked image fetch to private/non-public address");
      return null;
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("image/")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
