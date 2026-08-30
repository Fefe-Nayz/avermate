import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const composeServiceName = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const deniedNames = new Set([
  "instance-data",
  "metadata",
  "metadata.google.internal",
]);

export function nodePrivateAddress(value: string) {
  const address = value.toLowerCase().replace(/^\[|\]$/gu, "");
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [first = -1, second = -1] = octets;
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  return version === 6 && (address === "::1" || /^(?:fc|fd)/u.test(address));
}

/**
 * Accepts loopback, RFC1918/ULA literals and private Compose/local DNS names.
 * Link-local metadata ranges, public hosts, credentials and implicit ports are
 * deliberately rejected.
 */
export function parseNodeLocalSidecarBaseUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const port = Number(url.port);
  const namedLocal =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    composeServiceName.test(hostname);
  if (
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !Number.isInteger(port) ||
    port < 1_024 ||
    port > 65_535 ||
    deniedNames.has(hostname) ||
    (!nodePrivateAddress(hostname) && !namedLocal)
  ) {
    throw new Error("NODE_CAPABILITY_SIDECAR_ENDPOINT_NOT_LOCAL");
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`;
  return url;
}

export async function assertNodeLocalSidecarResolution(
  base: URL,
  resolve: (hostname: string) => Promise<readonly string[]> = async (
    hostname,
  ) => (await lookup(hostname, { all: true, verbatim: true })).map(
    (entry) => entry.address,
  ),
) {
  const hostname = base.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (isIP(hostname)) {
    if (!nodePrivateAddress(hostname)) {
      throw new Error("NODE_CAPABILITY_SIDECAR_SSRF_DENIED");
    }
    return [hostname];
  }
  let addresses: readonly string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new Error("NODE_CAPABILITY_SIDECAR_DNS_UNAVAILABLE");
  }
  if (
    addresses.length === 0 ||
    addresses.length > 16 ||
    addresses.some((address) => !nodePrivateAddress(address))
  ) {
    throw new Error("NODE_CAPABILITY_SIDECAR_SSRF_DENIED");
  }
  return [...addresses];
}
