import { env, isProduction } from "./env";

/**
 * Which origins the API answers.
 *
 * In production this is exactly `CLIENT_URL` and nothing else. In development
 * it also accepts the private network, so the app can be opened on a phone at
 * `http://192.168.1.32:3000` — which is the only honest way to test a
 * mobile-first interface. The relaxation is gated on NODE_ENV, never on a
 * request header, so it cannot be turned on from outside.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

/** RFC 1918 ranges plus link-local, i.e. addresses that cannot be routed. */
function isPrivateAddress(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;

  const octets = parts.map((part) => Number(part));
  if (
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false;
  }

  const [a, b] = octets as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  if (origin === env.CLIENT_URL) return true;
  if (isProduction) return false;

  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return (
      LOOPBACK.has(hostname) ||
      isPrivateAddress(hostname) ||
      // Bonjour/mDNS names, which is how phones often reach a laptop.
      hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}

/** The value to echo back in `Access-Control-Allow-Origin`. */
export function resolveOrigin(origin: string): string | undefined {
  return isAllowedOrigin(origin) ? origin : undefined;
}
